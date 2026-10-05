/**
 * The raw training-plan import, extension side: begin → parts → complete.
 *
 * Runs in the background worker so the native TrainingPeaks payloads never
 * cross into the popup or the page, and so a popup closed mid-upload loses
 * nothing: the server holds whatever was recorded, the operation record
 * holds the ids, and the next attempt resumes against the same import.
 *
 * What is sent is exactly what TrainingPeaks returned. Nothing here reads a
 * field off an item except the plan's `planId` for logging; identities,
 * placement and conversion are the server's.
 */

import {
  fetchNativeTrainingPlanSources,
  type NativeTrainingPlanSources,
} from '@/background/api/trainingPeaks';
import {
  abandonPlanImport,
  beginPlanImport,
  completePlanImport,
  recordPlanImportPart,
  PLAN_IMPORT_NETWORK_ERROR,
  type PlanImportApiFailure,
  type PlanImportApiResult,
  type PlanImportBeginRequest,
  type PlanImportPartRequest,
} from '@/background/api/planMyPeakPlanImport';
import type { PlanMyPeakRequestAuth } from '@/background/api/planMyPeak';
import {
  declaredCountsFor,
  splitSourcesIntoParts,
} from '@/export/adapters/planMyPeak/planImportParts';
import {
  isTerminalPlanImportStatus,
  PlanImportActiveConflictSchema,
  PlanImportCapExceededSchema,
  PlanImportCountMismatchSchema,
  type PlanImportResponse,
} from '@/schemas/planMyPeakPlanImport.schema';
import {
  acquirePlanImportOperation,
  renewPlanImportOperation,
  updatePlanImportOperation,
  type PlanImportOperationRecord,
} from '@/services/planImportOperationService';
import { getTrainingPeaksEnvironment } from '@/services/trainingPeaksConfigService';
import type { ApiResponse } from '@/types/api.types';
import type { ApiError } from '@/schemas/api.schema';
import type { RawPlanImportStart } from '@/types/planImport.types';
import type { TrainingPeaksEnvironment } from '@/utils/constants';
import { logger } from '@/utils/logger';

/** Attempts per request on a network failure, after the first. */
export const PLAN_IMPORT_NETWORK_RETRIES = 3;

/** Base delay between retries; doubles each time. */
const RETRY_BASE_DELAY_MS = 500;

/** Bound on begin re-attempts driven by conflicts (abandon, renew). */
const MAX_BEGIN_ROUNDS = 4;

export interface RawPlanImportDeps {
  fetchSources: (
    planId: number
  ) => Promise<ApiResponse<NativeTrainingPlanSources>>;
  getEnvironment: () => Promise<TrainingPeaksEnvironment>;
  api: {
    begin: typeof beginPlanImport;
    part: typeof recordPlanImportPart;
    complete: typeof completePlanImport;
    abandon: typeof abandonPlanImport;
  };
  operations: {
    acquire: typeof acquirePlanImportOperation;
    renew: typeof renewPlanImportOperation;
    update: typeof updatePlanImportOperation;
  };
  sleep: (ms: number) => Promise<void>;
  extensionVersion: () => string | null;
  now: () => number;
}

