/**
 * The raw plan import forwards TrainingPeaks' JSON to PlanMyPeak untouched.
 *
 * These tests pin the one property that matters for that path: whatever
 * `response.json()` produced is what `fetchNativeTrainingPlanSources` hands
 * back — including the fields, nulls and rows the presentation schemas would
 * strip, default or drop. The presentation fetchers are exercised on the same
 * fixtures so the contrast is explicit, not assumed.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  fetchNativeTrainingPlanSources,
  fetchPlanWorkouts,
  fetchTrainingPlans,
} from '@/background/api/trainingPeaks';

const mockGet = vi.fn();
const mockRemove = vi.fn();
const mockSet = vi.fn();

const RANGE = '2010-12-15/2038-09-13';
const TP_API = 'https://tpapi.trainingpeaks.com';
const TP_RX_API = 'https://api.peakswaresb.com';

/** One plan row as `/plans/v1/plansWithAccess` returns it, fully readable. */
function readablePlanRow(planId: number): Record<string, unknown> {
  return {
    planAccess: {
      planAccessId: 1,
      personId: 12345,
      planId,
      accessFromPayment: false,
      accessFromShare: true,
      grantedFromPersonId: null,
      planAccessType: 1,
    },
    planId,
    planPersonId: 12345,
    ownerPersonId: 54321,
    createdOn: '2024-01-15T10:00:00Z',
    title: `Plan ${planId}`,
    author: 'Coach Example',
    planEmail: 'coach@example.com',
    planLanguage: null,
    dayCount: 84,
    weekCount: 12,
    startDate: '2024-03-01',
    endDate: '2024-05-23',
    workoutCount: 48,
    eventCount: 1,
    description: null,
    planCategory: 1,
    subcategory: null,
    additionalCriteria: null,
    eventPlan: false,
    eventName: null,
    eventDate: null,
    forceDate: false,
    isDynamic: false,
    isPublic: false,
    isSearchable: false,
    price: null,
    customUrl: 0,
    hasWeeklyGoals: false,
    sampleWeekOne: null,
    sampleWeekTwo: null,
  };
}

/**
 * The plan under import, carrying everything the presentation schema would
 * change: `weekCount: null` (defaulted to 0 by the picker schema), an unknown
 * top-level key, and an unknown nested object inside `planAccess`.
 */
const TARGET_PLAN = {
  ...readablePlanRow(100),
  weekCount: null,
  dayCount: null,
  planAccess: {
    ...(readablePlanRow(100).planAccess as Record<string, unknown>),
    futureFlags: { granular: true, tiers: [1, 2, null] },
  },
  unknownTopLevel: { nested: { deeper: 'kept' }, list: [null, 'x', 3] },
};

/** A row tolerantList drops from the picker: no `planAccess` at all. */
const UNREADABLE_PLAN = {
  planId: 200,
  title: 'Broken row',
  startDate: null,
};

const PLAN_LIST = [readablePlanRow(50), UNREADABLE_PLAN, TARGET_PLAN];

const FOLDERS = [
  {
    folderId: 'f-1',
    folderName: 'Off the Shelf',
    ownerId: 54321,
    planIds: [100, 50],
    colour: '#ff0000',
  },
];

/**
 * Plan workouts where one row has `title: null`. `z.array(PlanWorkoutSchema)`
 * rejects the *whole* response on that row; the native path keeps it.
 */
const PLAN_WORKOUTS = [
  {
    workoutId: 1,
    athleteId: 9,
    title: 'Endurance',
    workoutTypeValueId: 2,
    workoutDay: '2024-03-04T00:00:00',
    structure: {
      structure: [{ type: 'step', length: { unit: 'second', value: 600 } }],
      primaryLengthMetric: 'duration',
      primaryIntensityMetric: 'percentOfFtp',
      polyline: [
        [0, 0.5],
        [600, 0.5],
      ],
    },
    tssPlanned: null,
    ifPlanned: 0.65,
    lastModifiedDate: '2024-02-01T00:00:00',
    someNewField: { a: [1, { b: null }] },
  },
  {
    workoutId: 2,
    athleteId: 9,
    title: null,
    workoutTypeValueId: 2,
    workoutDay: '2024-03-05T00:00:00',
    structure: null,
    lastModifiedDate: '2024-02-01T00:00:00',
  },
];

