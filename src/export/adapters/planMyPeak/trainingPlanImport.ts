/**
 * PlanMyPeak training-plan import, shared by the popup and the overlay.
 *
 * Preferred path: the background forwards the plan's native TrainingPeaks
 * payloads to PlanMyPeak (`START_PLANMYPEAK_PLAN_IMPORT`), the server converts
 * them, and this flow polls until it is done and renders the server's
 * per-item outcomes. Fallback: a destination that answers 404 to begin
 * predates the raw routes, and the legacy client-side conversion in
 * `trainingPlanExport.ts` runs unchanged.
 *
 * Both surfaces call this one function so they cannot drift on when to fall
 * back, how to poll, or how to read a result.
 */

import type {
  GetPlanMyPeakPlanImportMessage,
  StartPlanMyPeakPlanImportMessage,
  TrainingPlanExportProgressPayload,
} from '@/types';
import type { ApiResponse } from '@/types/api.types';
import type { RawPlanImportStart } from '@/types/planImport.types';
import type { PlanImportResponse } from '@/schemas/planMyPeakPlanImport.schema';
import { planMyPeakAuthFailureFromCode } from '@/utils/planMyPeakAuthErrors';
import type {
  ExportResult as ExportResultType,
  ValidationMessage,
} from '../base';
import { authRunField } from './transport';
import {
  exportTrainingPlanClassicWorkoutsToPlanMyPeak,
  type ExportTrainingPlanClassicWorkoutsToPlanMyPeakOptions,
} from './trainingPlanExport';
import { pollPlanImportUntilTerminal } from './planImportPolling';
import { exportResultFromPlanImport } from './planImportResult';

/** How the flow reaches the background; swapped for a fake in tests. */
export interface PlanImportTransport {
  start(input: {
    planId: number;
    targetWorkoutLibraryId?: string | null;
    abandonImportId?: string;
    authRunId?: string;
  }): Promise<ApiResponse<RawPlanImportStart>>;
  getStatus(input: {
    importId: string;
    authRunId?: string;
  }): Promise<ApiResponse<PlanImportResponse>>;
}

export const runtimePlanImportTransport: PlanImportTransport = {
  start: ({ planId, targetWorkoutLibraryId, abandonImportId, authRunId }) =>
    chrome.runtime.sendMessage<
      StartPlanMyPeakPlanImportMessage,
      ApiResponse<RawPlanImportStart>
    >({
      type: 'START_PLANMYPEAK_PLAN_IMPORT',
      planId,
      ...(targetWorkoutLibraryId ? { targetWorkoutLibraryId } : {}),
      ...(abandonImportId ? { abandonImportId } : {}),
      ...authRunField(authRunId),
    }),
  getStatus: ({ importId, authRunId }) =>
    chrome.runtime.sendMessage<
      GetPlanMyPeakPlanImportMessage,
      ApiResponse<PlanImportResponse>
    >({
      type: 'GET_PLANMYPEAK_PLAN_IMPORT',
      importId,
      ...authRunField(authRunId),
    }),
};

export interface ImportTrainingPlanToPlanMyPeakOptions extends ExportTrainingPlanClassicWorkoutsToPlanMyPeakOptions {
  transport?: PlanImportTransport;
  sleep?: (ms: number) => Promise<void>;
  /** The legacy path, injectable so tests can prove it is reached unchanged. */
  legacyExport?: (
    options: ExportTrainingPlanClassicWorkoutsToPlanMyPeakOptions
  ) => Promise<ExportResultType>;
  /**
   * Asked when the plan has a staging import with recent activity, which
   * may be another window's upload. Resolves true to abandon it and start
   * over. Defaults to a browser confirm dialog, and to "no" without one.
   */
  confirmAbandonActiveImport?: (
    conflict: ActiveImportConflict
  ) => Promise<boolean>;
}

export interface ActiveImportConflict {
  planName: string;
  activeImportId: string;
  activeImportLastActivityAt: string | null;
}

export const ACTIVE_IMPORT_MESSAGE =
  'This plan is already being imported from another window. Try again in a few minutes, or abandon it.';

async function confirmAbandonWithDialog(
  conflict: ActiveImportConflict
): Promise<boolean> {
  if (typeof globalThis.confirm !== 'function') {
    return false;
  }
  return globalThis.confirm(
    `${ACTIVE_IMPORT_MESSAGE}\n\nAbandon the other import of "${conflict.planName}" and start over?`
  );
}

function statusMessage(response: PlanImportResponse): string {
  switch (response.status) {
    case 'queued':
      return 'Waiting for PlanMyPeak to start converting the plan';
    case 'processing':
      return 'PlanMyPeak is converting the plan';
    default:
      return `PlanMyPeak reports: ${response.status.replace(/_/g, ' ')}`;
  }
}

