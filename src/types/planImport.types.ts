/**
 * Types shared by the raw training-plan import's background runner and the
 * popup/overlay flow that drives it.
 */

import type {
  PlanImportIssue,
  PlanImportOutcomeCounts,
  PlanImportResponse,
  PlanImportStatus,
} from '@/schemas/planMyPeakPlanImport.schema';

/**
 * What the background reports after trying to start a raw import.
 *
 * - `queued`: begin, every part and complete were acknowledged; poll `importId`.
 * - `legacy_required`: the destination answered 404 to begin, so it predates
 *   the raw routes and the client-side conversion must run instead.
 * - `active_import`: the plan already has an import. Queued or processing:
 *   the caller polls that one rather than starting another. Staging with
 *   recent activity: another window may still be uploading it, so the
 *   caller asks the coach before sending `abandonImportId` on a retry.
 */
export type RawPlanImportStart =
  | { outcome: 'queued'; importId: string; response: PlanImportResponse }
  | { outcome: 'legacy_required' }
  | {
      outcome: 'active_import';
      activeImportId: string;
      activeImportStatus: PlanImportStatus;
      /** Last part or status change, ISO; null/absent means unknown. */
      activeImportLastActivityAt?: string | null;
    };

/** The server's verdict on one import, kept on the export result for display. */
export interface PlanImportReport {
  importId: string;
  status: PlanImportStatus;
  failureCode: string | null;
  outcomes: PlanImportOutcomeCounts;
  byKind: Record<string, PlanImportOutcomeCounts>;
  issues: PlanImportIssue[];
}
