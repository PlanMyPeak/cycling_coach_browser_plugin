import { describe, expect, it } from 'vitest';
import {
  PlanMyPeakCoachSchema,
  PlanMyPeakCreateWorkoutResponseSchema,
  PlanMyPeakKnownWorkoutTypeSchema,
  PlanMyPeakLibrariesResponseSchema,
  PlanMyPeakPlanDetailSchema,
  PlanMyPeakWorkoutLibraryResponseSchema,
  formatPlanMyPeakWorkoutTypeLabel,
  getCoachTrainingPeaksExternalId,
  isKnownPlanMyPeakWorkoutType,
} from '@/schemas/planMyPeakApi.schema';

/** A workout row as PlanMyPeak returns it, used as the base for these cases. */
function workoutPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wk-1',
    name: 'Sweet Spot 4x8',
    description: 'Tempo work.',
    workoutType: 'bike',
    rideType: 'sweet_spot',
    summary: {
      segmentCount: 1,
      stepCount: 4,
      estimatedDurationSeconds: 1920,
    },
    profile: null,
    library: { id: 'lib-1', name: 'TP Import' },
    provider: 'training_peaks',
    providerWorkoutId: '12684302',
    providerMetadata: { suitablePhases: ['Base'] },
    providerIntensityFactor: null,
    providerTss: null,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('planMyPeakApi schemas', () => {
  it('parses the libraries list, including the workout count', () => {
    const parsed = PlanMyPeakLibrariesResponseSchema.parse({
      data: [
        {
          id: 'lib-1',
          name: 'My Workouts',
          description: null,
          isDefault: true,
          workoutCount: 25,
          createdAt: '2026-08-19T00:00:00.000Z',
          updatedAt: '2026-08-19T00:00:00.000Z',
        },
      ],
    });

    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].isDefault).toBe(true);
    expect(parsed.data[0].workoutCount).toBe(25);
  });

  it('parses a workout list with pagination and facets', () => {
    const parsed = PlanMyPeakWorkoutLibraryResponseSchema.parse({
      data: [workoutPayload()],
      pagination: { limit: 25, offset: 0, total: 1 },
      facets: {
        workoutType: { bike: 1 },
        rideType: { sweet_spot: 1 },
        duration: { under_1h: 1 },
        total: 1,
        incomplete: false,
      },
    });

    expect(parsed.data).toHaveLength(1);
    expect(parsed.pagination.total).toBe(1);
    expect(parsed.facets.incomplete).toBe(false);
  });

  it('keeps a null profile, which is common rather than exceptional', () => {
    // Null whenever the structure is open-ended, distance-based, or in absolute
    // watts, so this has to parse rather than be treated as malformed.
    const parsed = PlanMyPeakCreateWorkoutResponseSchema.parse(
      workoutPayload({ profile: null })
    );

    expect(parsed.profile).toBeNull();
  });

  it('accepts a heart-rate profile with no load', () => {
    // An HR workout has no normalized power, so there is nothing to derive a
    // load from. Null means unknown here, never zero.
    const parsed = PlanMyPeakCreateWorkoutResponseSchema.parse(
      workoutPayload({
        profile: {
          metric: 'heartrate',
          unit: 'percentOfThresholdHr',
          segments: [{ intensity: 88, seconds: 1200 }],
          durationSeconds: 1200,
          intensityFactor: null,
          tss: null,
          loadSource: null,
          peakIntensity: 92,
        },
      })
    );

    expect(parsed.profile?.metric).toBe('heartrate');
    expect(parsed.profile?.intensityFactor).toBeNull();
    expect(parsed.profile?.loadSource).toBeNull();
  });

  it('distinguishes a provider-supplied load from a derived one', () => {
    // Presenting a passed-through TrainingPeaks figure as our own derivation
    // would misrepresent where the number came from.
    const parsed = PlanMyPeakCreateWorkoutResponseSchema.parse(
      workoutPayload({
        providerIntensityFactor: 0.72,
        providerTss: 61,
        profile: {
          metric: 'heartrate',
          unit: 'percentOfMaxHr',
          segments: [{ intensity: 80, seconds: 3600 }],
          durationSeconds: 3600,
          intensityFactor: 0.72,
          tss: 61,
          loadSource: 'provider',
          peakIntensity: 84,
        },
      })
    );

    expect(parsed.profile?.loadSource).toBe('provider');
    expect(parsed.providerIntensityFactor).toBe(0.72);
    expect(parsed.providerTss).toBe(61);
  });

  it('parses an effort-rated profile on the 1-10 scale', () => {
    // The value is a point on a scale, not a percentage. `unit` is the only
    // thing that says so, which is why the field is `intensity` — formatting an
    // RPE of 9 as "9%" would describe a maximal effort as almost nothing.
    const parsed = PlanMyPeakCreateWorkoutResponseSchema.parse(
      workoutPayload({
        profile: {
          metric: 'rpe',
          unit: 'scale10',
          segments: [{ intensity: 9, seconds: 60 }],
          durationSeconds: 3480,
          intensityFactor: null,
          tss: null,
          loadSource: null,
          peakIntensity: 9,
        },
      })
    );

    expect(parsed.profile?.metric).toBe('rpe');
    expect(parsed.profile?.unit).toBe('scale10');
    expect(parsed.profile?.peakIntensity).toBe(9);
    // An effort rating computes no training stress.
    expect(parsed.profile?.tss).toBeNull();
  });

  it('parses a populated profile with its ratio intensity factor', () => {
    const parsed = PlanMyPeakCreateWorkoutResponseSchema.parse(
      workoutPayload({
        profile: {
          metric: 'power',
          unit: 'percentOfFtp',
          segments: [{ intensity: 90, seconds: 1920 }],
          durationSeconds: 1920,
          intensityFactor: 0.85,
          tss: 45,
          loadSource: 'derived',
          peakIntensity: 93.5,
        },
      })
    );

    // A ratio, not a percentage — 0.85 rather than 85.
    expect(parsed.profile?.intensityFactor).toBe(0.85);
  });

  it('reports the library a workout is actually filed in', () => {
    // The write response reports where the workout really is, which is how an
    // importer detects that a coach had moved it somewhere else.
    const parsed = PlanMyPeakCreateWorkoutResponseSchema.parse(
      workoutPayload({ library: { id: 'lib-9', name: 'Base Phase' } })
    );

    expect(parsed.library.id).toBe('lib-9');
    expect(parsed.library.name).toBe('Base Phase');
  });

  it('accepts a workout authored in PlanMyPeak, which has no provider identity', () => {
    const parsed = PlanMyPeakCreateWorkoutResponseSchema.parse(
      workoutPayload({
        provider: null,
        providerWorkoutId: null,
        providerMetadata: null,
      })
    );

    expect(parsed.provider).toBeNull();
    expect(parsed.providerWorkoutId).toBeNull();
    expect(parsed.providerMetadata).toBeNull();
  });

  it('accepts an unfamiliar rideType, which the server derives and may extend', () => {
    const parsed = PlanMyPeakCreateWorkoutResponseSchema.parse(
      workoutPayload({ rideType: 'some_new_classification' })
    );

    expect(parsed.rideType).toBe('some_new_classification');
  });

  it('rejects a workoutType outside the accepted vocabulary on the write side only', () => {
    // We *send* one of these, so a wrong value there is our bug and should be
    // loud. A read is different: the server adds types on its own schedule,
    // and a response is never ours to refuse over a type we do not know.
    expect(PlanMyPeakKnownWorkoutTypeSchema.safeParse('cycling').success).toBe(
      false
    );
    expect(
      PlanMyPeakCreateWorkoutResponseSchema.parse(
        workoutPayload({ workoutType: 'cycling' })
      ).workoutType
    ).toBe('cycling');
  });
});