export function defaultRawPlanImportDeps(): RawPlanImportDeps {
  return {
    fetchSources: fetchNativeTrainingPlanSources,
    getEnvironment: getTrainingPeaksEnvironment,
    api: {
      begin: beginPlanImport,
      part: recordPlanImportPart,
      complete: completePlanImport,
      abandon: abandonPlanImport,
    },
    operations: {
      acquire: acquirePlanImportOperation,
      renew: renewPlanImportOperation,
      update: updatePlanImportOperation,
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    extensionVersion: () => {
      try {
        return chrome.runtime.getManifest().version ?? null;
      } catch {
        return null;
      }
    },
  };
}

export interface StartRawPlanImportOptions {
  planId: number;
  targetWorkoutLibraryId?: string | null;
  /** A staging import the coach explicitly chose to abandon; see the message type. */
  abandonImportId?: string;
  auth: PlanMyPeakRequestAuth;
}

/**
 * A staging import with no activity for this long is nobody's upload in
 * progress: the window that started it is gone, and only a client could
 * ever finish it. Younger than this, it may be another window mid-upload,
 * and abandoning it would fail that upload's remaining parts.
 */
export const STALE_STAGING_IMPORT_MS = 10 * 60_000;

function isStaleStagingImport(
  lastActivityAt: string | null | undefined,
  now: number
): boolean {
  if (!lastActivityAt) {
    // Unknown means recent: an older server does not report it, and the
    // safe reading of "no information" is "someone may be using it".
    return false;
  }
  const at = Date.parse(lastActivityAt);
  return Number.isFinite(at) && now - at >= STALE_STAGING_IMPORT_MS;
}

/** Repeat an idempotent request while it fails to reach the server. */
async function withNetworkRetry<T>(
  attempt: () => Promise<PlanImportApiResult<T>>,
  sleep: (ms: number) => Promise<void>,
  label: string
): Promise<PlanImportApiResult<T>> {
  let result = await attempt();

  for (
    let retry = 1;
    !result.success &&
    result.error.code === PLAN_IMPORT_NETWORK_ERROR &&
    retry <= PLAN_IMPORT_NETWORK_RETRIES;
    retry += 1
  ) {
    logger.warn(
      `[Raw plan import] ${label} did not reach PlanMyPeak, retry ${retry}/${PLAN_IMPORT_NETWORK_RETRIES}`
    );
    await sleep(RETRY_BASE_DELAY_MS * 2 ** (retry - 1));
    result = await attempt();
  }

  return result;
}

/** A runner failure as the popup's `ApiResponse`, keeping the auth codes. */
function failure(
  error: PlanImportApiFailure,
  context?: string
): { success: false; error: ApiError } {
  let message = context ? `${context}: ${error.message}` : error.message;

  const cap = PlanImportCapExceededSchema.safeParse(error.details);
  if (cap.success) {
    message += ` (limit ${cap.data.limit} for ${cap.data.cap}${
      cap.data.itemIndex !== undefined ? `, item ${cap.data.itemIndex}` : ''
    })`;
  }

  const mismatch = PlanImportCountMismatchSchema.safeParse(error.details);
  if (mismatch.success) {
    message += ` (declared ${JSON.stringify(mismatch.data.declaredCounts)}, received ${JSON.stringify(
      mismatch.data.receivedCounts
    )})`;
  }

  return {
    success: false,
    error: {
      message,
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.code ? { code: error.code } : {}),
    },
  };
}

function beginRequest(
  operation: PlanImportOperationRecord,
  sources: NativeTrainingPlanSources,
  options: StartRawPlanImportOptions,
  extensionVersion: string | null
): PlanImportBeginRequest {
  return {
    clientOperationId: operation.clientOperationId,
    environment: operation.environment,
    extensionVersion,
    plan: sources.plan,
    planFolders: sources.folders,
    declaredCounts: declaredCountsFor(sources),
    ...(options.targetWorkoutLibraryId
      ? { targetWorkoutLibraryId: options.targetWorkoutLibraryId }
      : {}),
  };
}

type BeginOutcome =
  | {
      kind: 'begun';
      response: PlanImportResponse;
      operation: PlanImportOperationRecord;
    }
  | { kind: 'result'; result: ApiResponse<RawPlanImportStart> };

