/**
 * Turning a terminal raw-import response into the extension's `ExportResult`.
 *
 * Pure, and shared by the popup and the overlay so both surfaces read the
 * same server verdict the same way.
 */

import type {
  PlanImportOutcomeCounts,
  PlanImportResponse,
} from '@/schemas/planMyPeakPlanImport.schema';
import type { PlanImportReport } from '@/types/planImport.types';
import type { ExportResult, ValidationMessage } from '../base';

/** Server item kinds that are placed in the plan, in display order. */
const PLACED_KINDS = [
  'plan_workout',
  'calendar_note',
  'calendar_event',
] as const;

const KIND_LABELS: Record<string, string> = {
  plan: 'Plan',
  plan_folders: 'Plan folders',
  plan_workout: 'Workout',
  calendar_note: 'Note',
  calendar_event: 'Event',
  rx_workout: 'Strength-builder session',
};

export const OUTCOME_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  superseded: 'Already newer in PlanMyPeak',
  imported_without_structure: 'Imported without structure',
  skipped: 'Skipped',
  failed: 'Failed',
  not_supported: 'Not supported',
};

export function planImportKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, ' ');
}

export function planImportOutcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? outcome.replace(/_/g, ' ');
}

function landedCount(counts: PlanImportOutcomeCounts): number {
  return (
    counts.created +
    counts.updated +
    counts.superseded +
    counts.imported_without_structure
  );
}

/**
 * How many sessions the plan now holds from this import: every placed kind's
 * items that were created, updated, left as a newer copy, or imported
 * without a structure. Plan and folder rows are not sessions and are not
 * counted.
 */
export function importedSessionCount(response: PlanImportResponse): number {
  const summary = response.summary;
  if (!summary) {
    return 0;
  }

  const placed = PLACED_KINDS.filter((kind) => kind in summary.byKind);
  if (placed.length === 0) {
    return landedCount(summary.outcomes);
  }

  return placed.reduce(
    (total, kind) => total + landedCount(summary.byKind[kind]),
    0
  );
}

export function planImportReportFrom(
  response: PlanImportResponse
): PlanImportReport {
  return {
    importId: response.importId,
    status: response.status,
    failureCode: response.failureCode,
    outcomes: response.summary?.outcomes ?? {
      created: 0,
      updated: 0,
      superseded: 0,
      imported_without_structure: 0,
      skipped: 0,
      failed: 0,
      not_supported: 0,
    },
    byKind: response.summary?.byKind ?? {},
    issues: response.issues,
  };
}

/** One warning line per issue, with the server's message verbatim. */
export function planImportIssueMessage(
  issue: PlanImportResponse['issues'][number]
): string {
  const subject = issue.title?.trim() || issue.trainingPeaksId || 'item';
  const where = issue.path ? ` [${issue.path}]` : '';
  return `${planImportKindLabel(issue.kind)} "${subject}" — ${planImportOutcomeLabel(
    issue.outcome
  )}: ${issue.message}${where}`;
}

/**
 * The `ExportResult` for a terminal import.
 *
 * `completed` and `completed_with_issues` are successes: the plan is there,
 * and the issues say which sessions need attention. `failed` and
 * `abandoned` are not. `superseded` and `not_supported` are clean by the
 * server's definition, but a coach still wants to know that strength-builder
 * sessions did not come across, so that count becomes a warning.
 */
export function exportResultFromPlanImport(
  response: PlanImportResponse,
  planName: string,
  warnings: ValidationMessage[] = []
): ExportResult {
  const report = planImportReportFrom(response);
  const allWarnings: ValidationMessage[] = [...warnings];

  for (const issue of response.issues) {
    if (issue.outcome === 'failed' && response.status === 'failed') {
      continue; // listed under errors below
    }
    allWarnings.push({
      field: `${issue.kind}:${issue.trainingPeaksId ?? '?'}`,
      severity: 'warning',
      message: planImportIssueMessage(issue),
    });
  }

  const notSupported = report.outcomes.not_supported;
  if (notSupported > 0) {
    allWarnings.push({
      field: 'rx_workout',
      severity: 'warning',
      message: `${notSupported} strength-builder session${
        notSupported === 1 ? ' was' : 's were'
      } not imported: TrainingPeaks RxBuilder workouts are not supported yet.`,
    });
  }

  const base = {
    fileName: planName,
    format: 'api',
    warnings: allWarnings,
    planImport: report,
  };

  switch (response.status) {
    case 'completed':
    case 'completed_with_issues':
      return {
        ...base,
        success: true,
        itemsExported: importedSessionCount(response),
      };

    case 'failed':
      return {
        ...base,
        success: false,
        itemsExported: importedSessionCount(response),
        errors: [
          `PlanMyPeak could not finish importing "${planName}"${
            response.failureCode ? ` (${response.failureCode})` : ''
          }. Nothing more is needed from TrainingPeaks; try the import again later.`,
          ...response.issues
            .filter((issue) => issue.outcome === 'failed')
            .map(planImportIssueMessage),
        ],
      };

    case 'abandoned':
      return {
        ...base,
        success: false,
        itemsExported: 0,
        errors: [
          `The import of "${planName}" was abandoned before PlanMyPeak processed it.`,
        ],
      };

    default:
      // Not terminal; callers poll before mapping. Report it rather than
      // pretend either way.
      return {
        ...base,
        success: false,
        itemsExported: 0,
        errors: [
          `PlanMyPeak is still processing "${planName}" (status: ${response.status}).`,
        ],
      };
  }
}
