import { describe, it, expect, vi } from 'vitest';
import {
  pollPlanImportUntilTerminal,
  planImportPollDelay,
  PLAN_IMPORT_POLL_FAST_MS,
  PLAN_IMPORT_POLL_SLOW_MS,
} from '@/export/adapters/planMyPeak/planImportPolling';
import type { ApiResponse } from '@/types/api.types';
import type { PlanImportResponse } from '@/schemas/planMyPeakPlanImport.schema';
import { planImportResponse } from '../../../../fixtures/planImport';

/** A clock the injected sleep advances, so the schedule is observable. */
function fakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sleeps: number[];
} {
  let time = 0;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
    sleeps,
  };
}

function statuses(
  ...responses: Array<ApiResponse<PlanImportResponse>>
): () => Promise<ApiResponse<PlanImportResponse>> {
  const queue = [...responses];
  return async () => {
    const next = queue.shift();
    if (!next) {
      throw new Error('poll called more times than expected');
    }
    return next;
  };
}

const ok = (
  status: PlanImportResponse['status']
): ApiResponse<PlanImportResponse> => ({
  success: true,
  data: planImportResponse({ status }),
});

describe('planImportPollDelay', () => {
  it('polls every 2 s for the first 30 s, then every 5 s', () => {
    expect(planImportPollDelay(0)).toBe(PLAN_IMPORT_POLL_FAST_MS);
    expect(planImportPollDelay(29_999)).toBe(PLAN_IMPORT_POLL_FAST_MS);
    expect(planImportPollDelay(30_000)).toBe(PLAN_IMPORT_POLL_SLOW_MS);
  });
});

describe('pollPlanImportUntilTerminal', () => {
  it('stops at the first terminal status and reports every read', async () => {
    const clock = fakeClock();
    const onStatus = vi.fn();

    const result = await pollPlanImportUntilTerminal({
      fetchStatus: statuses(
        ok('queued'),
        ok('processing'),
        ok('completed_with_issues')
      ),
      sleep: clock.sleep,
      now: clock.now,
      onStatus,
    });

    expect(result.outcome).toBe('terminal');
    if (result.outcome === 'terminal') {
      expect(result.response.status).toBe('completed_with_issues');
    }
    expect(onStatus).toHaveBeenCalledTimes(3);
    expect(clock.sleeps).toEqual([2_000, 2_000]);
  });

  it('slows down after the fast window', async () => {
    const clock = fakeClock();
    const responses: Array<ApiResponse<PlanImportResponse>> = [];
    for (let index = 0; index < 18; index += 1) {
      responses.push(ok('processing'));
    }
    responses.push(ok('completed'));

    await pollPlanImportUntilTerminal({
      fetchStatus: statuses(...responses),
      sleep: clock.sleep,
      now: clock.now,
    });

    // 15 fast sleeps cover the 30 s window; the rest are slow.
    expect(clock.sleeps.slice(0, 15).every((ms) => ms === 2_000)).toBe(true);
    expect(clock.sleeps.slice(15).every((ms) => ms === 5_000)).toBe(true);
  });

  it('tolerates a few transient read failures', async () => {
    const clock = fakeClock();
    const transient: ApiResponse<PlanImportResponse> = {
      success: false,
      error: { message: 'Network error', code: 'NETWORK_ERROR' },
    };

    const result = await pollPlanImportUntilTerminal({
      fetchStatus: statuses(transient, transient, ok('completed')),
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(result.outcome).toBe('terminal');
  });

  it('gives up after three consecutive transient failures', async () => {
    const clock = fakeClock();
    const transient: ApiResponse<PlanImportResponse> = {
      success: false,
      error: { message: 'HTTP 503', status: 503 },
    };

    const result = await pollPlanImportUntilTerminal({
      fetchStatus: statuses(transient, transient, transient),
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(result.outcome).toBe('failed');
    if (result.outcome === 'failed') {
      expect(result.error.status).toBe(503);
    }
  });

  it('fails at once on a non-transient read failure, keeping the code', async () => {
    const clock = fakeClock();

    const result = await pollPlanImportUntilTerminal({
      fetchStatus: statuses({
        success: false,
        error: { message: 'Sign in', status: 401, code: 'UNAUTHORIZED' },
      }),
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(result).toEqual({
      outcome: 'failed',
      error: { message: 'Sign in', status: 401, code: 'UNAUTHORIZED' },
    });
  });

  it('times out while the import is still running', async () => {
    const clock = fakeClock();

    const result = await pollPlanImportUntilTerminal({
      fetchStatus: async () => ok('processing'),
      sleep: clock.sleep,
      now: clock.now,
      timeoutMs: 10_000,
    });

    expect(result.outcome).toBe('timeout');
    if (result.outcome === 'timeout') {
      expect(result.last?.status).toBe('processing');
    }
  });
});
