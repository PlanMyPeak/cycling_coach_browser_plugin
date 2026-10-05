/**
 * Zod schemas for the PlanMyPeak coach workout-library API.
 *
 * These mirror the published contract (`CoachWorkoutSummary`,
 * `CoachWorkoutDetail`, `WorkoutLibrarySummary` in the PlanMyPeak
 * `packages/contracts` OpenAPI schemas) rather than accepting both camelCase
 * and snake_case: the contract is fixed and published, so tolerating both
 * shapes would only hide drift.
 */

import { z } from 'zod';

const IntegerSchema = z.coerce.number().int();
const NonNegativeIntSchema = IntegerSchema.min(0);
const NumberSchema = z.coerce.number();

/**
 * A workout library — the container. `/workout-libraries` returns these;
 * `/workout-library` returns the workouts inside them.
 */
export const PlanMyPeakLibrarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isDefault: z.boolean(),
  workoutCount: NonNegativeIntSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PlanMyPeakLibrary = z.infer<typeof PlanMyPeakLibrarySchema>;

export const PlanMyPeakLibrariesResponseSchema = z.object({
  data: z.array(PlanMyPeakLibrarySchema),
});

export type PlanMyPeakLibrariesResponse = z.infer<
  typeof PlanMyPeakLibrariesResponseSchema
>;

/**
 * Disciplines this extension sends. The list is exact on the **write** side:
 * a create request carries one of these and nothing else.
 */
export const PLANMYPEAK_WORKOUT_TYPES = [
  'bike',
  'mountain_bike',
  'run',
  'swim',
  'walk',
  'strength',
  'cross_train',
  'cross_country_ski',
  'rowing',
  'race',
  'rest_day',
  'note',
  'other',
] as const;

/** Write side: the discipline a create request may carry. */
export const PlanMyPeakKnownWorkoutTypeSchema = z.enum(
  PLANMYPEAK_WORKOUT_TYPES
);

export type PlanMyPeakWorkoutTypeValue = z.infer<
  typeof PlanMyPeakKnownWorkoutTypeSchema
>;

/**
 * Read side: **tolerant** of disciplines this build does not know.
 *
 * The server adds workout types on its own schedule — `event` arrived with the
 * raw plan import, which writes it for TrainingPeaks calendar events — and a
 * read that rejects an unknown one fails the whole response: one such row in
 * a library listing or a plan's entries would hide the coach's entire library
 * or break a re-import. We only ever display a type we did not send, so an
 * unknown value costs a generic label, not a parse failure. Never use this
 * for what we send; that stays `PlanMyPeakKnownWorkoutTypeSchema`.
 */
export const PlanMyPeakWorkoutTypeSchema = z.string().min(1);

export type PlanMyPeakWorkoutTypeRead = z.infer<
  typeof PlanMyPeakWorkoutTypeSchema
>;

export function isKnownPlanMyPeakWorkoutType(
  value: string
): value is PlanMyPeakWorkoutTypeValue {
  return (PLANMYPEAK_WORKOUT_TYPES as readonly string[]).includes(value);
}

const PLANMYPEAK_WORKOUT_TYPE_LABELS: Record<
  PlanMyPeakWorkoutTypeValue,
  string
> = {
  bike: 'Bike',
  mountain_bike: 'Mountain bike',
  run: 'Run',
  swim: 'Swim',
  walk: 'Walk',
  strength: 'Strength',
  cross_train: 'Cross train',
  cross_country_ski: 'Cross-country ski',
  rowing: 'Rowing',
  race: 'Race',
  rest_day: 'Rest day',
  note: 'Note',
  other: 'Other',
};

/**
 * Display label for a workout type read back from PlanMyPeak.
 *
 * Known types get their proper label; anything else is rendered generically
 * from its code (`event` → "Event", `trail_run` → "Trail run") so a type this
 * build predates still reads as a discipline rather than an error.
 */
