/**
 * PlanCalendar component
 *
 * Main calendar container that fetches and displays training plan data
 * organized in a week-based calendar format
 */

import type { ReactElement } from 'react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePlanWorkouts } from '@/hooks/usePlanWorkouts';
import { usePlanNotes } from '@/hooks/usePlanNotes';
import { usePlanEvents } from '@/hooks/usePlanEvents';
import { useRxBuilderWorkouts } from '@/hooks/useRxBuilderWorkouts';
import { useTrainingPlans } from '@/hooks/useTrainingPlans';
import { LoadingSpinner } from './LoadingSpinner';
import { CalendarWeekRow } from './CalendarWeekRow';
import {
  ExportButton,
  ExportDialog,
  ExportResult,
  getExportResultKey,
} from './export';
import {
  findEarliestDate,
  normalizeToMonday,
  organizeByWeek,
} from '@/utils/dateUtils';
import { logger } from '@/utils/logger';
import {
  is401Error,
  is403Error,
  getUserFriendlyErrorMessage,
} from '@/utils/trainingPeaksTab';
import { useProviderAuthRefresh } from '@/hooks/useProviderAuthRefresh';
import { downloadJsonFile } from '@/utils/downloadJson';
import type {
  PlanWorkout,
  RxBuilderWorkout,
  CalendarNote,
  CalendarEvent,
  ApiResponse,
} from '@/types/api.types';
import type { ExportResult as ExportResultType } from '@/export/adapters/base';
import type { ExportDestination } from '@/types/export.types';
import type { PlanMyPeakExportConfig } from '@/types/planMyPeak.types';
import { importTrainingPlanToPlanMyPeak } from '@/export/adapters/planMyPeak';
import type {
  IntervalsIcuExportConfig,
  IntervalsPlanConflictAction,
} from '@/types/intervalsicu.types';
import type {
  ExportTrainingPlanToIntervalsMessage,
  TrainingPlanExportProgressMessage,
  TrainingPlanExportProgressPayload,
  TrainingPlanExportProgressStatus,
} from '@/types';
import type { IntervalsTrainingPlanExportResult } from '@/types/intervalsicu.types';

/**
 * Unified workout type that includes both classic and RxBuilder workouts
 * with a discriminator field to distinguish between them
 */
export type UnifiedWorkout =
  | (PlanWorkout & { workoutSource: 'classic' })
  | (RxBuilderWorkout & { workoutSource: 'rxBuilder' });

export interface PlanCalendarProps {
  planId: number;
  planName?: string;
  onBack?: () => void;
}

type PlanExportDialogConfig = PlanMyPeakExportConfig | IntervalsIcuExportConfig;

type TrackedTrainingPlanExportPhase =
  | 'folder'
  | 'classicWorkouts'
  | 'rxWorkouts'
  | 'plan'
  | 'entries'
  | 'notes'
  | 'events';

type TrainingPlanExportPhaseUiStatus =
  | 'pending'
  | TrainingPlanExportProgressStatus;

interface TrainingPlanExportPhaseViewState {
  label: string;
  status: TrainingPlanExportPhaseUiStatus;
  current: number;
  total: number;
  itemName?: string;
  message?: string;
}