describe('getCoachTrainingPeaksExternalId', () => {
  it('returns the training_peaks externalId when present', () => {
    const coach = PlanMyPeakCoachSchema.parse({
      id: '99c02f5a-547d-4b15-b201-2d14e6690368',
      email: '1@gmail.com',
      firstName: 'Athlete coach',
      lastName: 'Rodrigues',
      externalIds: [{ providerCode: 'training_peaks', externalId: '6469888' }],
    });
    expect(getCoachTrainingPeaksExternalId(coach)).toBe('6469888');
  });

  it('returns null when there is no training_peaks link', () => {
    const coach = PlanMyPeakCoachSchema.parse({
      id: 'abc',
      externalIds: [{ providerCode: 'strava', externalId: '42' }],
    });
    expect(getCoachTrainingPeaksExternalId(coach)).toBeNull();
  });

  it('returns null for missing externalIds or null coach', () => {
    expect(
      getCoachTrainingPeaksExternalId(PlanMyPeakCoachSchema.parse({ id: 'x' }))
    ).toBeNull();
    expect(getCoachTrainingPeaksExternalId(null)).toBeNull();
  });
});

describe('planMyPeakApi schemas - unknown workout types', () => {
  /** A plan entry wrapping the given workout, as GET /workout-plans/:id returns it. */
  function entryPayload(workout: Record<string, unknown>) {
    return {
      id: 'entry-1',
      planId: 'plan-1',
      weekNumber: 3,
      dayOfWeek: 7,
      position: 0,
      note: null,
      workout,
      provider: 'training_peaks',
      providerEntryId: 'event-987',
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z',
    };
  }

  it('parses a plan read whose entries include an event workout', () => {
    const parsed = PlanMyPeakPlanDetailSchema.parse({
      id: 'plan-1',
      name: 'Marathon build',
      description: null,
      weekCount: 12,
      entryCount: 1,
      library: { id: 'plib-1', name: 'Road' },
      provider: 'training_peaks',
      providerPlanId: '100',
      providerMetadata: null,
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z',
      entries: [
        entryPayload(
          workoutPayload({
            id: 'wk-event',
            name: 'City Marathon',
            workoutType: 'event',
            rideType: null,
            summary: {
              segmentCount: 0,
              stepCount: 0,
              estimatedDurationSeconds: null,
            },
            providerWorkoutId: 'event-987',
            providerMetadata: {
              eventType: 'Running',
              distance: 42.195,
              distanceUnits: 'km',
            },
          })
        ),
      ],
    });

    expect(parsed.entries[0].workout.workoutType).toBe('event');
  });

  it('parses a library listing that contains a workout type this build does not know', () => {
    const parsed = PlanMyPeakWorkoutLibraryResponseSchema.parse({
      data: [workoutPayload({ workoutType: 'trail_run' }), workoutPayload()],
      pagination: { limit: 25, offset: 0, total: 2 },
      facets: {
        workoutType: { trail_run: 1, bike: 1 },
        rideType: {},
        duration: {},
        total: 2,
        incomplete: false,
      },
    });

    expect(parsed.data.map((row) => row.workoutType)).toEqual([
      'trail_run',
      'bike',
    ]);
  });

  it('still rejects an empty workout type', () => {
    expect(() =>
      PlanMyPeakCreateWorkoutResponseSchema.parse(
        workoutPayload({ workoutType: '' })
      )
    ).toThrow();
  });

  it('keeps the write-side discipline list closed', () => {
    expect(PlanMyPeakKnownWorkoutTypeSchema.safeParse('event').success).toBe(
      false
    );
    expect(PlanMyPeakKnownWorkoutTypeSchema.safeParse('bike').success).toBe(
      true
    );
    expect(isKnownPlanMyPeakWorkoutType('event')).toBe(false);
    expect(isKnownPlanMyPeakWorkoutType('rest_day')).toBe(true);
  });

  it('labels known types properly and unknown ones generically', () => {
    expect(formatPlanMyPeakWorkoutTypeLabel('mountain_bike')).toBe(
      'Mountain bike'
    );
    expect(formatPlanMyPeakWorkoutTypeLabel('event')).toBe('Event');
    expect(formatPlanMyPeakWorkoutTypeLabel('trail_run')).toBe('Trail run');
    expect(formatPlanMyPeakWorkoutTypeLabel('  ')).toBe('Unknown');
  });
});