export async function importTrainingPlanToPlanMyPeak(
  options: ImportTrainingPlanToPlanMyPeakOptions
): Promise<ExportResultType> {
  const {
    trainingPlan,
    workouts,
    notes = [],
    config,
    onProgress,
    transport = runtimePlanImportTransport,
    sleep,
    legacyExport = exportTrainingPlanClassicWorkoutsToPlanMyPeak,
    confirmAbandonActiveImport = confirmAbandonWithDialog,
  } = options;

  const planName =
    trainingPlan.title?.trim() || `Training Plan ${trainingPlan.planId}`;
  const warnings: ValidationMessage[] = [];

  // Mirrors the legacy step count (items + library + plan) so the batch
  // progress bar in the popup, which sizes itself before knowing the path,
  // ends full either way.
  const itemCount = workouts.length + notes.length;
  const overallTotal = Math.max(1, itemCount + 2);
  let overallCurrent = 0;

  const emit = (
    phase: TrainingPlanExportProgressPayload['phase'],
    status: TrainingPlanExportProgressPayload['status'],
    current: number,
    total: number,
    message: string
  ): void => {
    onProgress?.({
      phase,
      status,
      current,
      total,
      overallCurrent,
      overallTotal,
      itemName: planName,
      message,
    });
  };

  const fail = (
    errors: string[],
    phase: Exclude<TrainingPlanExportProgressPayload['phase'], 'complete'>,
    message: string,
    errorCode?: string
  ): ExportResultType => {
    emit(phase, 'failed', 0, 1, message);
    emit('complete', 'failed', overallCurrent, overallTotal, message);
    const authFailure = planMyPeakAuthFailureFromCode(errorCode);
    return {
      success: false,
      fileName: planName,
      format: 'api',
      itemsExported: 0,
      warnings,
      errors,
      ...(authFailure ? { authFailure } : {}),
    };
  };

  emit(
    'classicWorkouts',
    'started',
    0,
    itemCount,
    'Sending the plan to PlanMyPeak'
  );

  let start = await transport.start({
    planId: trainingPlan.planId,
    targetWorkoutLibraryId: config.targetLibraryId ?? null,
    authRunId: config.authRunId,
  });

  // A staging import with recent activity may be another window's upload.
  // Only the coach can decide to cut it short; on a yes, the retry names
  // exactly that import so nothing else is abandoned.
  if (
    start.success &&
    start.data.outcome === 'active_import' &&
    start.data.activeImportStatus === 'staging'
  ) {
    const abandon = await confirmAbandonActiveImport({
      planName,
      activeImportId: start.data.activeImportId,
      activeImportLastActivityAt: start.data.activeImportLastActivityAt ?? null,
    });

    if (!abandon) {
      return fail(
        [ACTIVE_IMPORT_MESSAGE],
        'classicWorkouts',
        'Already being imported elsewhere'
      );
    }

    start = await transport.start({
      planId: trainingPlan.planId,
      targetWorkoutLibraryId: config.targetLibraryId ?? null,
      abandonImportId: start.data.activeImportId,
      authRunId: config.authRunId,
    });

    if (
      start.success &&
      start.data.outcome === 'active_import' &&
      start.data.activeImportStatus === 'staging'
    ) {
      return fail(
        [ACTIVE_IMPORT_MESSAGE],
        'classicWorkouts',
        'Already being imported elsewhere'
      );
    }
  }

  if (!start.success) {
    return fail(
      [start.error.message],
      'classicWorkouts',
      'PlanMyPeak did not accept the plan',
      start.error.code
    );
  }

  if (start.data.outcome === 'legacy_required') {
    return legacyExport({ trainingPlan, workouts, notes, config, onProgress });
  }

  let importId: string;
  if (start.data.outcome === 'active_import') {
    importId = start.data.activeImportId;
    warnings.push({
      field: 'plan',
      severity: 'warning',
      message: `An import of "${planName}" was already ${
        start.data.activeImportStatus === 'processing'
          ? 'being processed'
          : 'queued'
      } in PlanMyPeak, so its result is shown instead of starting another.`,
    });
  } else {
    importId = start.data.importId;
  }

  overallCurrent = itemCount;
  emit(
    'classicWorkouts',
    'completed',
    itemCount,
    itemCount,
    'Plan received by PlanMyPeak'
  );
  emit('plan', 'started', 0, 1, 'PlanMyPeak is converting the plan');

  const authRunId = config.authRunId;
  const poll = await pollPlanImportUntilTerminal({
    fetchStatus: () => transport.getStatus({ importId, authRunId }),
    ...(sleep ? { sleep } : {}),
    onStatus: (response) =>
      emit('plan', 'progress', 0, 1, statusMessage(response)),
  });

  if (poll.outcome === 'failed') {
    return fail(
      [poll.error.message],
      'plan',
      'Could not read the import status',
      poll.error.code
    );
  }

  if (poll.outcome === 'timeout') {
    return fail(
      [
        `PlanMyPeak is still processing "${planName}". The plan will appear in PlanMyPeak when it finishes; no further action is needed here.`,
      ],
      'plan',
      'Still processing'
    );
  }

  overallCurrent = itemCount + 1;
  emit('plan', 'completed', 1, 1, 'Conversion finished');

  const result = exportResultFromPlanImport(poll.response, planName, warnings);
  overallCurrent = overallTotal;
  emit(
    'complete',
    result.success ? 'completed' : 'failed',
    overallCurrent,
    overallTotal,
    result.success
      ? 'Training plan import complete'
      : (result.errors?.[0] ?? 'Training plan import failed')
  );

  return result;
}