const CALENDAR_NOTES = [
  {
    id: 7,
    title: 'Rest week',
    description: '',
    noteDate: '2024-03-11T00:00:00',
    createdDate: '2024-02-01T00:00:00',
    modifiedDate: '2024-02-01T00:00:00',
    planId: 100,
    attachments: [],
    pinned: null,
  },
];

const CALENDAR_EVENTS = [
  {
    id: 987,
    planId: 100,
    eventDate: '2024-05-23T00:00:00',
    name: 'City Marathon',
    eventType: 'Running',
    description: null,
    comment: 'Goal race',
    distance: 42.195,
    distanceUnits: 'km',
    legs: [{ leg: 1, distance: 42.195, unknownLegField: null }],
  },
];

const RX_WORKOUTS = [
  {
    id: 'rx-abc',
    calendarId: 9,
    title: 'Strength A',
    prescribedDate: '2024-03-06',
    workoutType: 'StructuredStrength',
    lastUpdatedAt: '2024-02-01T00:00:00Z',
    sequenceSummary: [{ sequenceOrder: 'A', title: 'Squat', extra: null }],
  },
];

type Route = { url: string; body: unknown };

function routeTable(overrides: Partial<Record<string, unknown>> = {}): Route[] {
  return [
    { url: `${TP_API}/plans/v1/plansWithAccess`, body: PLAN_LIST },
    { url: `${TP_API}/planfolder/v1/folder/all`, body: FOLDERS },
    {
      url: `${TP_API}/plans/v1/plans/100/workouts/${RANGE}`,
      body: PLAN_WORKOUTS,
    },
    {
      url: `${TP_API}/plans/v1/plans/100/calendarNote/${RANGE}`,
      body: CALENDAR_NOTES,
    },
    {
      url: `${TP_API}/plans/v1/plans/100/events/${RANGE}`,
      body: CALENDAR_EVENTS,
    },
    {
      url: `${TP_RX_API}/rx/activity/v1/plans/100/workouts/${RANGE}`,
      body: RX_WORKOUTS,
    },
    // The plan the picker drops has nothing scheduled; its four kinds are empty.
    { url: `${TP_API}/plans/v1/plans/200/workouts/${RANGE}`, body: [] },
    { url: `${TP_API}/plans/v1/plans/200/calendarNote/${RANGE}`, body: [] },
    { url: `${TP_API}/plans/v1/plans/200/events/${RANGE}`, body: [] },
    {
      url: `${TP_RX_API}/rx/activity/v1/plans/200/workouts/${RANGE}`,
      body: [],
    },
  ].map((route) =>
    route.url in overrides ? { ...route, body: overrides[route.url] } : route
  );
}

/**
 * Serve each route from a fresh JSON round-trip, the way a real `Response`
 * would, so the test cannot pass by returning the fixture object itself.
 */
