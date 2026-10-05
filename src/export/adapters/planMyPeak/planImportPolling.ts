/**
 * Polling a raw plan import until the server is done with it.
 *
 * UI-free so the popup and the overlay share one loop. The schedule is the
 * server's recommendation: every 2 s for the first 30 s, then every 5 s.
 * Processing a 52-week plan can take a minute or two.
 */

import {
  isTerminalPlanImportStatus,
  type PlanImportResponse,
} from '@/schemas/planMyPeakPlanImport.schema';
import type { ApiResponse } from '@/types/api.types';
import type { ApiError } from '@/schemas/api.schema';

export const PLAN_IMPORT_POLL_FAST_MS = 2_000;
export const PLAN_IMPORT_POLL_FAST_WINDOW_MS = 30_000;
export const PLAN_IMPORT_POLL_SLOW_MS = 5_000;

/** Give up waiting after this long; the import itself keeps running. */
export const PLAN_IMPORT_POLL_TIMEOUT_MS = 15 * 60_000;

/** Consecutive read failures tolerated before the poll gives up. */
export const PLAN_IMPORT_POLL_MAX_CONSECUTIVE_FAILURES = 3;

export type PlanImportPollResult =
  | { outcome: 'terminal'; response: PlanImportResponse }
  | { outcome: 'timeout'; last: PlanImportResponse | null }
  | { outcome: 'failed'; error: ApiError };

export interface PollPlanImportOptions {
  fetchStatus: () => Promise<ApiResponse<PlanImportResponse>>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Called with every successful read, for progress. */
  onStatus?: (response: PlanImportResponse) => void;
  timeoutMs?: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Whether a read failure is worth retrying rather than reporting. */
function isTransientReadFailure(error: ApiError): boolean {
  if (error.code === 'NETWORK_ERROR') {
    return true;
  }
  return typeof error.status === 'number' && error.status >= 500;
}

export function planImportPollDelay(elapsedMs: number): number {
  return elapsedMs < PLAN_IMPORT_POLL_FAST_WINDOW_MS
    ? PLAN_IMPORT_POLL_FAST_MS
    : PLAN_IMPORT_POLL_SLOW_MS;
}

export async function pollPlanImportUntilTerminal({
  fetchStatus,
  sleep = defaultSleep,
  now = () => Date.now(),
  onStatus,
  timeoutMs = PLAN_IMPORT_POLL_TIMEOUT_MS,
}: PollPlanImportOptions): Promise<PlanImportPollResult> {
  const startedAt = now();
  let last: PlanImportResponse | null = null;
  let consecutiveFailures = 0;

  for (;;) {
    const result = await fetchStatus();

    if (result.success) {
      consecutiveFailures = 0;
      last = result.data;
      onStatus?.(result.data);

      if (isTerminalPlanImportStatus(result.data.status)) {
        return { outcome: 'terminal', response: result.data };
      }
    } else {
      consecutiveFailures += 1;
      if (
        !isTransientReadFailure(result.error) ||
        consecutiveFailures >= PLAN_IMPORT_POLL_MAX_CONSECUTIVE_FAILURES
      ) {
        return { outcome: 'failed', error: result.error };
      }
    }

    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs) {
      return { outcome: 'timeout', last };
    }

    await sleep(planImportPollDelay(elapsed));
  }
}
