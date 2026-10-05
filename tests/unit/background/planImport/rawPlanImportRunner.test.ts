/**
 * The runner's contract: what it sends, in what order, and what it does when
 * PlanMyPeak answers with a conflict, a 404 or nothing at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  startRawPlanImport,
  type RawPlanImportDeps,
} from '@/background/planImport/rawPlanImportRunner';
import type {
  PlanImportApiFailure,
  PlanImportApiResult,
  PlanImportBeginRequest,
  PlanImportPartRequest,
} from '@/background/api/planMyPeakPlanImport';
import type { NativeTrainingPlanSources } from '@/background/api/trainingPeaks';
import type { PlanImportResponse } from '@/schemas/planMyPeakPlanImport.schema';
import type { PlanImportOperationRecord } from '@/services/planImportOperationService';
import { planImportResponse } from '../../../fixtures/planImport';

function workouts(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    workoutId: index + 1,
    title: `W${index + 1}`,
    tssPlanned: null,
    structure: { polyline: [[0, 1]] },
  }));
}

const SOURCES: NativeTrainingPlanSources = {
  plan: { planId: 100, title: 'Base', weekCount: null, unknown: { a: 1 } },
  folders: [{ folderId: 'f', folderName: 'Shelf', planIds: [100] }],
  planWorkouts: workouts(120),
  calendarNotes: [{ id: 7, title: 'Rest', noteDate: '2024-03-11T00:00:00' }],
  calendarEvents: [],
  rxWorkouts: [{ id: 'rx-1', workoutType: 'StructuredStrength' }],
};

const ok = <T>(data: T, status = 200): PlanImportApiResult<T> => ({
  success: true,
  data,
  status,
});

const fail = (error: PlanImportApiFailure): PlanImportApiResult<never> => ({
  success: false,
  error,
});

/** The runner's clock, fixed so staleness is deterministic. */
const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const MINUTES = 60_000;

const activeConflict = (
  activeImportStatus: 'staging' | 'queued' | 'processing',
  lastActivityAgoMs?: number
): PlanImportApiFailure => ({
  message: 'Conflict',
  status: 409,
  details: {
    reason: 'active_import',
    activeImportId: 'imp-old',
    activeImportStatus,
    ...(lastActivityAgoMs !== undefined
      ? {
          activeImportLastActivityAt: new Date(
            NOW - lastActivityAgoMs
          ).toISOString(),
        }
      : {}),
  },
});

const NETWORK: PlanImportApiFailure = {
  message: 'Failed to fetch',
  code: 'NETWORK_ERROR',
};

interface Harness {
  deps: RawPlanImportDeps;
  begin: ReturnType<typeof vi.fn>;
  part: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  abandon: ReturnType<typeof vi.fn>;
  operations: Map<string, PlanImportOperationRecord>;
  minted: string[];
}

function harness(): Harness {
  const operations = new Map<string, PlanImportOperationRecord>();
  const minted: string[] = [];
  let sequence = 0;

  const mint = (planId: number): PlanImportOperationRecord => {
    sequence += 1;
    const record: PlanImportOperationRecord = {
      clientOperationId: `op-${sequence}`,
      environment: 'production',
      planId,
      importId: null,
      phase: 'begun',
      updatedAt: 0,
    };
    minted.push(record.clientOperationId);
    operations.set(`production:${planId}`, record);
    return record;
  };

  const begin = vi.fn();
  const part = vi.fn();
  const complete = vi.fn();
  const abandon = vi.fn();

  const deps: RawPlanImportDeps = {
    fetchSources: async () => ({ success: true, data: SOURCES }),
    getEnvironment: async () => 'production',
    api: {
      begin: begin as unknown as RawPlanImportDeps['api']['begin'],
      part: part as unknown as RawPlanImportDeps['api']['part'],
      complete: complete as unknown as RawPlanImportDeps['api']['complete'],
      abandon: abandon as unknown as RawPlanImportDeps['api']['abandon'],
    },
    operations: {
      acquire: async (_environment, planId) => {
        const existing = operations.get(`production:${planId}`);
        return existing && existing.phase === 'begun' ? existing : mint(planId);
      },
      renew: async (_environment, planId) => mint(planId),
      update: async (_environment, planId, patch) => {
        const existing = operations.get(`production:${planId}`);
        if (existing) {
          operations.set(`production:${planId}`, { ...existing, ...patch });
        }
      },
    },
    sleep: async () => {},
    extensionVersion: () => '1.21.0',
    now: () => NOW,
  };

  return { deps, begin, part, complete, abandon, operations, minted };
}

