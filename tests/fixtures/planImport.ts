/**
 * A `TrainingPeaksPlanImportResponse` as the PlanMyPeak import routes return
 * it, with every count zero and no issues unless overridden.
 */

import type {
  PlanImportOutcomeCounts,
  PlanImportResponse,
} from '@/schemas/planMyPeakPlanImport.schema';

export function outcomeCounts(
  overrides: Partial<PlanImportOutcomeCounts> = {}
): PlanImportOutcomeCounts {
  return {
    created: 0,
    updated: 0,
    superseded: 0,
    imported_without_structure: 0,
    skipped: 0,
    failed: 0,
    not_supported: 0,
    ...overrides,
  };
}

export function planImportResponse(
  overrides: Partial<PlanImportResponse> = {}
): PlanImportResponse {
  return {
    importId: 'imp-1',
    status: 'staging',
    environment: 'production',
    trainingPeaksPlanId: 100,
    declaredCounts: {
      planWorkouts: 0,
      calendarNotes: 0,
      calendarEvents: 0,
      rxWorkouts: 0,
    },
    receivedCounts: {
      planWorkouts: 0,
      calendarNotes: 0,
      calendarEvents: 0,
      rxWorkouts: 0,
    },
    failureCode: null,
    summary: null,
    issues: [],
    createdAt: '2026-09-26T10:00:00.000Z',
    updatedAt: '2026-09-26T10:00:00.000Z',
    ...overrides,
  };
}
