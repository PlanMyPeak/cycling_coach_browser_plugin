import { describe, it, expect } from 'vitest';
import {
  exportResultFromPlanImport,
  importedSessionCount,
  planImportIssueMessage,
} from '@/export/adapters/planMyPeak/planImportResult';
import {
  outcomeCounts,
  planImportResponse,
} from '../../../../fixtures/planImport';

const ISSUE = {
  kind: 'plan_workout',
  trainingPeaksId: '12345',
  title: 'Sweet Spot 3x12',
  outcome: 'imported_without_structure',
  code: 'unsupported_target_unit',
  message: 'Target unit "furlongsPerFortnight" is not supported',
  path: '$.structure.structure[2].steps[0].targets[0].unit',
};

describe('exportResultFromPlanImport', () => {
  it('maps completed_with_issues to a success with the server message verbatim', () => {
    const response = planImportResponse({
      status: 'completed_with_issues',
      summary: {
        workoutPlanId: 'wp-1',
        outcomes: outcomeCounts({
          created: 118,
          imported_without_structure: 2,
          not_supported: 4,
        }),
        byKind: {
          plan: outcomeCounts({ updated: 1 }),
          plan_workout: outcomeCounts({
            created: 118,
            imported_without_structure: 2,
          }),
          calendar_note: outcomeCounts({ created: 3 }),
          calendar_event: outcomeCounts({ created: 1 }),
          rx_workout: outcomeCounts({ not_supported: 4 }),
        },
      },
      issues: [ISSUE],
    });

    const result = exportResultFromPlanImport(response, 'Base Build');

    expect(result.success).toBe(true);
    expect(result.fileName).toBe('Base Build');
    // Placed sessions only: 120 workouts + 3 notes + 1 event.
    expect(result.itemsExported).toBe(124);
    expect(result.planImport?.importId).toBe('imp-1');
    expect(result.planImport?.issues).toEqual([ISSUE]);

    const messages = result.warnings.map((warning) => warning.message);
    expect(messages[0]).toContain(ISSUE.message);
    expect(messages[0]).toContain(ISSUE.title);
    expect(messages[0]).toContain(ISSUE.path);
    expect(messages[0]).toContain('Imported without structure');
    expect(messages[1]).toContain(
      '4 strength-builder sessions were not imported'
    );
  });

  it('keeps warnings passed in ahead of the server issues', () => {
    const response = planImportResponse({ status: 'completed' });

    const result = exportResultFromPlanImport(response, 'Plan', [
      { field: 'plan', severity: 'warning', message: 'joined active import' },
    ]);

    expect(result.success).toBe(true);
    expect(result.warnings.map((warning) => warning.message)).toEqual([
      'joined active import',
    ]);
  });

  it('maps failed to errors naming the failure code and the failed items', () => {
    const response = planImportResponse({
      status: 'failed',
      failureCode: 'processing_stalled',
      summary: {
        workoutPlanId: null,
        outcomes: outcomeCounts({ failed: 1 }),
        byKind: { plan_workout: outcomeCounts({ failed: 1 }) },
      },
      issues: [
        {
          ...ISSUE,
          outcome: 'failed',
          code: 'db_error',
          message: 'Could not write workout',
          path: null,
        },
      ],
    });

    const result = exportResultFromPlanImport(response, 'Plan');

    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('processing_stalled');
    expect(result.errors?.[1]).toContain('Could not write workout');
    expect(result.warnings).toEqual([]);
  });

  it('maps abandoned to a failure', () => {
    const result = exportResultFromPlanImport(
      planImportResponse({ status: 'abandoned' }),
      'Plan'
    );

    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('abandoned');
  });
});

describe('importedSessionCount', () => {
  it('falls back to the overall outcomes when no placed kind is reported', () => {
    const response = planImportResponse({
      status: 'completed',
      summary: {
        workoutPlanId: 'wp',
        outcomes: outcomeCounts({ created: 5, superseded: 2 }),
        byKind: {},
      },
    });

    expect(importedSessionCount(response)).toBe(7);
  });

  it('is zero without a summary', () => {
    expect(importedSessionCount(planImportResponse({ status: 'failed' }))).toBe(
      0
    );
  });
});

describe('planImportIssueMessage', () => {
  it('falls back to the TrainingPeaks id when there is no title', () => {
    const message = planImportIssueMessage({
      ...ISSUE,
      title: null,
      kind: 'calendar_event',
      outcome: 'skipped',
      path: null,
    });

    expect(message).toBe(`Event "12345" — Skipped: ${ISSUE.message}`);
  });
});
