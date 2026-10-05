/**
 * TrainingPlanList component
 *
 * Displays list of training plans with loading, error, and empty states
 */

import { useState, useMemo, useEffect, useRef, type ReactElement } from 'react';
import { useTrainingPlans } from '@/hooks/useTrainingPlans';
import { useTrainingPlanFolders } from '@/hooks/useTrainingPlanFolders';
import { groupPlansByFolder } from '@/utils/planFolderGrouping';
import { TrainingPlanCard } from './TrainingPlanCard';
import { SearchBar } from './SearchBar';
import { EmptyState } from './EmptyState';
import { LoadingSpinner } from './LoadingSpinner';
import { ExportDialog, ExportResult, getExportResultKey } from './export';
import {
  is401Error,
  is403Error,
  getUserFriendlyErrorMessage,
} from '@/utils/trainingPeaksTab';
import { useProviderAuthRefresh } from '@/hooks/useProviderAuthRefresh';
import {
  logApiResponseError,
  logErrorWithAuthDowngrade,
} from '@/utils/apiErrorLogging';
import type {
  ApiResponse,
  TrainingPlan,
  PlanWorkout,
  CalendarNote,
  CalendarEvent,
  RxBuilderWorkout,
} from '@/types/api.types';
import type { ExportResult as ExportResultType } from '@/export/adapters/base';
import type { ValidationMessage } from '@/export/adapters/base';
import type { ExportDestination } from '@/types/export.types';
import type { PlanMyPeakExportConfig } from '@/types/planMyPeak.types';
import type { PlanMyPeakAuthFailure } from '@/utils/planMyPeakAuthErrors';
import { PLANMYPEAK_AUTH_MESSAGES } from '@/utils/uiStrings';
import { importTrainingPlanToPlanMyPeak } from '@/export/adapters/planMyPeak';
import type {
  IntervalsIcuExportConfig,
  IntervalsTrainingPlanExportResult,
} from '@/types/intervalsicu.types';
import type {
  ExportTrainingPlanToIntervalsMessage,
  GetPlanEventsMessage,
  GetPlanNotesMessage,
  GetPlanWorkoutsMessage,
  GetRxBuilderWorkoutsMessage,
  TrainingPlanExportProgressMessage,
  TrainingPlanExportProgressPayload,
  TrainingPlanExportProgressStatus,
} from '@/types';
import type { TrainingPlanExportProgressDialogState } from './export/ExportDialog';

export interface TrainingPlanListProps {
  onSelectPlan: (planId: number) => void;
}

type PlanExportDialogConfig = PlanMyPeakExportConfig | IntervalsIcuExportConfig;

type TrainingPlanExportPhaseUiStatus =
  | 'pending'
  | TrainingPlanExportProgressStatus;

interface TrainingPlanBatchExportBundle {
  trainingPlan: TrainingPlan;
  workouts: PlanWorkout[];
  rxWorkouts: RxBuilderWorkout[];
  notes: CalendarNote[];
  events: CalendarEvent[];
  totalStepCount: number;
}

interface ActiveBatchTrainingPlanProgressContext {
  completedStepsBeforePlan: number;
  batchOverallTotal: number;
  planIndex: number;
  planCount: number;
  planName: string;
}

function getTrainingPlanExportPhaseLabel(
  phase: TrainingPlanExportProgressPayload['phase']
): string {
  switch (phase) {
    case 'folder':
      return 'Creating Plan Folder';
    case 'classicWorkouts':
      return 'Classic Workouts';
    case 'plan':
      return 'Training Plan';
    case 'entries':
      return 'Scheduling Workouts';
    case 'rxWorkouts':
      return 'Strength Workouts';
    case 'notes':
      return 'Notes';
    case 'events':
      return 'Events';
    case 'complete':
      return 'Completed';
    default:
      return 'Exporting';
  }
}