interface TrainingPlanExportProgressViewState {
  exportId: string;
  overallCurrent: number;
  overallTotal: number;
  currentPhaseLabel: string;
  currentPhaseCurrent: number;
  currentPhaseTotal: number;
  currentItemName?: string;
  message?: string;
  phases: Record<
    TrackedTrainingPlanExportPhase,
    TrainingPlanExportPhaseViewState
  >;
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

function createInitialTrainingPlanExportProgressState(
  exportId: string,
  classicCount: number,
  rxCount: number,
  notesCount: number,
  eventsCount: number,
  folderStepCount = 1
): TrainingPlanExportProgressViewState {
  const overallTotal =
    folderStepCount + classicCount + rxCount + notesCount + eventsCount;

  return {
    exportId,
    overallCurrent: 0,
    overallTotal,
    currentPhaseLabel: 'Preparing export',
    currentPhaseCurrent: 0,
    currentPhaseTotal: overallTotal,
    phases: {
      folder: {
        label: getTrainingPlanExportPhaseLabel('folder'),
        status: 'pending',
        current: 0,
        total: folderStepCount,
      },
      plan: {
        label: getTrainingPlanExportPhaseLabel('plan'),
        status: 'pending',
        current: 0,
        total: 1,
      },
      entries: {
        label: getTrainingPlanExportPhaseLabel('entries'),
        status: 'pending',
        current: 0,
        total: classicCount,
      },
      classicWorkouts: {
        label: getTrainingPlanExportPhaseLabel('classicWorkouts'),
        status: 'pending',
        current: 0,
        total: classicCount,
      },
      rxWorkouts: {
        label: getTrainingPlanExportPhaseLabel('rxWorkouts'),
        status: 'pending',
        current: 0,
        total: rxCount,
      },
      notes: {
        label: getTrainingPlanExportPhaseLabel('notes'),
        status: 'pending',
        current: 0,
        total: notesCount,
      },
      events: {
        label: getTrainingPlanExportPhaseLabel('events'),
        status: 'pending',
        current: 0,
        total: eventsCount,
      },
    },
  };
}

function applyTrainingPlanExportProgressUpdate(
  previous: TrainingPlanExportProgressViewState | null,
  update: TrainingPlanExportProgressPayload
): TrainingPlanExportProgressViewState | null {
  if (!previous) {
    return previous;
  }

  const next: TrainingPlanExportProgressViewState = {
    ...previous,
    overallCurrent: update.overallCurrent,
    overallTotal: update.overallTotal,
    currentPhaseLabel:
      update.status === 'failed'
        ? 'Failed'
        : getTrainingPlanExportPhaseLabel(update.phase),
    currentPhaseCurrent: update.current,
    currentPhaseTotal: update.total,
    currentItemName: update.itemName,
    message: update.message,
    phases: { ...previous.phases },
  };

  if (update.phase !== 'complete') {
    const phaseState = previous.phases[update.phase];
    next.phases[update.phase] = {
      ...phaseState,
      status: update.status,
      current: update.current,
      total: update.total,
      itemName: update.itemName,
      message: update.message,
    };
  }

  return next;
}

/**
 * Parse date string to Date object
 *
 * IMPORTANT: All dates are created at UTC midnight to match dateUtils.ts
 * which uses UTC methods (getUTCDay, setUTCDate, etc.)
 *
 * Extracts only the date part (YYYY-MM-DD) from any format:
 * - "2026-02-25" (RxBuilder date-only)
 * - "2026-02-24T00:00:00" (classic datetime)
 * - Future: "2026-02-24T00:00:00Z" (with timezone)
 *
 * This ensures consistent behavior regardless of:
 * - User's local timezone
 * - Whether API includes time/timezone info
 * - Browser's date parsing quirks
 */
function parseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;

  // Extract YYYY-MM-DD from any ISO 8601 format
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    logger.warn('Invalid date format:', dateStr);
    return null;
  }

  const [, year, month, day] = match.map(Number);
  return new Date(Date.UTC(year, month - 1, day)); // Always UTC midnight
}

/**
 * Extract date from unified workout (handles both classic and RxBuilder)
 */
function getWorkoutDate(workout: UnifiedWorkout): Date | null {
  if (workout.workoutSource === 'classic') {
    return parseDate(workout.workoutDay);
  } else {
    return parseDate(workout.prescribedDate);
  }
}

/**
 * PlanCalendar component displays training plan in week-based calendar format
 *
 * @param props.planId - ID of the training plan
 * @param props.planName - Optional name of the plan to display
 * @param props.onBack - Optional callback when back button is clicked
 */