function mockFetchFrom(routes: Route[]): void {
  (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
    async (url: string) => {
      const route = routes.find((entry) => entry.url === url);
      if (!route) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      const serialized = JSON.stringify(route.body);
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(serialized),
      };
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  global.chrome = {
    storage: {
      local: { get: mockGet, set: mockSet, remove: mockRemove },
    },
  } as unknown as typeof chrome;
  global.fetch = vi.fn();
  mockGet.mockResolvedValue({ auth_token: 'valid-token-123' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchNativeTrainingPlanSources', () => {
  it('returns every payload semantically equal to what TrainingPeaks sent', async () => {
    mockFetchFrom(routeTable());

    const result = await fetchNativeTrainingPlanSources(100);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.plan).toStrictEqual(TARGET_PLAN);
    expect(result.data.folders).toStrictEqual(FOLDERS);
    expect(result.data.planWorkouts).toStrictEqual(PLAN_WORKOUTS);
    expect(result.data.calendarNotes).toStrictEqual(CALENDAR_NOTES);
    expect(result.data.calendarEvents).toStrictEqual(CALENDAR_EVENTS);
    expect(result.data.rxWorkouts).toStrictEqual(RX_WORKOUTS);
  });

  it('keeps nulls the picker schema defaults and keys it strips', async () => {
    mockFetchFrom(routeTable());

    const result = await fetchNativeTrainingPlanSources(100);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    const plan = result.data.plan as Record<string, unknown>;
    expect(plan.weekCount).toBeNull();
    expect(plan.dayCount).toBeNull();
    expect(plan.unknownTopLevel).toStrictEqual(TARGET_PLAN.unknownTopLevel);
    expect(
      (plan.planAccess as Record<string, unknown>).futureFlags
    ).toStrictEqual({ granular: true, tiers: [1, 2, null] });

    const [first] = result.data.planWorkouts as Record<string, unknown>[];
    expect(first.someNewField).toStrictEqual({ a: [1, { b: null }] });
    expect((first.structure as Record<string, unknown>).polyline).toStrictEqual(
      [
        [0, 0.5],
        [600, 0.5],
      ]
    );
    expect(first.tssPlanned).toBeNull();

    // The presentation projection of the same list defaults the null count —
    // which is exactly why it cannot be the import payload.
    const picker = await fetchTrainingPlans();
    expect(picker.success).toBe(true);
    if (picker.success) {
      const shown = picker.data.find((row) => row.planId === 100);
      expect(shown?.weekCount).toBe(0);
      expect(shown).not.toHaveProperty('unknownTopLevel');
    }
  });

  it('keeps a row the picker schema rejects, while the picker fetch fails', async () => {
    mockFetchFrom(routeTable());

    const native = await fetchNativeTrainingPlanSources(100);
    expect(native.success).toBe(true);
    if (native.success) {
      expect(native.data.planWorkouts).toHaveLength(2);
      expect(
        (native.data.planWorkouts[1] as Record<string, unknown>).title
      ).toBeNull();
    }

    const picker = await fetchPlanWorkouts(100);
    expect(picker.success).toBe(false);
    if (!picker.success) {
      expect(picker.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('selects the plan by id from a list that contains a row tolerantList drops', async () => {
    mockFetchFrom(routeTable());

    const picker = await fetchTrainingPlans();
    expect(picker.success).toBe(true);
    if (picker.success) {
      expect(picker.data.map((row) => row.planId)).toEqual([50, 100]);
    }

    const native = await fetchNativeTrainingPlanSources(100);
    expect(native.success).toBe(true);
    if (native.success) {
      expect(native.data.plan).toStrictEqual(TARGET_PLAN);
    }

    // The dropped row is itself importable through the native path.
    const dropped = await fetchNativeTrainingPlanSources(200);
    expect(dropped.success).toBe(true);
    if (dropped.success) {
      expect(dropped.data.plan).toStrictEqual(UNREADABLE_PLAN);
    }
  });

  it('fails when the plan is not in the list', async () => {
    mockFetchFrom(routeTable());

    const result = await fetchNativeTrainingPlanSources(999);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('fails when a list endpoint does not return a list', async () => {
    mockFetchFrom(
      routeTable({
        [`${TP_API}/plans/v1/plans/100/events/${RANGE}`]: { events: [] },
      })
    );

    const result = await fetchNativeTrainingPlanSources(100);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('events');
    }
  });

  it('fails the bundle when one endpoint fails, so counts are never guessed', async () => {
    const routes = routeTable().filter(
      (route) => !route.url.includes('/rx/activity/')
    );
    mockFetchFrom(routes);

    const result = await fetchNativeTrainingPlanSources(100);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.status).toBe(404);
    }
  });

  it('fails without a token before any request', async () => {
    mockGet.mockResolvedValue({});
    mockFetchFrom(routeTable());

    const result = await fetchNativeTrainingPlanSources(100);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('NO_TOKEN');
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