async function begin(
  sources: NativeTrainingPlanSources,
  environment: TrainingPeaksEnvironment,
  options: StartRawPlanImportOptions,
  deps: RawPlanImportDeps
): Promise<BeginOutcome> {
  const { planId, auth } = options;
  let operation = await deps.operations.acquire(environment, planId);
  let renewed = false;
  let abandoned = false;

  for (let round = 0; round < MAX_BEGIN_ROUNDS; round += 1) {
    const body = beginRequest(
      operation,
      sources,
      options,
      deps.extensionVersion()
    );
    const result = await withNetworkRetry(
      () => deps.api.begin(body, auth),
      deps.sleep,
      'begin'
    );

    if (result.success) {
      if (isTerminalPlanImportStatus(result.data.status)) {
        // The operation id was reused after its import had already ended
        // (abandoned by us just now, or expired server-side). Same id + same
        // body only ever returns that finished import, so a new attempt
        // needs a new id.
        if (renewed) {
          return {
            kind: 'result',
            result: failure({
              message: `PlanMyPeak keeps returning a finished import (${result.data.status}) for this plan`,
              code: 'IMPORT_STATE',
            }),
          };
        }
        operation = await deps.operations.renew(environment, planId);
        renewed = true;
        continue;
      }

      await deps.operations.update(environment, planId, {
        importId: result.data.importId,
      });
      return { kind: 'begun', response: result.data, operation };
    }

    const { error } = result;

    if (error.status === 404) {
      logger.info(
        '[Raw plan import] destination has no raw import routes; legacy path'
      );
      return {
        kind: 'result',
        result: { success: true, data: { outcome: 'legacy_required' } },
      };
    }

    if (error.status === 409) {
      const active = PlanImportActiveConflictSchema.safeParse(error.details);

      if (active.success) {
        const { activeImportId, activeImportStatus } = active.data;
        const lastActivityAt = active.data.activeImportLastActivityAt ?? null;

        // A staging import can only be finished by a client. If it has gone
        // quiet its window is gone and it is safe to clear; if it is recent
        // it may be another window's upload, and only the coach may decide
        // to cut that short (options.abandonImportId).
        const mayAbandon =
          activeImportStatus === 'staging' &&
          !abandoned &&
          (isStaleStagingImport(lastActivityAt, deps.now()) ||
            options.abandonImportId === activeImportId);

        if (mayAbandon) {
          logger.info(
            `[Raw plan import] abandoning staging import ${activeImportId}`
          );
          const abandonResult = await deps.api.abandon(activeImportId, auth);
          if (!abandonResult.success && abandonResult.error.status !== 409) {
            return {
              kind: 'result',
              result: failure(
                abandonResult.error,
                'Could not abandon the previous unfinished import'
              ),
            };
          }
          abandoned = true;
          continue;
        }

        return {
          kind: 'result',
          result: {
            success: true,
            data: {
              outcome: 'active_import',
              activeImportId,
              activeImportStatus,
              activeImportLastActivityAt: lastActivityAt,
            },
          },
        };
      }

      // Same operation id, different body: the plan changed since the
      // unfinished attempt. Mint a new id once.
      if (!renewed) {
        operation = await deps.operations.renew(environment, planId);
        renewed = true;
        continue;
      }
    }

    return {
      kind: 'result',
      result: failure(error, 'PlanMyPeak refused to start the import'),
    };
  }

  return {
    kind: 'result',
    result: failure({
      message: 'Could not start the import after repeated conflicts',
      code: 'IMPORT_STATE',
    }),
  };
}

/**
 * Begin, send every part, complete. Resolves with what the caller should do
 * next; only a request PlanMyPeak refused, or one that never reached it after
 * retries, is a failure.
 */
export async function startRawPlanImport(
  options: StartRawPlanImportOptions,
  deps: RawPlanImportDeps = defaultRawPlanImportDeps()
): Promise<ApiResponse<RawPlanImportStart>> {
  const { planId, auth } = options;

  const sourcesResult = await deps.fetchSources(planId);
  if (!sourcesResult.success) {
    return sourcesResult;
  }
  const sources = sourcesResult.data;
  const environment = await deps.getEnvironment();

  const begun = await begin(sources, environment, options, deps);
  if (begun.kind === 'result') {
    return begun.result;
  }

  const { importId } = begun.response;

  // A reused operation whose complete was acknowledged but never recorded
  // locally: the server is already past staging, so there is nothing to send.
  if (begun.response.status !== 'staging') {
    await deps.operations.update(environment, planId, { phase: 'completed' });
    return {
      success: true,
      data: { outcome: 'queued', importId, response: begun.response },
    };
  }

  const parts = splitSourcesIntoParts(sources);
  logger.info(
    `[Raw plan import] ${importId}: sending ${parts.length} part(s) for plan ${planId}`
  );

  for (const part of parts) {
    const request: PlanImportPartRequest = {
      kind: part.kind,
      partIndex: part.partIndex,
      items: part.items,
    };
    const result = await withNetworkRetry(
      () => deps.api.part(importId, request, auth),
      deps.sleep,
      `${part.kind} part ${part.partIndex}`
    );

    if (!result.success) {
      return failure(
        result.error,
        `PlanMyPeak refused ${part.kind.replace('_', ' ')} part ${part.partIndex + 1} of ${parts.length}`
      );
    }
  }

  const completed = await withNetworkRetry(
    () => deps.api.complete(importId, auth),
    deps.sleep,
    'complete'
  );

  if (!completed.success) {
    return failure(completed.error, 'PlanMyPeak could not queue the import');
  }

  await deps.operations.update(environment, planId, { phase: 'completed' });

  return {
    success: true,
    data: { outcome: 'queued', importId, response: completed.data },
  };
}
