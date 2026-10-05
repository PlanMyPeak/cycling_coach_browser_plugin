/**
 * Zod schemas for the PlanMyPeak raw training-plan import
 * (`/imports/training-peaks/plans`).
 *
 * The extension sends TrainingPeaks' JSON untouched and the server converts
 * it; what comes back is status, counts and per-item outcomes, never the
 * payload. These schemas validate that read side. Vocabularies the server
 * may grow on its own (item kinds, outcomes, error codes) are loose strings;
 * the import status is closed because the poll loop has to know when to stop.
 */

import { z } from 'zod';

const NonNegativeIntSchema = z.coerce.number().int().min(0);

/** The kinds a part may carry. Each part holds items of one kind. */
export const PLAN_IMPORT_PART_KINDS = [
  'plan_workouts',
  'calendar_notes',
  'calendar_events',
  'rx_workouts',
] as const;

export type PlanImportPartKind = (typeof PLAN_IMPORT_PART_KINDS)[number];

export const PLAN_IMPORT_STATUSES = [
  'staging',
  'queued',
  'processing',
  'completed',
  'completed_with_issues',
  'failed',
  'abandoned',
] as const;

export const PlanImportStatusSchema = z.enum(PLAN_IMPORT_STATUSES);

export type PlanImportStatus = z.infer<typeof PlanImportStatusSchema>;

const TERMINAL_STATUSES: ReadonlySet<PlanImportStatus> = new Set([
  'completed',
  'completed_with_issues',
  'failed',
  'abandoned',
]);

/** Whether polling can stop: the server will not change this import again. */
export function isTerminalPlanImportStatus(status: PlanImportStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Per-item outcomes the server reports. `not_supported` (RxBuilder sessions)
 * and `superseded` (an older snapshot skipped in favour of a newer one) are
 * clean outcomes, not errors.
 */
export const PLAN_IMPORT_OUTCOMES = [
  'created',
  'updated',
  'superseded',
  'imported_without_structure',
  'skipped',
  'failed',
  'not_supported',
] as const;

export type PlanImportOutcome = (typeof PLAN_IMPORT_OUTCOMES)[number];

/** Declared at begin, echoed back as received. Keys match the request. */
export const PlanImportCountsSchema = z.object({
  planWorkouts: NonNegativeIntSchema,
  calendarNotes: NonNegativeIntSchema,
  calendarEvents: NonNegativeIntSchema,
  rxWorkouts: NonNegativeIntSchema,
});

export type PlanImportCounts = z.infer<typeof PlanImportCountsSchema>;

/**
 * Counts per outcome. Every known outcome defaults to zero so a consumer can
 * read any of them without a guard; an outcome this build does not know is
 * kept alongside rather than rejected.
 */
export const PlanImportOutcomeCountsSchema = z
  .object({
    created: NonNegativeIntSchema.default(0),
    updated: NonNegativeIntSchema.default(0),
    superseded: NonNegativeIntSchema.default(0),
    imported_without_structure: NonNegativeIntSchema.default(0),
    skipped: NonNegativeIntSchema.default(0),
    failed: NonNegativeIntSchema.default(0),
    not_supported: NonNegativeIntSchema.default(0),
  })
  .passthrough();

export type PlanImportOutcomeCounts = z.infer<
  typeof PlanImportOutcomeCountsSchema
>;

/** One item the server could not import cleanly. `message` is coach-safe. */
export const PlanImportIssueSchema = z.object({
  kind: z.string(),
  trainingPeaksId: z.string().nullable(),
  title: z.string().nullable(),
  outcome: z.string(),
  code: z.string(),
  message: z.string(),
  path: z.string().nullable(),
});

export type PlanImportIssue = z.infer<typeof PlanImportIssueSchema>;

export const PlanImportSummarySchema = z.object({
  workoutPlanId: z.string().nullable(),
  outcomes: PlanImportOutcomeCountsSchema,
  /** Keyed by the server's item kinds (`plan_workout`, `calendar_note`, …). */
  byKind: z.record(z.string(), PlanImportOutcomeCountsSchema),
});

export type PlanImportSummary = z.infer<typeof PlanImportSummarySchema>;

/**
 * `TrainingPeaksPlanImportResponse`: returned by begin, complete, abandon and
 * the read route alike. `summary` is null until processing has run.
 */
export const PlanImportResponseSchema = z.object({
  importId: z.string(),
  status: PlanImportStatusSchema,
  environment: z.string(),
  trainingPeaksPlanId: z.number(),
  declaredCounts: PlanImportCountsSchema,
  receivedCounts: PlanImportCountsSchema,
  failureCode: z.string().nullable(),
  summary: PlanImportSummarySchema.nullable(),
  issues: z.array(PlanImportIssueSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PlanImportResponse = z.infer<typeof PlanImportResponseSchema>;

/** Response to recording one part. `alreadyRecorded` marks an idempotent retry. */
export const PlanImportPartResponseSchema = z.object({
  importId: z.string(),
  kind: z.string(),
  partIndex: NonNegativeIntSchema,
  itemCount: NonNegativeIntSchema,
  alreadyRecorded: z.boolean(),
  receivedCounts: PlanImportCountsSchema,
});

export type PlanImportPartResponse = z.infer<
  typeof PlanImportPartResponseSchema
>;

// ---------------------------------------------------------------------------
// Error bodies
// ---------------------------------------------------------------------------

/** The shared API error shape; `details` is route-specific and read below. */
export const PlanImportErrorBodySchema = z
  .object({
    code: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
    details: z.unknown().optional(),
  })
  .passthrough();

/** 409 on begin: another import of the same plan is still active. */
export const PlanImportActiveConflictSchema = z.object({
  reason: z.literal('active_import'),
  activeImportId: z.string(),
  activeImportStatus: PlanImportStatusSchema,
  /**
   * When the active import last recorded a part or changed status. Absent on
   * an older server, which the client must read as "recent": a staging
   * import may be another window's upload in progress.
   */
  activeImportLastActivityAt: z.string().nullable().optional(),
});

export type PlanImportActiveConflict = z.infer<
  typeof PlanImportActiveConflictSchema
>;

/** 409 on complete: fewer or more items arrived than begin declared. */
export const PlanImportCountMismatchSchema = z.object({
  reason: z.literal('count_mismatch'),
  declaredCounts: PlanImportCountsSchema,
  receivedCounts: PlanImportCountsSchema,
});

/** 400 on any route: a size cap was exceeded. `cap` names which. */
export const PlanImportCapExceededSchema = z.object({
  reason: z.literal('cap_exceeded'),
  cap: z.string(),
  limit: NonNegativeIntSchema,
  itemIndex: NonNegativeIntSchema.optional(),
});