export function formatPlanMyPeakWorkoutTypeLabel(value: string): string {
  if (isKnownPlanMyPeakWorkoutType(value)) {
    return PLANMYPEAK_WORKOUT_TYPE_LABELS[value];
  }

  const words = value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (words.length === 0) {
    return 'Unknown';
  }

  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Counts derived from the structure. `stepCount` is post-expansion. */
const PlanMyPeakDerivedSummarySchema = z.object({
  segmentCount: NonNegativeIntSchema,
  stepCount: NonNegativeIntSchema,
  estimatedDurationSeconds: NumberSchema.nullable(),
});

/**
 * Intensity profile, or null when the structure yields none.
 *
 * Values are never absolute — no watts, no bpm — because a library workout
 * belongs to a coach and has no athlete to convert against. **Read `unit`
 * before formatting**: three of the four are percentages, but `scale10` is a
 * point on the 1-10 RPE scale, so appending "%" would render a maximal effort
 * as "9%". That is why the field is `intensity` rather than a percent.
 */
const PlanMyPeakWorkoutProfileSchema = z.object({
  metric: z.enum(['power', 'heartrate', 'rpe']),
  unit: z.enum([
    'percentOfFtp',
    'percentOfThresholdHr',
    'percentOfMaxHr',
    'scale10',
  ]),
  segments: z.array(
    z.object({ intensity: NumberSchema, seconds: NumberSchema })
  ),
  durationSeconds: NumberSchema,
  /**
   * Null for a workout with no derivable load and no provider figure — a
   * heart-rate or effort-rated session has no normalized power behind it, and
   * the server will not estimate. Guard before formatting: this is never 0
   * standing in for "unknown".
   */
  intensityFactor: NumberSchema.nullable(),
  tss: NumberSchema.nullable(),
  /**
   * Whether the load above is ours (`derived`) or came from the provider that
   * supplied the workout (`provider`). Never present a provider figure as a
   * derived one. Null exactly when there is no load.
   */
  loadSource: z.enum(['derived', 'provider']).nullable(),
  peakIntensity: NumberSchema,
});

export type PlanMyPeakWorkoutProfile = z.infer<
  typeof PlanMyPeakWorkoutProfileSchema
>;

/** The library a workout is actually filed in, on every read and write. */
const PlanMyPeakLibraryRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});

/**
 * A workout as PlanMyPeak returns it.
 *
 * `rideType` is deliberately a loose string rather than an enum: the server
 * derives it and may add vocabulary, and we only ever display it. The same
 * holds for `workoutType` on a read — see `PlanMyPeakWorkoutTypeSchema`.
 * `structure` is present on detail reads and absent from list rows.
 */
export const PlanMyPeakWorkoutLibraryItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  workoutType: PlanMyPeakWorkoutTypeSchema,
  rideType: z.string().nullable(),
  summary: PlanMyPeakDerivedSummarySchema,
  profile: PlanMyPeakWorkoutProfileSchema.nullable(),
  library: PlanMyPeakLibraryRefSchema,
  provider: z.string().nullable(),
  providerWorkoutId: z.string().nullable(),
  providerMetadata: z.record(z.string(), z.unknown()).nullable(),
  /**
   * Load figures we passed through from TrainingPeaks, readable back so a write
   * can be verified — relevant because undeclared keys are stripped rather than
   * rejected on some paths.
   */
  providerIntensityFactor: NumberSchema.nullable(),
  providerTss: NumberSchema.nullable(),
  structure: z.unknown().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PlanMyPeakWorkoutLibraryItem = z.infer<
  typeof PlanMyPeakWorkoutLibraryItemSchema
>;

/**
 * Response from a workout write. The body is identical for a create and an
 * update — the HTTP status (201 vs 200) is what distinguishes them.
 */
export const PlanMyPeakCreateWorkoutResponseSchema =
  PlanMyPeakWorkoutLibraryItemSchema;

const PlanMyPeakPaginationSchema = z.object({
  limit: NonNegativeIntSchema,
  offset: NonNegativeIntSchema,
  total: NonNegativeIntSchema,
});

/**
 * Facet counts. Each group is counted against the search and the *other*
 * groups' filters but never its own selection, so these do not sum to
 * `pagination.total`. `incomplete` means the library outgrew the bounded scan
 * the counts came from.
 */
const PlanMyPeakFacetCountsSchema = z.object({
  workoutType: z.record(z.string(), IntegerSchema),
  rideType: z.record(z.string(), IntegerSchema),
  duration: z.record(z.string(), IntegerSchema),
  total: NonNegativeIntSchema,
  incomplete: z.boolean(),
});

export const PlanMyPeakWorkoutLibraryResponseSchema = z.object({
  data: z.array(PlanMyPeakWorkoutLibraryItemSchema),
  pagination: PlanMyPeakPaginationSchema,
  facets: PlanMyPeakFacetCountsSchema,
});

export type PlanMyPeakWorkoutLibraryResponse = z.infer<
  typeof PlanMyPeakWorkoutLibraryResponseSchema
>;

/**
 * A training-plan library — the container plans live in.
 *
 * Distinct from a *workout* library. The server has three paths one word apart:
 * `/workout-library` holds workouts, `/workout-libraries` their containers, and
 * `/workout-plan-libraries` the containers for plans.
 */
export const PlanMyPeakPlanLibrarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isDefault: z.boolean(),
  planCount: NonNegativeIntSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PlanMyPeakPlanLibrary = z.infer<typeof PlanMyPeakPlanLibrarySchema>;

export const PlanMyPeakPlanLibrariesResponseSchema = z.object({
  data: z.array(PlanMyPeakPlanLibrarySchema),
});