export function PlanCalendar({
  planId,
  planName,
  onBack,
}: PlanCalendarProps): ReactElement {
  const queryClient = useQueryClient();
  const tpAuthRefresh = useProviderAuthRefresh('trainingpeaks');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExportingToIntervals, setIsExportingToIntervals] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResultType | null>(
    null
  );
  const [trainingPlanExportProgress, setTrainingPlanExportProgress] =
    useState<TrainingPlanExportProgressViewState | null>(null);
  const activeTrainingPlanExportIdRef = useRef<string | null>(null);

  // Fetch all data in parallel
  const {
    data: classicWorkouts,
    isLoading: workoutsLoading,
    error: workoutsError,
    refetch: refetchWorkouts,
  } = usePlanWorkouts(planId);

  const {
    data: rxWorkouts,
    isLoading: rxWorkoutsLoading,
    error: rxWorkoutsError,
    refetch: refetchRxWorkouts,
  } = useRxBuilderWorkouts(planId);

  const {
    data: notes,
    isLoading: notesLoading,
    error: notesError,
    refetch: refetchNotes,
  } = usePlanNotes(planId);

  const {
    data: events,
    isLoading: eventsLoading,
    error: eventsError,
    refetch: refetchEvents,
  } = usePlanEvents(planId);

  const { data: trainingPlans } = useTrainingPlans();
  const selectedTrainingPlan = useMemo(
    () => trainingPlans?.find((plan) => plan.planId === planId),
    [trainingPlans, planId]
  );

  // Merge classic and RxBuilder workouts into unified array with deduplication
  const workouts = useMemo((): UnifiedWorkout[] => {
    const seen = new Set<string>();

    // Process classic workouts first
    const classic: UnifiedWorkout[] = (classicWorkouts || [])
      .map((w) => ({
        ...w,
        workoutSource: 'classic' as const,
      }))
      .filter((w) => {
        const key = `classic-${w.workoutId}`;
        if (seen.has(key)) {
          logger.warn('Duplicate classic workout detected:', w.workoutId);
          return false;
        }
        seen.add(key);
        return true;
      });

    // Process RxBuilder workouts with separate namespace
    const rx: UnifiedWorkout[] = (rxWorkouts || [])
      .map((w) => ({
        ...w,
        workoutSource: 'rxBuilder' as const,
      }))
      .filter((w) => {
        const key = `rx-${w.id}`;
        if (seen.has(key)) {
          logger.warn('Duplicate RxBuilder workout detected:', w.id);
          return false;
        }
        seen.add(key);
        return true;
      });

    return [...classic, ...rx];
  }, [classicWorkouts, rxWorkouts]);

  // Refresh all plan data
  const handleRefresh = async (): Promise<void> => {
    setIsRefreshing(true);
    try {
      logger.info('🔄 Refreshing plan data for planId:', planId);

      // Remove all cached data for this plan and force network refetch
      await queryClient.resetQueries({ queryKey: ['plans', planId] });

      // Wait for all refetches to complete with fresh data
      const results = await Promise.all([
        refetchWorkouts(),
        refetchRxWorkouts(),
        refetchNotes(),
        refetchEvents(),
      ]);

      logger.info('✅ Refresh complete:', {
        classicWorkouts: results[0].data?.length || 0,
        rxWorkouts: results[1].data?.length || 0,
        notes: results[2].data?.length || 0,
        events: results[3].data?.length || 0,
      });

      // Log all workout dates for debugging
      if (results[0].data) {
        logger.info('Classic workout dates:');
        results[0].data.forEach((w) => {
          logger.info(
            `  - ${w.workoutDay}: ${w.title || '(no title)'} (Type: ${w.workoutTypeValueId})`
          );
        });
      }
      if (results[1].data) {
        logger.info('RxBuilder workout dates:');
        results[1].data.forEach((w) => {
          logger.info(`  - ${w.prescribedDate}: ${w.title} (${w.workoutType})`);
        });
      }
    } catch (error) {
      logger.error('❌ Refresh failed:', error);
    } finally {
      // Keep spinner visible for at least 500ms for visual feedback
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  // Debug logging to see workout data
  useEffect(() => {
    if (workouts.length > 0) {
      logger.info('Total workouts loaded:', workouts.length);
      const classicCount = workouts.filter(
        (w) => w.workoutSource === 'classic'
      ).length;
      const rxCount = workouts.filter(
        (w) => w.workoutSource === 'rxBuilder'
      ).length;
      logger.info(`  - Classic: ${classicCount}, RxBuilder: ${rxCount}`);
    }
  }, [workouts]);

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

      setTrainingPlanExportProgress((previous) =>
        applyTrainingPlanExportProgressUpdate(
          previous,
          progressMessage.progress
        )
      );
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, []);

  // Download training plan as JSON
  const handleDownload = (customFileName?: string): void => {
    const exportDate = new Date();
    const exportDateIso = exportDate.toISOString();
    const planData = {
      planId,
      planName: planName || 'Training Plan',
      exportDate: exportDateIso,
      classicWorkouts: classicWorkouts || [],
      rxBuilderWorkouts: rxWorkouts || [],
      notes: notes || [],
      events: events || [],
      summary: {
        totalClassicWorkouts: classicWorkouts?.length || 0,
        totalRxBuilderWorkouts: rxWorkouts?.length || 0,
        totalNotes: notes?.length || 0,
        totalEvents: events?.length || 0,
      },
    };

    const defaultFileName = `training-plan-${planId}-${
      exportDateIso.split('T')[0]
    }.json`;
    const fileName =
      customFileName && customFileName.trim().length > 0
        ? `${customFileName.trim()}.json`
        : defaultFileName;
    downloadJsonFile(planData, fileName);

    logger.info('📥 Training plan downloaded:', fileName);
  };

  const openExportDialog = (): void => {
    setIsExportDialogOpen(true);
  };

  const closeExportDialog = (): void => {
    if (isExportingToIntervals) {
      return;
    }
    activeTrainingPlanExportIdRef.current = null;
    setTrainingPlanExportProgress(null);
    setIsExportDialogOpen(false);
  };

  const handleExportToIntervals = async (
    existingPlanAction?: IntervalsPlanConflictAction
  ): Promise<void> => {
    if (!selectedTrainingPlan) {
      setIsExportDialogOpen(false);
      setExportResult({
        success: false,
        fileName: 'intervals_icu_plan_export',
        format: 'api',
        itemsExported: 0,
        warnings: [],
        errors: [
          'Training plan metadata is not loaded yet. Please try again in a moment.',
        ],
      });
      return;
    }

    const classic = classicWorkouts || [];
    const strength = rxWorkouts || [];
    const planNotes = notes || [];
    const planEvents = events || [];
    const exportId = createTrainingPlanExportId();
    activeTrainingPlanExportIdRef.current = exportId;
    setTrainingPlanExportProgress(
      createInitialTrainingPlanExportProgressState(
        exportId,
        classic.length,
        strength.length,
        planNotes.length,
        planEvents.length
      )
    );
    setIsExportingToIntervals(true);

    try {
      logger.info(
        '📤 Exporting TP training plan to Intervals.icu PLAN folder:',
        selectedTrainingPlan.planId,
        selectedTrainingPlan.title,
        'classic workouts:',
        classic.length,
        'rx workouts:',
        strength.length,
        'notes:',
        planNotes.length,
        'events:',
        planEvents.length
      );

      const response = await chrome.runtime.sendMessage<
        ExportTrainingPlanToIntervalsMessage,
        ApiResponse<IntervalsTrainingPlanExportResult>
      >({
        type: 'EXPORT_TRAINING_PLAN_TO_INTERVALS',
        exportId,
        existingPlanAction,
        trainingPlan: selectedTrainingPlan,
        workouts: classic,
        rxWorkouts: strength,
        notes: planNotes,
        events: planEvents,
      });

      if (!response.success) {
        setExportResult({
          success: false,
          fileName: selectedTrainingPlan.title,
          format: 'api',
          itemsExported: 0,
          warnings: [],
          errors: [response.error.message || 'Failed to export training plan'],
        });
        return;
      }

      const warnings: ExportResultType['warnings'] = [];
      if (classic.length === 0) {
        warnings.push({
          field: 'classicWorkouts',
          severity: 'warning',
          message: 'No classic plan workouts were available to export',
        });
      }

      setExportResult({
        success: true,
        fileName: response.data.folder.name,
        format: 'api',
        itemsExported: response.data.workouts.length,
        warnings,
      });
    } catch (error) {
      logger.error('Failed to export training plan to Intervals.icu:', error);
      setExportResult({
        success: false,
        fileName: selectedTrainingPlan.title,
        format: 'api',
        itemsExported: 0,
        warnings: [],
        errors: [
          error instanceof Error ? error.message : 'Unknown export error',
        ],
      });
    } finally {
      setIsExportingToIntervals(false);
      activeTrainingPlanExportIdRef.current = null;
      setTrainingPlanExportProgress(null);
      setIsExportDialogOpen(false);
    }
  };

  const handleExportToPlanMyPeak = async (
    config: PlanMyPeakExportConfig
  ): Promise<void> => {
    if (!selectedTrainingPlan) {
      setIsExportDialogOpen(false);
      setExportResult({
        success: false,
        fileName: 'planmypeak_training_plan_export',
        format: 'api',
        itemsExported: 0,
        warnings: [],
        errors: [
          'Training plan metadata is not loaded yet. Please try again in a moment.',
        ],
      });
      return;
    }

    const classic = classicWorkouts || [];
    const planNotes = notes || [];
    const targetPlanName =
      selectedTrainingPlan.title || planName || `Training Plan ${planId}`;
    const exportId = createTrainingPlanExportId();

    activeTrainingPlanExportIdRef.current = exportId;
    setTrainingPlanExportProgress(
      createInitialTrainingPlanExportProgressState(
        exportId,
        classic.length,
        0,
        planNotes.length,
        0,
        2
      )
    );

    setIsExportingToIntervals(true);

    try {
      logger.info(
        '📤 Exporting TP training plan classic workouts to PlanMyPeak library:',
        planId,
        targetPlanName,
        'classic workouts:',
        classic.length
      );

      const result = await importTrainingPlanToPlanMyPeak({
        trainingPlan: selectedTrainingPlan,
        workouts: classic,
        notes: planNotes,
        config,
        onProgress: (update) => {
          setTrainingPlanExportProgress((previous) =>
            applyTrainingPlanExportProgressUpdate(previous, update)
          );
        },
      });

      setExportResult(result);
    } catch (error) {
      logger.error('Failed to export training plan to PlanMyPeak:', error);
      setExportResult({
        success: false,
        fileName: targetPlanName,
        format: 'api',
        itemsExported: 0,
        warnings: [],
        errors: [
          error instanceof Error ? error.message : 'Unknown export error',
        ],
      });
    } finally {
      setIsExportingToIntervals(false);
      activeTrainingPlanExportIdRef.current = null;
      setTrainingPlanExportProgress(null);
      setIsExportDialogOpen(false);
    }
  };

  const handleExportFromDialog = async (
    config: PlanExportDialogConfig,
    destination: ExportDestination
  ): Promise<void> => {
    if (destination === 'planmypeak') {
      await handleExportToPlanMyPeak(config as PlanMyPeakExportConfig);
      return;
    }

    const intervalsConfig = config as IntervalsIcuExportConfig;
    await handleExportToIntervals(intervalsConfig.existingPlanAction);
  };

  // Loading state
  const isLoading =
    workoutsLoading || rxWorkoutsLoading || notesLoading || eventsLoading;
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <LoadingSpinner />
        <p className="mt-4 text-gray-600">Loading training plan...</p>
      </div>
    );
  }

  // Error state
  const error = workoutsError || rxWorkoutsError || notesError || eventsError;
  if (error) {
    // Determine which data source failed and create detailed error message
    const errorContext = workoutsError
      ? {
          type: 'classic workouts',
          error: workoutsError,
          retry: refetchWorkouts,
        }
      : rxWorkoutsError
        ? {
            type: 'strength workouts',
            error: rxWorkoutsError,
            retry: refetchRxWorkouts,
          }
        : notesError
          ? { type: 'notes', error: notesError, retry: refetchNotes }
          : { type: 'events', error: eventsError!, retry: refetchEvents };

    const friendlyMessage = getUserFriendlyErrorMessage(errorContext.error);
    const errorMessage = `Failed to load ${errorContext.type}: ${friendlyMessage}`;
    const isAuthError = is401Error(errorContext.error);
    const isPermissionError = is403Error(errorContext.error);

    const handleRetry = async (): Promise<void> => {
      if (isAuthError) {
        // 401: refresh the token in a background tab, then retry ourselves.
        const result = await tpAuthRefresh.refresh();
        if (result.outcome === 'refreshed') {
          errorContext.retry();
        }
      } else {
        // For other errors, just retry the request
        errorContext.retry();
      }
    };

    return (
      <div className="flex flex-col items-center justify-center p-8">
        <p className="text-red-600 font-semibold text-center">{errorMessage}</p>
        {isAuthError && (
          <p className="text-gray-500 text-xs mt-1 text-center" role="status">
            {tpAuthRefresh.message ??
              'Your TrainingPeaks sign-in expired. Refresh it in a background tab without leaving this page.'}
          </p>
        )}
        {isPermissionError && (
          <p className="text-gray-500 text-xs mt-1 text-center">
            This training plan is not shared with you
          </p>
        )}
        <button
          onClick={handleRetry}
          disabled={tpAuthRefresh.isRefreshing}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {tpAuthRefresh.isRefreshing
            ? 'Refreshing…'
            : isAuthError
              ? 'Refresh TrainingPeaks sign-in'
              : 'Retry'}
        </button>
        {onBack && (
          <button
            onClick={onBack}
            className="mt-2 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            Back to Plans
          </button>
        )}
      </div>
    );
  }

  // Empty state
  const hasData =
    (workouts && workouts.length > 0) ||
    (notes && notes.length > 0) ||
    (events && events.length > 0);

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <p className="text-gray-600">
          No workouts, notes, or events in this plan.
        </p>
        {onBack && (
          <button
            onClick={onBack}
            className="mt-4 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            Back to Plans
          </button>
        )}
      </div>
    );
  }

  // Organize data by week
  // 1. Find earliest date
  const workoutsWithDates = workouts.map((w) => ({
    ...w,
    date: getWorkoutDate(w),
  }));
  const notesWithDates = (notes || []).map((n) => ({
    ...n,
    date: parseDate(n.noteDate),
  }));
  const eventsWithDates = (events || []).map((e) => ({
    ...e,
    date: parseDate(e.eventDate),
  }));

  const allItems = [
    ...workoutsWithDates,
    ...notesWithDates,
    ...eventsWithDates,
  ];
  const earliestDate = findEarliestDate(allItems);

  if (!earliestDate) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <p className="text-gray-600">No valid dates found in plan data.</p>
        {onBack && (
          <button
            onClick={onBack}
            className="mt-4 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            Back to Plans
          </button>
        )}
      </div>
    );
  }

  // 2. Normalize to Monday
  const startDate = normalizeToMonday(earliestDate);

  // 3. Organize by week
  const workoutsByWeek = organizeByWeek(workouts, getWorkoutDate, startDate);
  const notesByWeek = organizeByWeek(
    notes || [],
    (n) => parseDate(n.noteDate),
    startDate
  );
  const eventsByWeek = organizeByWeek(
    events || [],
    (e) => parseDate(e.eventDate),
    startDate
  );

  // 4. Merge all weeks
  const allWeeks = new Set([
    ...Array.from(workoutsByWeek.keys()),
    ...Array.from(notesByWeek.keys()),
    ...Array.from(eventsByWeek.keys()),
  ]);

  const sortedWeeks = Array.from(allWeeks).sort((a, b) => a - b);

  // 5. Create combined week data
  const combinedWeekData = new Map<
    number,
    Map<
      number,
      {
        workouts: UnifiedWorkout[];
        notes: CalendarNote[];
        events: CalendarEvent[];
      }
    >
  >();

  for (const weekNumber of sortedWeeks) {
    const weekMap = new Map<
      number,
      {
        workouts: UnifiedWorkout[];
        notes: CalendarNote[];
        events: CalendarEvent[];
      }
    >();

    // For each day of week (0-6)
    for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
      const dayWorkouts = workoutsByWeek.get(weekNumber)?.get(dayOfWeek) || [];
      const dayNotes = notesByWeek.get(weekNumber)?.get(dayOfWeek) || [];
      const dayEvents = eventsByWeek.get(weekNumber)?.get(dayOfWeek) || [];

      if (
        dayWorkouts.length > 0 ||
        dayNotes.length > 0 ||
        dayEvents.length > 0
      ) {
        weekMap.set(dayOfWeek, {
          workouts: dayWorkouts,
          notes: dayNotes,
          events: dayEvents,
        });
      }
    }

    combinedWeekData.set(weekNumber, weekMap);
  }

  // Render calendar
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-gray-300">
        <h2 className="text-base font-bold text-gray-800">
          {planName || selectedTrainingPlan?.title || 'Training Plan'}
        </h2>
        <div className="flex items-center space-x-2">
          <ExportButton
            onClick={openExportDialog}
            disabled={isExportingToIntervals}
            variant="secondary"
            label={isExportingToIntervals ? 'Exporting…' : 'Export Plan'}
            title="Export training plan"
          />
          <button
            onClick={() => handleDownload()}
            className="p-1 text-gray-600 hover:text-gray-800"
            title="Download plan as JSON"
            aria-label="Download plan as JSON"
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
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1 text-gray-600 hover:text-gray-800 disabled:opacity-50"
            title="Refresh plan data"
            aria-label="Refresh plan data"
          >
            <svg
              className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
          {onBack && (
            <button
              onClick={onBack}
              className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 flex items-center space-x-1"
            >
              <span>←</span>
              <span>Back</span>
            </button>
          )}
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 overflow-auto p-2">
        {/* Calendar Header */}
        <div
          className="grid gap-0 border border-gray-300 mb-0 sticky top-0 bg-white z-10"
          style={{ gridTemplateColumns: '50px repeat(7, 1fr)' }}
        >
          <div className="bg-gray-100 border-r border-gray-300 p-1 font-bold text-center text-xs">
            Week
          </div>
          <div className="bg-gray-50 border-r border-gray-300 p-1 font-semibold text-center text-xs">
            Mon
          </div>
          <div className="bg-gray-50 border-r border-gray-300 p-1 font-semibold text-center text-xs">
            Tue
          </div>
          <div className="bg-gray-50 border-r border-gray-300 p-1 font-semibold text-center text-xs">
            Wed
          </div>
          <div className="bg-gray-50 border-r border-gray-300 p-1 font-semibold text-center text-xs">
            Thu
          </div>
          <div className="bg-gray-50 border-r border-gray-300 p-1 font-semibold text-center text-xs">
            Fri
          </div>
          <div className="bg-gray-50 border-r border-gray-300 p-1 font-semibold text-center text-xs">
            Sat
          </div>
          <div className="bg-gray-50 p-1 font-semibold text-center text-xs">
            Sun
          </div>
        </div>

        {/* Week Rows */}
        {sortedWeeks.map((weekNumber) => (
          <CalendarWeekRow
            key={weekNumber}
            weekNumber={weekNumber}
            weekData={combinedWeekData.get(weekNumber) || new Map()}
          />
        ))}
      </div>

      <ExportDialog
        key={`plan-export-${isExportDialogOpen ? 'open' : 'closed'}`}
        isOpen={isExportDialogOpen}
        onClose={closeExportDialog}
        onExport={handleExportFromDialog}
        itemCount={classicWorkouts?.length ?? 0}
        isExporting={isExportingToIntervals}
        trainingPlanExportProgress={
          trainingPlanExportProgress
            ? {
                overallCurrent: trainingPlanExportProgress.overallCurrent,
                overallTotal: trainingPlanExportProgress.overallTotal,
                currentPhaseLabel: trainingPlanExportProgress.currentPhaseLabel,
                currentPhaseCurrent:
                  trainingPlanExportProgress.currentPhaseCurrent,
                currentPhaseTotal: trainingPlanExportProgress.currentPhaseTotal,
                currentItemName: trainingPlanExportProgress.currentItemName,
                message: trainingPlanExportProgress.message,
                phases: [
                  {
                    id: 'folder',
                    ...trainingPlanExportProgress.phases.folder,
                  },
                  {
                    id: 'classicWorkouts',
                    ...trainingPlanExportProgress.phases.classicWorkouts,
                  },
                  {
                    id: 'rxWorkouts',
                    ...trainingPlanExportProgress.phases.rxWorkouts,
                  },
                  {
                    id: 'notes',
                    ...trainingPlanExportProgress.phases.notes,
                  },
                  {
                    id: 'events',
                    ...trainingPlanExportProgress.phases.events,
                  },
                ],
              }
            : undefined
        }
        sourceLibraryName={
          selectedTrainingPlan?.title || planName || 'Training Plan'
        }
        exportScope="trainingPlan"
      />

      {exportResult && (
        <ExportResult
          key={getExportResultKey(exportResult)}
          result={exportResult}
          onClose={() => setExportResult(null)}
        />
      )}
    </div>
  );
}
