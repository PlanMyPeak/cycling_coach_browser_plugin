import { describe, it, expect } from 'vitest';
import {
  isTerminalPlanImportStatus,
  PlanImportActiveConflictSchema,
  PlanImportPartResponseSchema,
  PlanImportResponseSchema,
  PLAN_IMPORT_STATUSES,
} from '@/schemas/planMyPeakPlanImport.schema';

const COUNTS = {
  planWorkouts: 120,
  calendarNotes: 3,
  calendarEvents: 1,
  rxWorkouts: 4,
};

describe('PlanImportResponseSchema', () => {
  it('parses a terminal response with summary and issues', () => {
    const parsed = PlanImportResponseSchema.parse({
      importId: 'imp-1',
      status: 'completed_with_issues',
      environment: 'production',
      trainingPeaksPlanId: 100,
      declaredCounts: COUNTS,
      receivedCounts: COUNTS,
      failureCode: null,
      summary: {
        workoutPlanId: 'wp-1',
        outcomes: {
          created: 118,
          imported_without_structure: 2,
          not_supported: 4,
        },
        byKind: {
          plan_workout: { created: 118, imported_without_structure: 2 },
          rx_workout: { not_supported: 4 },
        },
      },
      issues: [
        {
          kind: 'plan_workout',
          trainingPeaksId: '1',
          title: 'W1',
          outcome: 'imported_without_structure',
          code: 'x',
          message: 'm',
          path: '$.a',
        },
      ],
      createdAt: '2026-09-26T10:00:00.000Z',
      updatedAt: '2026-09-26T10:00:05.000Z',
    });

    // Missing outcome keys default to zero so consumers need no guards.
    expect(parsed.summary?.outcomes.skipped).toBe(0);
    expect(parsed.summary?.byKind.rx_workout.not_supported).toBe(4);
    expect(parsed.issues).toHaveLength(1);
  });

  it('keeps an outcome this build does not know', () => {
    const parsed = PlanImportResponseSchema.parse({
      importId: 'imp-1',
      status: 'completed',
      environment: 'sandbox',
      trainingPeaksPlanId: 1,
      declaredCounts: COUNTS,
      receivedCounts: COUNTS,
      failureCode: null,
      summary: {
        workoutPlanId: null,
        outcomes: { created: 1, relocated: 2 },
        byKind: {},
      },
      issues: [],
      createdAt: 'x',
      updatedAt: 'y',
    });

    expect(parsed.summary?.outcomes).toMatchObject({
      created: 1,
      relocated: 2,
    });
  });

  it('rejects a status outside the contract, since polling depends on it', () => {
    expect(
      PlanImportResponseSchema.safeParse({
        importId: 'imp-1',
        status: 'paused',
        environment: 'production',
        trainingPeaksPlanId: 1,
        declaredCounts: COUNTS,
        receivedCounts: COUNTS,
        failureCode: null,
        summary: null,
        issues: [],
        createdAt: 'x',
        updatedAt: 'y',
      }).success
    ).toBe(false);
  });
});

describe('isTerminalPlanImportStatus', () => {
  it('is true for exactly the four terminal statuses', () => {
    const terminal = PLAN_IMPORT_STATUSES.filter(isTerminalPlanImportStatus);
    expect(terminal).toEqual([
      'completed',
      'completed_with_issues',
      'failed',
      'abandoned',
    ]);
  });
});

describe('PlanImportPartResponseSchema', () => {
  it('parses a recorded part', () => {
    const parsed = PlanImportPartResponseSchema.parse({
      importId: 'imp-1',
      kind: 'plan_workouts',
      partIndex: 0,
      itemCount: 50,
      alreadyRecorded: true,
      receivedCounts: COUNTS,
    });

    expect(parsed.alreadyRecorded).toBe(true);
  });
});

describe('PlanImportActiveConflictSchema', () => {
  it('reads the 409 details for an active import', () => {
    const parsed = PlanImportActiveConflictSchema.parse({
      reason: 'active_import',
      activeImportId: 'imp-9',
      activeImportStatus: 'processing',
    });

    expect(parsed.activeImportId).toBe('imp-9');
  });

  it('does not match the other 409 shape', () => {
    expect(
      PlanImportActiveConflictSchema.safeParse({
        reason: 'count_mismatch',
        declaredCounts: COUNTS,
        receivedCounts: COUNTS,
      }).success
    ).toBe(false);
  });
});