/**
 * One scheduled session in a plan.
 *
 * `provider` / `providerEntryId` are null for a session a coach scheduled by
 * hand; an import never adopts those. The identity is stable across a move, so
 * a session that shifts day keeps its id — and its `note`, which the coach may
 * have written and which an import must not destroy.
 */
export const PlanMyPeakPlanEntrySchema = z.object({
  id: z.string(),
  planId: z.string(),
  weekNumber: IntegerSchema,
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  dayOfWeek: IntegerSchema,
  position: NonNegativeIntSchema,
  note: z.string().nullable(),
  workout: PlanMyPeakWorkoutLibraryItemSchema,
  provider: z.string().nullable(),
  providerEntryId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PlanMyPeakPlanEntry = z.infer<typeof PlanMyPeakPlanEntrySchema>;

const PlanMyPeakPlanBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  weekCount: IntegerSchema,
  entryCount: NonNegativeIntSchema,
  library: z.object({ id: z.string(), name: z.string() }),
  provider: z.string().nullable(),
  providerPlanId: z.string().nullable(),
  providerMetadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PlanMyPeakPlanSummarySchema = PlanMyPeakPlanBaseSchema;

/** A plan with its schedule, in week/weekday/position order. */
export const PlanMyPeakPlanDetailSchema = PlanMyPeakPlanBaseSchema.extend({
  entries: z.array(PlanMyPeakPlanEntrySchema),
});

export type PlanMyPeakPlanSummary = z.infer<typeof PlanMyPeakPlanSummarySchema>;
export type PlanMyPeakPlanDetail = z.infer<typeof PlanMyPeakPlanDetailSchema>;

export const PlanMyPeakPlansResponseSchema = z.object({
  data: z.array(PlanMyPeakPlanSummarySchema),
  pagination: z.object({
    limit: NonNegativeIntSchema,
    offset: NonNegativeIntSchema,
    total: NonNegativeIntSchema,
  }),
});

/**
 * Per-group result returned by the TrainingPeaks athlete-group ingest endpoint.
 */
export const PlanMyPeakIngestedAthleteGroupSchema = z
  .object({
    trainingPeaksGroupId: z.string(),
    name: z.string(),
    valueId: z.string().optional(),
    isDefault: z.boolean().optional(),
    athletesAssociated: NonNegativeIntSchema.optional(),
    skippedAthleteIds: z.array(z.string()).optional(),
  })
  .passthrough();

/**
 * Response from POST /athlete-tags/ingest/training-peaks.
 * Summarizes how many groups/athletes were ingested and which athletes were
 * skipped (e.g. TrainingPeaks athletes with no matching PlanMyPeak athlete).
 */
export const PlanMyPeakIngestAthleteGroupsResponseSchema = z
  .object({
    groupsProcessed: NonNegativeIntSchema.optional(),
    athletesAssociated: NonNegativeIntSchema.optional(),
    skippedAthleteIds: z.array(z.string()).optional(),
    groups: z.array(PlanMyPeakIngestedAthleteGroupSchema).optional(),
  })
  .passthrough();

export type PlanMyPeakIngestedAthleteGroup = z.infer<
  typeof PlanMyPeakIngestedAthleteGroupSchema
>;

export type PlanMyPeakIngestAthleteGroupsResponse = z.infer<
  typeof PlanMyPeakIngestAthleteGroupsResponseSchema
>;

/**
 * A linked external provider account on a PlanMyPeak coach profile
 * (e.g. providerCode "training_peaks" with the TrainingPeaks user id).
 */
export const PlanMyPeakCoachExternalIdSchema = z
  .object({
    providerCode: z.string(),
    externalId: z.string(),
  })
  .passthrough();

/**
 * PlanMyPeak coach profile from GET /api/backend/coaches/me.
 * Permissive: only the fields the extension needs are typed.
 */
export const PlanMyPeakCoachSchema = z
  .object({
    id: z.string(),
    email: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    role: z.string().optional(),
    externalIds: z.array(PlanMyPeakCoachExternalIdSchema).optional(),
  })
  .passthrough();

export type PlanMyPeakCoachExternalId = z.infer<
  typeof PlanMyPeakCoachExternalIdSchema
>;
export type PlanMyPeakCoach = z.infer<typeof PlanMyPeakCoachSchema>;

/** Provider code used by PlanMyPeak for linked TrainingPeaks accounts. */
export const TRAINING_PEAKS_PROVIDER_CODE = 'training_peaks';

/**
 * Extract the TrainingPeaks user id a coach profile is linked to, if any.
 */
export function getCoachTrainingPeaksExternalId(
  coach: PlanMyPeakCoach | null | undefined
): string | null {
  const match = coach?.externalIds?.find(
    (entry) => entry.providerCode === TRAINING_PEAKS_PROVIDER_CODE
  );
  return match?.externalId ?? null;
}