function createTrainingPlanExportId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `intervals-plan-export-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createPhaseRows(
  classicCount: number,
  rxCount: number,
  notesCount: number,
  eventsCount: number,
  folderStepCount = 1
): TrainingPlanExportProgressDialogState['phases'] {
  return [
    {
      id: 'folder',
      label: 'Creating Plan Folder',
      status: 'pending',
      current: 0,
      total: folderStepCount,
    },
    {
      id: 'classicWorkouts',
      label: 'Classic Workouts',
      status: 'pending',
      current: 0,
      total: classicCount,
    },
    {
      id: 'rxWorkouts',
      label: 'Strength Workouts',
      status: 'pending',
      current: 0,
      total: rxCount,
    },
    {
      id: 'notes',
      label: 'Notes',
      status: 'pending',
      current: 0,
      total: notesCount,
    },
    {
      id: 'events',
      label: 'Events',
      status: 'pending',
      current: 0,
      total: eventsCount,
    },
  ];
}

function createPreparationProgressState(
  totalPlans: number,
  completedPlans: number,
  currentPlanName?: string
): TrainingPlanExportProgressDialogState {
  return {
    overallCurrent: completedPlans,
    overallTotal: totalPlans,
    currentPhaseLabel: 'Loading Selected Plans',
    currentPhaseCurrent: completedPlans,
    currentPhaseTotal: totalPlans,
    currentItemName: currentPlanName,
    message: 'Fetching workouts, strength workouts, notes, and events...',
    phases: createPhaseRows(0, 0, 0, 0),
  };
}

function createPlanExecutionProgressState(
  bundle: TrainingPlanBatchExportBundle,
  context: ActiveBatchTrainingPlanProgressContext
): TrainingPlanExportProgressDialogState {
  return {
    overallCurrent: context.completedStepsBeforePlan,
    overallTotal: context.batchOverallTotal,
    currentPhaseLabel: `Plan ${context.planIndex}/${context.planCount} · Preparing export`,
    currentPhaseCurrent: 0,
    currentPhaseTotal: bundle.totalStepCount,
    currentItemName: context.planName,
    message: context.planName,
    phases: createPhaseRows(
      bundle.workouts.length,
      bundle.rxWorkouts.length,
      bundle.notes.length,
      bundle.events.length
    ),
  };
}

function getPlanMyPeakPlanStepCount(
  bundle: TrainingPlanBatchExportBundle
): number {
  return 2 + bundle.workouts.length + bundle.notes.length;
}

function createPlanMyPeakExecutionProgressState(
  bundle: TrainingPlanBatchExportBundle,
  context: ActiveBatchTrainingPlanProgressContext
): TrainingPlanExportProgressDialogState {
  return {
    overallCurrent: context.completedStepsBeforePlan,
    overallTotal: context.batchOverallTotal,
    currentPhaseLabel: `Plan ${context.planIndex}/${context.planCount} · Preparing export`,
    currentPhaseCurrent: 0,
    currentPhaseTotal: getPlanMyPeakPlanStepCount(bundle),
    currentItemName: context.planName,
    message: context.planName,
    phases: createPhaseRows(
      bundle.workouts.length,
      0,
      bundle.notes.length,
      0,
      2
    ),
  };
}

function applyBatchTrainingPlanExportProgressUpdate(
  previous: TrainingPlanExportProgressDialogState | null,
  update: TrainingPlanExportProgressPayload,
  context: ActiveBatchTrainingPlanProgressContext
): TrainingPlanExportProgressDialogState | null {
  if (!previous) {
    return previous;
  }

  const nextPhases = previous.phases.map((phase) => {
    if (update.phase === 'complete' || phase.id !== update.phase) {
      return phase;
    }

    return {
      ...phase,
      status: update.status as TrainingPlanExportPhaseUiStatus,
      current: update.current,
      total: update.total,
      itemName: update.itemName,
      message: update.message,
    };
  });

  return {
    ...previous,
    overallCurrent: Math.min(
      context.batchOverallTotal,
      context.completedStepsBeforePlan + update.overallCurrent
    ),
    overallTotal: context.batchOverallTotal,
    currentPhaseLabel:
      update.status === 'failed'
        ? `Plan ${context.planIndex}/${context.planCount} · Failed`
        : `Plan ${context.planIndex}/${context.planCount} · ${getTrainingPlanExportPhaseLabel(update.phase)}`,
    currentPhaseCurrent: update.current,
    currentPhaseTotal: update.total,
    currentItemName: update.itemName || context.planName,
    message: update.message || context.planName,
    phases: nextPhases,
  };
}

async function fetchPlanWorkoutsForExport(
  planId: number
): Promise<PlanWorkout[]> {
  const response = await chrome.runtime.sendMessage<
    GetPlanWorkoutsMessage,
    ApiResponse<PlanWorkout[]>
  >({
    type: 'GET_PLAN_WORKOUTS',
    planId,
  });

  if (response.success) {
    return response.data;
  }

  logApiResponseError(
    `[TrainingPlanList] Failed to fetch plan workouts for plan ${planId}:`,
    response.error
  );
  throw new Error(response.error.message || 'Failed to fetch plan workouts');
}

async function fetchRxBuilderWorkoutsForExport(
  planId: number
): Promise<RxBuilderWorkout[]> {
  const response = await chrome.runtime.sendMessage<
    GetRxBuilderWorkoutsMessage,
    ApiResponse<RxBuilderWorkout[]>
  >({
    type: 'GET_RX_BUILDER_WORKOUTS',
    planId,
  });

  if (response.success) {
    return response.data;
  }

  logApiResponseError(
    `[TrainingPlanList] Failed to fetch RxBuilder workouts for plan ${planId}:`,
    response.error
  );
  throw new Error(
    response.error.message || 'Failed to fetch RxBuilder workouts'
  );
}

async function fetchPlanNotesForExport(
  planId: number
): Promise<CalendarNote[]> {
  const response = await chrome.runtime.sendMessage<
    GetPlanNotesMessage,
    ApiResponse<CalendarNote[]>
  >({
    type: 'GET_PLAN_NOTES',
    planId,
  });

  if (response.success) {
    return response.data;
  }

  logApiResponseError(
    `[TrainingPlanList] Failed to fetch plan notes for plan ${planId}:`,
    response.error
  );
  throw new Error(response.error.message || 'Failed to fetch plan notes');
}

async function fetchPlanEventsForExport(
  planId: number
): Promise<CalendarEvent[]> {
  const response = await chrome.runtime.sendMessage<
    GetPlanEventsMessage,
    ApiResponse<CalendarEvent[]>
  >({
    type: 'GET_PLAN_EVENTS',
    planId,
  });

  if (response.success) {
    return response.data;
  }

  logApiResponseError(
    `[TrainingPlanList] Failed to fetch plan events for plan ${planId}:`,
    response.error
  );
  throw new Error(response.error.message || 'Failed to fetch plan events');
}

async function fetchTrainingPlanBatchExportBundle(
  trainingPlan: TrainingPlan
): Promise<TrainingPlanBatchExportBundle> {
  const [workouts, rxWorkouts, notes, events] = await Promise.all([
    fetchPlanWorkoutsForExport(trainingPlan.planId),
    fetchRxBuilderWorkoutsForExport(trainingPlan.planId),
    fetchPlanNotesForExport(trainingPlan.planId),
    fetchPlanEventsForExport(trainingPlan.planId),
  ]);

  return {
    trainingPlan,
    workouts,
    rxWorkouts,
    notes,
    events,
    totalStepCount:
      1 + workouts.length + rxWorkouts.length + notes.length + events.length,
  };
}

/** Bucket id for plans TrainingPeaks has not filed in any folder. */

export function TrainingPlanList({
  onSelectPlan,
}: TrainingPlanListProps): ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const tpAuthRefresh = useProviderAuthRefresh('trainingpeaks');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<number>>(
    new Set()
  );
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResultType | null>(
    null
  );
  const [trainingPlanExportProgress, setTrainingPlanExportProgress] =
    useState<TrainingPlanExportProgressDialogState | null>(null);
  const activeTrainingPlanExportIdRef = useRef<string | null>(null);
  const activeBatchTrainingPlanProgressContextRef =
    useRef<ActiveBatchTrainingPlanProgressContext | null>(null);
  const { data: plans, isLoading, error, refetch } = useTrainingPlans();
  const { data: planFolders } = useTrainingPlanFolders();
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Filter plans based on search query
  const filteredPlans = useMemo(() => {
    if (!plans) return [];
    if (!searchQuery) return plans;

    const query = searchQuery.toLowerCase();
    return plans.filter(
      (plan) =>
        plan.title.toLowerCase().includes(query) ||
        plan.author.toLowerCase().includes(query)
    );
  }, [plans, searchQuery]);

  /**
   * Plans grouped by their TrainingPeaks folder.
   *
   * Membership lives on the folder, so a plan's group is found by looking its id
   * up across folders. Plans in no folder get an "Ungrouped" bucket rather than
   * being hidden — a plan that belongs to nothing must still be reachable.
   */
  const folderGroups = useMemo(
    () => groupPlansByFolder(filteredPlans, planFolders),
    [planFolders, filteredPlans]
  );

  const openFolder = useMemo(
    () => folderGroups.find((group) => group.id === selectedFolderId) ?? null,
    [folderGroups, selectedFolderId]
  );

  /** The plans the list is currently showing: one folder's, once one is open. */
  const visiblePlans = openFolder ? openFolder.plans : filteredPlans;

  const selectedPlans = useMemo(() => {
    if (!plans || selectedPlanIds.size === 0) {
      return [] as TrainingPlan[];
    }

    return plans.filter((plan) => selectedPlanIds.has(plan.planId));
  }, [plans, selectedPlanIds]);

  const selectedPlanWorkoutCount = useMemo(
    () =>
      selectedPlans.reduce(
        (total, plan) =>
          total + (Number.isFinite(plan.workoutCount) ? plan.workoutCount : 0),
        0
      ),
    [selectedPlans]
  );

  useEffect(() => {
    const handleRuntimeMessage = (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: unknown) => void
    ): void => {
      if (
        !message ||
        typeof message !== 'object' ||
        (message as { type?: unknown }).type !== 'TRAINING_PLAN_EXPORT_PROGRESS'
      ) {
        return;
      }

      const progressMessage = message as TrainingPlanExportProgressMessage;
      if (
        !activeTrainingPlanExportIdRef.current ||
        progressMessage.exportId !== activeTrainingPlanExportIdRef.current
      ) {
        return;
      }

      const context = activeBatchTrainingPlanProgressContextRef.current;
      if (!context) {
        return;
      }

      setTrainingPlanExportProgress((previous) =>
        applyBatchTrainingPlanExportProgressUpdate(
          previous,
          progressMessage.progress,
          context
        )
      );
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, []);

  // Selection handlers
  const handleSelectionChange = (planId: number, selected: boolean): void => {
    setSelectedPlanIds((prev) => {
      const newSet = new Set(prev);
      if (selected) {
        newSet.add(planId);
      } else {
        newSet.delete(planId);
      }
      return newSet;
    });
  };

  const handleSelectAll = (): void => {
    const allIds = new Set(visiblePlans.map((plan) => plan.planId));
    setSelectedPlanIds(allIds);
  };

  const handleClearSelection = (): void => {
    setSelectedPlanIds(new Set());
  };

  const handleExitSelectionMode = (): void => {
    setSelectionMode(false);
    setSelectedPlanIds(new Set());
  };

  const handleEnterSelectionMode = (): void => {
    setSelectionMode(true);
  };

  const handleExportSelected = (): void => {
    if (selectedPlanIds.size === 0) {
      return;
    }

    setIsExportDialogOpen(true);
  };

  const closeExportDialog = (): void => {
    if (isExporting) {
      return;
    }

    activeTrainingPlanExportIdRef.current = null;
    activeBatchTrainingPlanProgressContextRef.current = null;
    setTrainingPlanExportProgress(null);
    setIsExportDialogOpen(false);
  };

  const closeExportResult = (): void => {
    setExportResult(null);
  };

  const preloadSelectedPlanBundles = async (
    plansToExport: TrainingPlan[]
  ): Promise<TrainingPlanBatchExportBundle[]> => {
    const bundles: TrainingPlanBatchExportBundle[] = [];
    setTrainingPlanExportProgress(
      createPreparationProgressState(plansToExport.length, 0)
    );

    for (let i = 0; i < plansToExport.length; i++) {
      const plan = plansToExport[i];
      setTrainingPlanExportProgress(
        createPreparationProgressState(plansToExport.length, i, plan.title)
      );
      const bundle = await fetchTrainingPlanBatchExportBundle(plan);
      bundles.push(bundle);
      setTrainingPlanExportProgress(
        createPreparationProgressState(plansToExport.length, i + 1, plan.title)
      );
    }

    return bundles;
  };

  const exportSelectedPlansToPlanMyPeak = async (
    plansToExport: TrainingPlan[],
    config: PlanMyPeakExportConfig
  ): Promise<void> => {
    const bundles = await preloadSelectedPlanBundles(plansToExport);
    const batchOverallTotal = bundles.reduce(
      (sum, bundle) => sum + getPlanMyPeakPlanStepCount(bundle),
      0
    );
    activeTrainingPlanExportIdRef.current = null;
    activeBatchTrainingPlanProgressContextRef.current = null;

    let successCount = 0;
    let exportedWorkoutCount = 0;
    let completedSteps = 0;
    const warnings: ValidationMessage[] = [];
    const errors: string[] = [];
    let authFailure: PlanMyPeakAuthFailure | undefined;

    for (let i = 0; i < bundles.length; i++) {
      const bundle = bundles[i];
      const planName = bundle.trainingPlan.title;

      // The credential is gone for the rest of the batch; say so once per
      // plan not reached instead of repeating the auth error for each.
      if (authFailure) {
        warnings.push({
          field: 'trainingPlans',
          severity: 'warning',
          message: `${planName}: ${PLANMYPEAK_AUTH_MESSAGES.STOPPED_AFTER_AUTH_FAILURE}`,
        });
        continue;
      }

      const context: ActiveBatchTrainingPlanProgressContext = {
        completedStepsBeforePlan: completedSteps,
        batchOverallTotal,
        planIndex: i + 1,
        planCount: bundles.length,
        planName,
      };

      setTrainingPlanExportProgress(
        createPlanMyPeakExecutionProgressState(bundle, context)
      );

      try {
        const result = await importTrainingPlanToPlanMyPeak({
          trainingPlan: bundle.trainingPlan,
          workouts: bundle.workouts,
          notes: bundle.notes,
          config: {
            ...config,
            createFolder: true,
            // Deliberately not overridden with a decorated name. The single-plan
            // path sends the plan title, and since libraries are matched by name,
            // any difference here means the same plan gets two libraries
            // depending on which screen the import was started from.
            targetLibraryName: config.targetLibraryName || planName,
          },
          onProgress: (update) => {
            setTrainingPlanExportProgress((previous) =>
              applyBatchTrainingPlanExportProgressUpdate(
                previous,
                update,
                context
              )
            );
          },
        });

        authFailure = result.authFailure;

        if (result.success) {
          successCount += 1;
          exportedWorkoutCount += result.itemsExported;
        } else if (result.errors?.length) {
          warnings.push({
            field: 'trainingPlans',
            severity: 'warning',
            message: `Failed to export plan "${planName}": ${result.errors.join('; ')}`,
          });
        } else {
          warnings.push({
            field: 'trainingPlans',
            severity: 'warning',
            message: `Failed to export plan "${planName}"`,
          });
        }

        if (result.warnings.length > 0) {
          warnings.push(
            ...result.warnings.map((warning) => ({
              ...warning,
              field: `trainingPlans:${bundle.trainingPlan.planId}:${warning.field}`,
              message: `${planName}: ${warning.message}`,
            }))
          );
        }
      } catch (err) {
        logErrorWithAuthDowngrade(
          `[TrainingPlanList] Failed to export plan "${planName}" to PlanMyPeak:`,
          err
        );
        warnings.push({
          field: 'trainingPlans',
          severity: 'warning',
          message: `Failed to export plan "${planName}": ${
            err instanceof Error ? err.message : 'Unknown export error'
          }`,
        });
      } finally {
        completedSteps += getPlanMyPeakPlanStepCount(bundle);
      }
    }

    activeTrainingPlanExportIdRef.current = null;
    activeBatchTrainingPlanProgressContextRef.current = null;

    if (successCount === 0) {
      if (warnings.length > 0) {
        errors.push(...warnings.map((warning) => warning.message));
      } else {
        errors.push('No selected training plans were exported');
      }

      setExportResult({
        success: false,
        fileName: 'PlanMyPeak training plans',
        format: 'api',
        itemsExported: 0,
        warnings: [],
        errors,
        ...(authFailure ? { authFailure } : {}),
      });
      return;
    }

    if (successCount < bundles.length) {
      warnings.unshift({
        field: 'trainingPlans',
        severity: 'warning',
        message: `Exported ${successCount} of ${bundles.length} training plans`,
      });
    }

    setExportResult({
      success: true,
      fileName: `PlanMyPeak (${successCount}/${bundles.length} plans)`,
      format: 'api',
      itemsExported: exportedWorkoutCount,
      warnings,
      ...(authFailure ? { authFailure } : {}),
    });
  };

  const exportSelectedPlansToIntervals = async (
    plansToExport: TrainingPlan[],
    config: IntervalsIcuExportConfig
  ): Promise<void> => {
    const bundles = await preloadSelectedPlanBundles(plansToExport);
    const batchOverallTotal = bundles.reduce(
      (sum, bundle) => sum + bundle.totalStepCount,
      0
    );

    let completedSteps = 0;
    let exportedWorkoutCount = 0;
    let successCount = 0;
    const warnings: ValidationMessage[] = [];
    const errors: string[] = [];

    for (let i = 0; i < bundles.length; i++) {
      const bundle = bundles[i];
      const exportId = createTrainingPlanExportId();
      const context: ActiveBatchTrainingPlanProgressContext = {
        completedStepsBeforePlan: completedSteps,
        batchOverallTotal,
        planIndex: i + 1,
        planCount: bundles.length,
        planName: bundle.trainingPlan.title,
      };

      activeTrainingPlanExportIdRef.current = exportId;
      activeBatchTrainingPlanProgressContextRef.current = context;
      setTrainingPlanExportProgress(
        createPlanExecutionProgressState(bundle, context)
      );

      try {
        const response = await chrome.runtime.sendMessage<
          ExportTrainingPlanToIntervalsMessage,
          ApiResponse<IntervalsTrainingPlanExportResult>
        >({
          type: 'EXPORT_TRAINING_PLAN_TO_INTERVALS',
          exportId,
          existingPlanAction: config.existingPlanAction,
          trainingPlan: bundle.trainingPlan,
          workouts: bundle.workouts,
          rxWorkouts: bundle.rxWorkouts,
          notes: bundle.notes,
          events: bundle.events,
        });

        if (!response.success) {
          warnings.push({
            field: 'trainingPlans',
            severity: 'warning',
            message: `Failed to export plan "${bundle.trainingPlan.title}": ${response.error.message || 'Unknown error'}`,
          });
          continue;
        }

        successCount += 1;
        exportedWorkoutCount += response.data.workouts.length;
      } catch (err) {
        logErrorWithAuthDowngrade(
          `[TrainingPlanList] Failed to export plan "${bundle.trainingPlan.title}" to Intervals.icu:`,
          err
        );
        warnings.push({
          field: 'trainingPlans',
          severity: 'warning',
          message: `Failed to export plan "${bundle.trainingPlan.title}": ${
            err instanceof Error ? err.message : 'Unknown export error'
          }`,
        });
      } finally {
        completedSteps += bundle.totalStepCount;
      }
    }

    activeTrainingPlanExportIdRef.current = null;
    activeBatchTrainingPlanProgressContextRef.current = null;

    if (successCount === 0) {
      if (warnings.length > 0) {
        errors.push(...warnings.map((warning) => warning.message));
      } else {
        errors.push('No selected training plans were exported');
      }

      setExportResult({
        success: false,
        fileName: 'Intervals.icu training plans',
        format: 'api',
        itemsExported: 0,
        warnings: [],
        errors,
      });
      return;
    }

    if (successCount < bundles.length) {
      warnings.unshift({
        field: 'trainingPlans',
        severity: 'warning',
        message: `Exported ${successCount} of ${bundles.length} training plans`,
      });
    }

    setExportResult({
      success: true,
      fileName: `Intervals.icu (${successCount}/${bundles.length} plans)`,
      format: 'api',
      itemsExported: exportedWorkoutCount,
      warnings,
    });
  };

  const handleExportFromDialog = async (
    config: PlanExportDialogConfig,
    destination: ExportDestination
  ): Promise<void> => {
    if (selectedPlans.length === 0) {
      setIsExportDialogOpen(false);
      return;
    }

    setIsExporting(true);
    setExportResult(null);

    try {
      if (destination === 'planmypeak') {
        await exportSelectedPlansToPlanMyPeak(
          selectedPlans,
          config as PlanMyPeakExportConfig
        );
      } else if (destination === 'intervalsicu') {
        await exportSelectedPlansToIntervals(
          selectedPlans,
          config as IntervalsIcuExportConfig
        );
      }
    } catch (exportError) {
      logErrorWithAuthDowngrade(
        '[TrainingPlanList] Multi-plan export failed:',
        exportError
      );
      setExportResult({
        success: false,
        fileName: 'training_plans_export',
        format: 'api',
        itemsExported: 0,
        warnings: [],
        errors: [
          exportError instanceof Error
            ? exportError.message
            : 'Unknown export error',
        ],
      });
    } finally {
      setIsExporting(false);
      activeTrainingPlanExportIdRef.current = null;
      activeBatchTrainingPlanProgressContextRef.current = null;
      setTrainingPlanExportProgress(null);
      setIsExportDialogOpen(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Error state
  if (error) {
    const isAuthError = is401Error(error);
    const isPermissionError = is403Error(error);
    const friendlyMessage = getUserFriendlyErrorMessage(error);

    const handleRetry = async (): Promise<void> => {
      if (isAuthError) {
        // 401: refresh the token in a background tab, then retry ourselves.
        const result = await tpAuthRefresh.refresh();
        if (result.outcome === 'refreshed') {
          refetch();
        }
      } else {
        // For other errors, just retry the request
        refetch();
      }
    };

    return (
      <div className="p-4">
        <div className="p-4 bg-red-50 rounded-lg border border-red-200">
          <p className="text-sm font-medium text-red-800">
            Failed to Load Data
          </p>
          <p className="mt-1 text-xs text-red-600">{friendlyMessage}</p>
          {isAuthError && (
            <p className="mt-2 text-xs text-red-500" role="status">
              {tpAuthRefresh.message ??
                'Your TrainingPeaks sign-in expired. Refresh it in a background tab without leaving this page.'}
            </p>
          )}
          {isPermissionError && (
            <p className="mt-2 text-xs text-red-500">
              You don't have permission to access this content
            </p>
          )}
          <button
            onClick={handleRetry}
            disabled={tpAuthRefresh.isRefreshing}
            className="mt-3 text-sm text-red-600 hover:text-red-800 font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            {tpAuthRefresh.isRefreshing
              ? 'Refreshing…'
              : isAuthError
                ? 'Refresh TrainingPeaks sign-in'
                : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  // Empty state (no plans at all)
  if (!plans || plans.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          title="No Plans Found"
          message="You don't have any training plans yet."
        />
      </div>
    );
  }

  // No search results state
  if (filteredPlans.length === 0) {
    return (
      <div className="mt-4">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search plans..."
        />
        <div className="mt-4">
          <EmptyState
            title="No Plans Found"
            message={`No plans match "${searchQuery}"`}
          />
        </div>
      </div>
    );
  }

  // Folder listing: the first thing shown, mirroring how TrainingPeaks groups
  // plans. Opening one drills into its plans.
  if (!openFolder) {
    return (
      <div className="mt-4">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search plans..."
        />

        <ul className="mt-4 space-y-2">
          {folderGroups.map((group) => (
            <li key={group.id}>
              <button
                type="button"
                onClick={() => setSelectedFolderId(group.id)}
                className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2.5 text-left hover:border-blue-300 hover:bg-blue-50"
              >
                <span className="text-sm font-medium text-gray-800">
                  {group.name}
                </span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                  {group.plans.length}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {folderGroups.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No Plans Found"
              message={
                searchQuery
                  ? `No plans match "${searchQuery}"`
                  : "You don't have any training plans yet."
              }
            />
          </div>
        ) : null}
      </div>
    );
  }

  // Success state with plans
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setSelectedFolderId(null)}
        className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
      >
        ← All plan libraries
      </button>
      <p className="mb-2 text-sm font-semibold text-gray-800">
        {openFolder.name}
      </p>
      <SearchBar
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search plans..."
      />

      {/* Selection Mode Toolbar */}
      {selectionMode ? (
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg overflow-hidden">
          <div className="p-3 flex items-center justify-between border-b border-blue-200">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-blue-900">
                {selectedPlanIds.size} selected
              </span>
              <div className="h-4 w-px bg-blue-300"></div>
              <button
                onClick={handleSelectAll}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium underline-offset-2 hover:underline"
              >
                Select All ({visiblePlans.length})
              </button>
              {selectedPlanIds.size > 0 && (
                <button
                  onClick={handleClearSelection}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium underline-offset-2 hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <button
              onClick={handleExitSelectionMode}
              className="text-gray-500 hover:text-gray-700"
              aria-label="Exit selection mode"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div className="p-3 bg-white">
            <button
              onClick={handleExportSelected}
              disabled={selectedPlanIds.size === 0}
              className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm rounded-md font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600 flex items-center justify-center gap-2"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Export{' '}
              {selectedPlanIds.size > 0 ? `${selectedPlanIds.size} ` : ''}
              {selectedPlanIds.size === 1 ? 'Plan' : 'Plans'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleEnterSelectionMode}
            className="px-4 py-2 text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-2 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Export Multiple Plans
          </button>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {visiblePlans.map((plan) => (
          <TrainingPlanCard
            key={plan.planId}
            plan={plan}
            onClick={onSelectPlan}
            selectionMode={selectionMode}
            isSelected={selectedPlanIds.has(plan.planId)}
            onSelectionChange={handleSelectionChange}
          />
        ))}
      </div>

      <ExportDialog
        key={`multi-plan-export-${isExportDialogOpen ? 'open' : 'closed'}`}
        isOpen={isExportDialogOpen}
        onClose={closeExportDialog}
        onExport={handleExportFromDialog}
        itemCount={selectedPlanWorkoutCount}
        isExporting={isExporting}
        exportScope="trainingPlans"
        sourceTrainingPlanNames={selectedPlans.map((plan) => plan.title)}
        trainingPlanCount={selectedPlans.length}
        trainingPlanExportProgress={trainingPlanExportProgress || undefined}
      />

      {exportResult && (
        <ExportResult
          key={getExportResultKey(exportResult)}
          result={exportResult}
          onClose={closeExportResult}
        />
      )}
    </div>
  );
}
