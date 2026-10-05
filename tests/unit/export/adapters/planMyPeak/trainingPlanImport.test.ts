/**
 * The shared plan-import flow: raw path first, legacy path on 404, the
 * server's verdict rendered as an export result.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ACTIVE_IMPORT_MESSAGE,
  importTrainingPlanToPlanMyPeak,
  type PlanImportTransport,
} from '@/export/adapters/planMyPeak/trainingPlanImport';
import type { ExportTrainingPlanClassicWorkoutsToPlanMyPeakOptions } from '@/export/adapters/planMyPeak/trainingPlanExport';
import type { ExportResult } from '@/export/adapters/base';
import type { TrainingPlanExportProgressPayload } from '@/types';
import type { TrainingPlan, PlanWorkout } from '@/types/api.types';
import type { ApiResponse } from '@/types/api.types';
import type { PlanImportResponse } from '@/schemas/planMyPeakPlanImport.schema';
import type { RawPlanImportStart } from '@/types/planImport.types';
import {
  outcomeCounts,
  planImportResponse,
} from '../../../../fixtures/planImport';

const TRAINING_PLAN = {
  planId: 100,
  title: 'Base Build',
  startDate: '2024-03-04',
  weekCount: 12,
  description: null,
} as unknown as TrainingPlan;

const WORKOUTS = [
  { workoutId: 1, title: 'W1', workoutDay: '2024-03-04T00:00:00' },
  { workoutId: 2, title: 'W2', workoutDay: '2024-03-05T00:00:00' },
] as unknown as PlanWorkout[];

function transportWith(
  start: ApiResponse<RawPlanImportStart>,
  ...statuses: Array<ApiResponse<PlanImportResponse>>
): PlanImportTransport & {
  start: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
} {
  const queue = [...statuses];
  return {
    start: vi.fn(async () => start),
    getStatus: vi.fn(async () => {
      const next = queue.shift();
      if (!next) {
        throw new Error('getStatus called more times than expected');
      }
      return next;
    }),
  };
}

const noSleep = async (): Promise<void> => {};

describe('importTrainingPlanToPlanMyPeak', () => {
  it('runs the legacy path unchanged when the destination has no raw routes', async () => {
    const legacyResult: ExportResult = {
      success: true,
      fileName: 'Base Build',
      format: 'api',
      itemsExported: 2,
      warnings: [],
    };
    const legacyExport = vi.fn(
      async (_options: ExportTrainingPlanClassicWorkoutsToPlanMyPeakOptions) =>
        legacyResult
    );
    const onProgress = vi.fn();
    const transport = transportWith({
      success: true,
      data: { outcome: 'legacy_required' },
    });
    const config = { createFolder: true, targetLibraryName: 'Base Build' };

    const result = await importTrainingPlanToPlanMyPeak({
      trainingPlan: TRAINING_PLAN,
      workouts: WORKOUTS,
      notes: [],
      config,
      onProgress,
      transport,
      sleep: noSleep,
      legacyExport,
    });

    expect(result).toBe(legacyResult);
    expect(legacyExport).toHaveBeenCalledTimes(1);
    expect(legacyExport.mock.calls[0][0]).toEqual({
      trainingPlan: TRAINING_PLAN,
      workouts: WORKOUTS,
      notes: [],
      config,
      onProgress,
    });
    expect(transport.getStatus).not.toHaveBeenCalled();
  });

  it('polls a queued import to its end and renders the server outcomes', async () => {
    const terminal = planImportResponse({
      importId: 'imp-1',
      status: 'completed_with_issues',
      summary: {
        workoutPlanId: 'wp-1',
        outcomes: outcomeCounts({ created: 1, imported_without_structure: 1 }),
        byKind: {
          plan_workout: outcomeCounts({
            created: 1,
            imported_without_structure: 1,
          }),
        },
      },
      issues: [
        {
          kind: 'plan_workout',
          trainingPeaksId: '2',
          title: 'W2',
          outcome: 'imported_without_structure',
          code: 'unknown_segment_type',
          message: 'Segment type "wobble" is not supported',
          path: '$.structure.structure[0].type',
        },
      ],
    });
    const transport = transportWith(
      {
        success: true,
        data: {
          outcome: 'queued',
          importId: 'imp-1',
          response: planImportResponse({ status: 'queued' }),
        },
      },
      { success: true, data: planImportResponse({ status: 'processing' }) },
      { success: true, data: terminal }
    );
    const progress: TrainingPlanExportProgressPayload[] = [];

    const result = await importTrainingPlanToPlanMyPeak({
      trainingPlan: TRAINING_PLAN,
      workouts: WORKOUTS,
      config: {
        createFolder: true,
        authRunId: 'run-1',
        targetLibraryId: 'lib-3',
      },
      onProgress: (update) => progress.push(update),
      transport,
      sleep: noSleep,
    });

    expect(transport.start).toHaveBeenCalledWith({
      planId: 100,
      targetWorkoutLibraryId: 'lib-3',
      authRunId: 'run-1',
    });
    expect(transport.getStatus).toHaveBeenCalledWith({
      importId: 'imp-1',
      authRunId: 'run-1',
    });
    expect(transport.getStatus).toHaveBeenCalledTimes(2);

    expect(result.success).toBe(true);
    expect(result.itemsExported).toBe(2);
    expect(result.planImport?.status).toBe('completed_with_issues');
    expect(result.warnings.map((warning) => warning.message)[0]).toContain(
      'Segment type "wobble" is not supported'
    );

    const last = progress[progress.length - 1];
    expect(last.phase).toBe('complete');
    expect(last.status).toBe('completed');
    expect(last.overallCurrent).toBe(last.overallTotal);
    expect(progress.some((update) => update.phase === 'plan')).toBe(true);
  });

  it('shows the server message verbatim when PlanMyPeak refuses to start', async () => {
    const transport = transportWith({
      success: false,
      error: {
        message:
          'Request exceeds the import size limit (limit 2000 for import_items)',
        status: 400,
        code: 'cap_exceeded',
      },
    });
    const progress: TrainingPlanExportProgressPayload[] = [];

    const result = await importTrainingPlanToPlanMyPeak({
      trainingPlan: TRAINING_PLAN,
      workouts: WORKOUTS,
      config: { createFolder: true },
      onProgress: (update) => progress.push(update),
      transport,
      sleep: noSleep,
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual([
      'Request exceeds the import size limit (limit 2000 for import_items)',
    ]);
    expect(result.authFailure).toBeUndefined();
    expect(progress[progress.length - 1]).toMatchObject({
      phase: 'complete',
      status: 'failed',
    });
  });

  it('carries an auth failure as data so the surface can offer sign-in', async () => {
    const transport = transportWith({
      success: false,
      error: { message: 'Sign in', status: 401, code: 'UNAUTHORIZED' },
    });

    const result = await importTrainingPlanToPlanMyPeak({
      trainingPlan: TRAINING_PLAN,
      workouts: WORKOUTS,
      config: { createFolder: true },
      transport,
      sleep: noSleep,
    });

    expect(result.success).toBe(false);
    expect(result.authFailure).toBeDefined();
  });

  it('joins an import already in progress and says so', async () => {
    const transport = transportWith(
      {
        success: true,
        data: {
          outcome: 'active_import',
          activeImportId: 'imp-busy',
          activeImportStatus: 'processing',
        },
      },
      {
        success: true,
        data: planImportResponse({
          importId: 'imp-busy',
          status: 'completed',
          summary: {
            workoutPlanId: 'wp',
            outcomes: outcomeCounts({ updated: 2 }),
            byKind: { plan_workout: outcomeCounts({ updated: 2 }) },
          },
        }),
      }
    );

    const result = await importTrainingPlanToPlanMyPeak({
      trainingPlan: TRAINING_PLAN,
      workouts: WORKOUTS,
      config: { createFolder: true },
      transport,
      sleep: noSleep,
    });

    expect(transport.getStatus).toHaveBeenCalledWith(
      expect.objectContaining({ importId: 'imp-busy' })
    );
    expect(result.success).toBe(true);
    expect(result.warnings[0].message).toContain('already being processed');
  });

  it('stops with the other-window message when the coach declines to abandon', async () => {
    const transport = transportWith({
      success: true,
      data: {
        outcome: 'active_import',
        activeImportId: 'imp-staging',
        activeImportStatus: 'staging',
        activeImportLastActivityAt: '2026-09-26T11:59:00.000Z',
      },
    });
    const confirmAbandonActiveImport = vi.fn(async () => false);

    const result = await importTrainingPlanToPlanMyPeak({
      trainingPlan: TRAINING_PLAN,
      workouts: WORKOUTS,
      config: { createFolder: true },
      transport,
      sleep: noSleep,
      confirmAbandonActiveImport,
    });

    expect(confirmAbandonActiveImport).toHaveBeenCalledWith({
      planName: 'Base Build',
      activeImportId: 'imp-staging',
      activeImportLastActivityAt: '2026-09-26T11:59:00.000Z',
    });
    expect(transport.start).toHaveBeenCalledTimes(1);
    expect(transport.getStatus).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.errors).toEqual([ACTIVE_IMPORT_MESSAGE]);
  });

  it('retries naming the import to abandon when the coach agrees', async () => {
    const queuedStart = {
      success: true as const,
      data: {
        outcome: 'queued' as const,
        importId: 'imp-new',
        response: planImportResponse({ importId: 'imp-new', status: 'queued' }),
      },
    };
    const transport = transportWith(
      {
        success: true,
        data: {
          outcome: 'active_import',
          activeImportId: 'imp-staging',
          activeImportStatus: 'staging',
        },
      },
      {
        success: true,
        data: planImportResponse({
          importId: 'imp-new',
          status: 'completed',
          summary: {
            workoutPlanId: 'wp',
            outcomes: outcomeCounts({ created: 2 }),
            byKind: { plan_workout: outcomeCounts({ created: 2 }) },
          },
        }),
      }
    );
    transport.start.mockResolvedValueOnce({
      success: true,
      data: {
        outcome: 'active_import',
        activeImportId: 'imp-staging',
        activeImportStatus: 'staging',
      },
    });
    transport.start.mockResolvedValueOnce(queuedStart);

    const result = await importTrainingPlanToPlanMyPeak({
      trainingPlan: TRAINING_PLAN,
      workouts: WORKOUTS,
      config: { createFolder: true },
      transport,
      sleep: noSleep,
      confirmAbandonActiveImport: async () => true,
    });

    expect(transport.start).toHaveBeenCalledTimes(2);
    expect(transport.start.mock.calls[1][0]).toMatchObject({
      abandonImportId: 'imp-staging',
    });
    expect(result.success).toBe(true);
    expect(result.itemsExported).toBe(2);
  });

  it('reports a failed import with its failure code', async () => {
    const transport = transportWith(
      {
        success: true,
        data: {
          outcome: 'queued',
          importId: 'imp-1',
          response: planImportResponse({ status: 'queued' }),
        },
      },
      {
        success: true,
        data: planImportResponse({
          status: 'failed',
          failureCode: 'processing_stalled',
        }),
      }
    );

    const result = await importTrainingPlanToPlanMyPeak({
      trainingPlan: TRAINING_PLAN,
      workouts: WORKOUTS,
      config: { createFolder: true },
      transport,
      sleep: noSleep,
    });

    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('processing_stalled');
    expect(result.planImport?.status).toBe('failed');
  });
});
