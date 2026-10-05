/**
 * Splitting native TrainingPeaks items into import parts.
 *
 * Pure: no I/O, and no item is ever copied, reshaped or reordered — a part
 * holds references to the same objects `response.json()` produced, in the
 * order they arrived. Only the grouping is decided here.
 */

import type {
  PlanImportCounts,
  PlanImportPartKind,
} from '@/schemas/planMyPeakPlanImport.schema';
import type { NativeTrainingPlanSources } from '@/background/api/trainingPeaks';

/** The server's per-part item cap. */
export const PLAN_IMPORT_MAX_PART_ITEMS = 50;

/**
 * Serialized-size budget per part. The server caps a request at 2 500 000
 * bytes measured on the fully encoded API Gateway event, so the budget leaves
 * headroom for envelope and JSON-string escaping.
 */
export const PLAN_IMPORT_MAX_PART_BYTES = 2_300_000;

/** Bytes for the request envelope around `items` (`kind`, `partIndex`, braces). */
const PART_ENVELOPE_BYTES = 128;

export interface PlanImportPartLimits {
  maxItems: number;
  maxBytes: number;
}

export interface PlanImportPart {
  kind: PlanImportPartKind;
  partIndex: number;
  items: unknown[];
  /** Serialized size of `items`, for logging and tests. */
  byteSize: number;
}

const encoder = new TextEncoder();

/** UTF-8 byte length of the item's JSON, which is what the server measures. */
export function serializedItemBytes(item: unknown): number {
  return encoder.encode(JSON.stringify(item)).length;
}

/**
 * Group one kind's items into parts under the item and byte limits.
 *
 * Greedy and order-preserving. An item that alone exceeds the byte budget is
 * sent in a part of its own rather than dropped: the server will refuse it
 * naming the cap and the item, and that refusal is the honest outcome. The
 * extension has no business trimming the item to make it fit.
 */
export function splitIntoPlanImportParts(
  kind: PlanImportPartKind,
  items: readonly unknown[],
  limits: PlanImportPartLimits = {
    maxItems: PLAN_IMPORT_MAX_PART_ITEMS,
    maxBytes: PLAN_IMPORT_MAX_PART_BYTES,
  }
): PlanImportPart[] {
  const parts: PlanImportPart[] = [];
  let current: unknown[] = [];
  let currentBytes = PART_ENVELOPE_BYTES;

  const flush = (): void => {
    if (current.length === 0) {
      return;
    }
    parts.push({
      kind,
      partIndex: parts.length,
      items: current,
      byteSize: currentBytes,
    });
    current = [];
    currentBytes = PART_ENVELOPE_BYTES;
  };

  for (const item of items) {
    // +1 for the separating comma.
    const itemBytes = serializedItemBytes(item) + 1;
    const wouldOverflow =
      current.length >= limits.maxItems ||
      (current.length > 0 && currentBytes + itemBytes > limits.maxBytes);

    if (wouldOverflow) {
      flush();
    }

    current.push(item);
    currentBytes += itemBytes;
  }

  flush();
  return parts;
}

/** Declared counts for begin: one per kind, straight from the native lists. */
export function declaredCountsFor(
  sources: Pick<
    NativeTrainingPlanSources,
    'planWorkouts' | 'calendarNotes' | 'calendarEvents' | 'rxWorkouts'
  >
): PlanImportCounts {
  return {
    planWorkouts: sources.planWorkouts.length,
    calendarNotes: sources.calendarNotes.length,
    calendarEvents: sources.calendarEvents.length,
    rxWorkouts: sources.rxWorkouts.length,
  };
}

/** Every part of every kind, in the order they should be sent. */
export function splitSourcesIntoParts(
  sources: Pick<
    NativeTrainingPlanSources,
    'planWorkouts' | 'calendarNotes' | 'calendarEvents' | 'rxWorkouts'
  >,
  limits?: PlanImportPartLimits
): PlanImportPart[] {
  return [
    ...splitIntoPlanImportParts('plan_workouts', sources.planWorkouts, limits),
    ...splitIntoPlanImportParts(
      'calendar_notes',
      sources.calendarNotes,
      limits
    ),
    ...splitIntoPlanImportParts(
      'calendar_events',
      sources.calendarEvents,
      limits
    ),
    ...splitIntoPlanImportParts('rx_workouts', sources.rxWorkouts, limits),
  ];
}

/** Sum of items across parts, for progress totals. */
export function totalPartItems(parts: readonly PlanImportPart[]): number {
  return parts.reduce((total, part) => total + part.items.length, 0);
}