const staging = (importId = 'imp-1'): PlanImportResponse =>
  planImportResponse({ importId, status: 'staging' });

const queued = (importId = 'imp-1'): PlanImportResponse =>
  planImportResponse({ importId, status: 'queued' });

let h: Harness;

beforeEach(() => {
  h = harness();
});

describe('startRawPlanImport', () => {
  it('begins with the native plan and folders, sends every part, completes', async () => {
    h.begin.mockResolvedValue(ok(staging(), 201));
    h.part.mockImplementation(
      async (_id: string, request: PlanImportPartRequest) =>
        ok({
          importId: 'imp-1',
          kind: request.kind,
          partIndex: request.partIndex,
          itemCount: request.items.length,
          alreadyRecorded: false,
          receivedCounts: {
            planWorkouts: 0,
            calendarNotes: 0,
            calendarEvents: 0,
            rxWorkouts: 0,
          },
        })
    );
    h.complete.mockResolvedValue(ok(queued(), 202));

    const result = await startRawPlanImport({ planId: 100, auth: {} }, h.deps);

    expect(result).toEqual({
      success: true,
      data: { outcome: 'queued', importId: 'imp-1', response: queued() },
    });

    const body = h.begin.mock.calls[0][0] as PlanImportBeginRequest;
    expect(body.plan).toBe(SOURCES.plan);
    expect(body.planFolders).toBe(SOURCES.folders);
    expect(body.environment).toBe('production');
    expect(body.extensionVersion).toBe('1.21.0');
    expect(body.clientOperationId).toBe('op-1');
    expect(body.declaredCounts).toEqual({
      planWorkouts: 120,
      calendarNotes: 1,
      calendarEvents: 0,
      rxWorkouts: 1,
    });
    expect(body).not.toHaveProperty('targetWorkoutLibraryId');

    const parts = h.part.mock.calls.map(
      (call) => call[1] as PlanImportPartRequest
    );
    expect(
      parts.map((part) => [part.kind, part.partIndex, part.items.length])
    ).toEqual([
      ['plan_workouts', 0, 50],
      ['plan_workouts', 1, 50],
      ['plan_workouts', 2, 20],
      ['calendar_notes', 0, 1],
      ['rx_workouts', 0, 1],
    ]);
    expect(
      parts.flatMap((part) => (part.kind === 'plan_workouts' ? part.items : []))
    ).toEqual(SOURCES.planWorkouts);
    expect(parts[0].items[0]).toBe(SOURCES.planWorkouts[0]);

    expect(h.complete).toHaveBeenCalledWith('imp-1', {});
    expect(h.operations.get('production:100')).toMatchObject({
      importId: 'imp-1',
      phase: 'completed',
    });
  });

  it('passes the target library only when the coach chose one', async () => {
    h.begin.mockResolvedValue(ok(staging(), 201));
    h.part.mockResolvedValue(ok({}));
    h.complete.mockResolvedValue(ok(queued(), 202));

    await startRawPlanImport(
      { planId: 100, targetWorkoutLibraryId: 'lib-9', auth: {} },
      h.deps
    );

    expect(h.begin.mock.calls[0][0]).toMatchObject({
      targetWorkoutLibraryId: 'lib-9',
    });
  });

  it('falls back to the legacy path when begin answers 404, sending nothing else', async () => {
    h.begin.mockResolvedValue(fail({ message: 'Not found', status: 404 }));

    const result = await startRawPlanImport({ planId: 100, auth: {} }, h.deps);

    expect(result).toEqual({
      success: true,
      data: { outcome: 'legacy_required' },
    });
    expect(h.part).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
  });

  it('repeats a lost begin with the same operation id', async () => {
    h.begin
      .mockResolvedValueOnce(fail(NETWORK))
      .mockResolvedValueOnce(fail(NETWORK))
      .mockResolvedValueOnce(ok(staging(), 200));
    h.part.mockResolvedValue(ok({}));
    h.complete.mockResolvedValue(ok(queued(), 202));

    const result = await startRawPlanImport({ planId: 100, auth: {} }, h.deps);

    expect(result.success).toBe(true);
    const ids = h.begin.mock.calls.map(
      (call) => (call[0] as PlanImportBeginRequest).clientOperationId
    );
    expect(ids).toEqual(['op-1', 'op-1', 'op-1']);
  });

  it('resends a part with identical content after a network failure', async () => {
    h.begin.mockResolvedValue(ok(staging(), 201));
    h.part
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(fail(NETWORK))
      .mockResolvedValue(ok({}));
    h.complete.mockResolvedValue(ok(queued(), 202));

    const result = await startRawPlanImport({ planId: 100, auth: {} }, h.deps);

    expect(result.success).toBe(true);
    // 5 parts + 1 retry.
    expect(h.part).toHaveBeenCalledTimes(6);
    const second = h.part.mock.calls[1][1] as PlanImportPartRequest;
    const retried = h.part.mock.calls[2][1] as PlanImportPartRequest;
    expect(retried).toEqual(second);
    expect(retried.items[0]).toBe(second.items[0]);
  });

  it('gives up on a part the server refuses, naming the cap', async () => {
    h.begin.mockResolvedValue(ok(staging(), 201));
    h.part.mockResolvedValue(
      fail({
        message: 'Item too large',
        status: 400,
        code: 'cap_exceeded',
        details: {
          reason: 'cap_exceeded',
          cap: 'item_bytes',
          limit: 1_000_000,
          itemIndex: 3,
        },
      })
    );

    const result = await startRawPlanImport({ planId: 100, auth: {} }, h.deps);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Item too large');
      expect(result.error.message).toContain('item_bytes');
      expect(result.error.message).toContain('item 3');
      expect(result.error.status).toBe(400);
    }
    expect(h.complete).not.toHaveBeenCalled();
  });

  it('abandons a staging import that has been quiet for 10 minutes, then starts afresh', async () => {
    h.begin
      .mockResolvedValueOnce(fail(activeConflict('staging', 11 * MINUTES)))
      // Same op id after abandon returns the now-abandoned import…
      .mockResolvedValueOnce(
        ok(planImportResponse({ importId: 'imp-old', status: 'abandoned' }))
      )
      // …so the runner renews the id and begins a new one.
      .mockResolvedValueOnce(ok(staging('imp-new'), 201));
    h.abandon.mockResolvedValue(
      ok(planImportResponse({ importId: 'imp-old', status: 'abandoned' }))
    );
    h.part.mockResolvedValue(ok({}));
    h.complete.mockResolvedValue(ok(queued('imp-new'), 202));

    const result = await startRawPlanImport({ planId: 100, auth: {} }, h.deps);

    expect(h.abandon).toHaveBeenCalledWith('imp-old', {});
    expect(result.success).toBe(true);
    if (result.success && result.data.outcome === 'queued') {
      expect(result.data.importId).toBe('imp-new');
    }
    expect(h.minted).toEqual(['op-1', 'op-2']);
  });

  it('leaves a staging import with recent activity alone and reports it', async () => {
    h.begin.mockResolvedValue(fail(activeConflict('staging', 2 * MINUTES)));

    const result = await startRawPlanImport({ planId: 100, auth: {} }, h.deps);

    expect(h.abandon).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      data: {
        outcome: 'active_import',
        activeImportId: 'imp-old',
        activeImportStatus: 'staging',
        activeImportLastActivityAt: new Date(NOW - 2 * MINUTES).toISOString(),
      },
    });
  });

  it('treats a staging import without a last-activity time as recent', async () => {
    h.begin.mockResolvedValue(fail(activeConflict('staging')));

    const result = await startRawPlanImport({ planId: 100, auth: {} }, h.deps);

    expect(h.abandon).not.toHaveBeenCalled();
    expect(result.success && result.data.outcome).toBe('active_import');
  });

  it('abandons a recent staging import only when the coach named it', async () => {
    h.begin
      .mockResolvedValueOnce(fail(activeConflict('staging', 1 * MINUTES)))
      .mockResolvedValueOnce(
        ok(planImportResponse({ importId: 'imp-old', status: 'abandoned' }))
      )
      .mockResolvedValueOnce(ok(staging('imp-new'), 201));
    h.abandon.mockResolvedValue(
      ok(planImportResponse({ importId: 'imp-old', status: 'abandoned' }))
    );
    h.part.mockResolvedValue(ok({}));
    h.complete.mockResolvedValue(ok(queued('imp-new'), 202));

    const result = await startRawPlanImport(
      { planId: 100, abandonImportId: 'imp-old', auth: {} },
      h.deps
    );

    expect(h.abandon).toHaveBeenCalledWith('imp-old', {});
    expect(result.success && result.data.outcome).toBe('queued');
    // The choice stays inside the extension: begin rejects unknown keys.
    for (const call of h.begin.mock.calls) {
      expect(call[0]).not.toHaveProperty('abandonImportId');
    }
  });

  it('falls back to joining the import when abandon answers 409', async () => {
    h.begin
      .mockResolvedValueOnce(fail(activeConflict('staging', 1 * MINUTES)))
      // By the retry the other window has completed it.
      .mockResolvedValueOnce(fail(activeConflict('processing')));
    h.abandon.mockResolvedValue(
      fail({ message: 'No longer staging', status: 409 })
    );

    const result = await startRawPlanImport(
      { planId: 100, abandonImportId: 'imp-old', auth: {} },
      h.deps
    );

    expect(result.success && result.data.outcome).toBe('active_import');
    if (result.success && result.data.outcome === 'active_import') {
      expect(result.data.activeImportStatus).toBe('processing');
    }
    expect(h.part).not.toHaveBeenCalled();
  });

  it('does not abandon a different import than the one the coach named', async () => {
    h.begin.mockResolvedValue(fail(activeConflict('staging', 1 * MINUTES)));

    const result = await startRawPlanImport(
      { planId: 100, abandonImportId: 'imp-other', auth: {} },
      h.deps
    );

    expect(h.abandon).not.toHaveBeenCalled();
    expect(result.success && result.data.outcome).toBe('active_import');
  });

  it('joins an import that is already queued or processing', async () => {
    h.begin.mockResolvedValue(
      fail({
        message: 'Conflict',
        status: 409,
        details: {
          reason: 'active_import',
          activeImportId: 'imp-busy',
          activeImportStatus: 'processing',
        },
      })
    );

    const result = await startRawPlanImport({ planId: 100, auth: {} }, h.deps);

    expect(result).toEqual({
      success: true,
      data: {
        outcome: 'active_import',
        activeImportId: 'imp-busy',
        activeImportStatus: 'processing',
        activeImportLastActivityAt: null,
      },
    });
    expect(h.abandon).not.toHaveBeenCalled();
  });

  it('mints a new operation id when the old one was used with a different body', async () => {
    h.begin
      .mockResolvedValueOnce(fail({ message: 'Conflict', status: 409 }))
      .mockResolvedValueOnce(ok(staging(), 201));
    h.part.mockResolvedValue(ok({}));
    h.complete.mockResolvedValue(ok(queued(), 202));

    const result = await startRawPlanImport({ planId: 100, auth: {} }, h.deps);

    expect(result.success).toBe(true);
    const ids = h.begin.mock.calls.map(
      (call) => (call[0] as PlanImportBeginRequest).clientOperationId
    );
    expect(ids).toEqual(['op-1', 'op-2']);
  });

  it('reports a count mismatch on complete with both counts', async () => {
    h.begin.mockResolvedValue(ok(staging(), 201));
    h.part.mockResolvedValue(ok({}));
    h.complete.mockResolvedValue(
      fail({
        message: 'Counts do not match',
        status: 409,
        details: {
          reason: 'count_mismatch',
          declaredCounts: {
            planWorkouts: 120,
            calendarNotes: 1,
            calendarEvents: 0,
            rxWorkouts: 1,
          },
          receivedCounts: {
            planWorkouts: 70,
            calendarNotes: 1,
            calendarEvents: 0,
            rxWorkouts: 1,
          },
        },
      })
    );

    const result = await startRawPlanImport({ planId: 100, auth: {} }, h.deps);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Counts do not match');
      expect(result.error.message).toContain('"planWorkouts":70');
    }
    expect(h.operations.get('production:100')?.phase).toBe('begun');
  });

  it('skips parts when a reused operation is already past staging', async () => {
    h.begin.mockResolvedValue(ok(queued(), 200));

    const result = await startRawPlanImport({ planId: 100, auth: {} }, h.deps);

    expect(result.success).toBe(true);
    if (result.success && result.data.outcome === 'queued') {
      expect(result.data.importId).toBe('imp-1');
    }
    expect(h.part).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
  });

  it('keeps the auth code when the credential is refused', async () => {
    h.begin.mockResolvedValue(
      fail({ message: 'Sign in', status: 401, code: 'UNAUTHORIZED' })
    );

    const result = await startRawPlanImport({ planId: 100, auth: {} }, h.deps);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('fails before begin when the native payloads cannot be read', async () => {
    h.deps.fetchSources = async () => ({
      success: false,
      error: { message: 'HTTP 500', status: 500 },
    });

    const result = await startRawPlanImport({ planId: 100, auth: {} }, h.deps);

    expect(result).toEqual({
      success: false,
      error: { message: 'HTTP 500', status: 500 },
    });
    expect(h.begin).not.toHaveBeenCalled();
  });
});
