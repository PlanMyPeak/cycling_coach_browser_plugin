/**
 * Import execution for the in-page overlay.
 *
 * Runs the same path as the popup export — the PlanMyPeak adapter for
 * libraries, the plan export helper for training plans, and the shared
 * duplicate preflight — so overlay imports and popup imports produce the same
 * PlanMyPeak content.
 */

import { useCallback, useState } from 'react';
import type { LibraryItem } from '@/schemas/library.schema';
import type { CalendarNote, PlanWorkout } from '@/schemas/trainingPlan.schema';
import type { ApiResponse } from '@/types/api.types';
import type {
  GetLibraryItemsMessage,
  GetPlanNotesMessage,
  GetPlanWorkoutsMessage,
  ImportAthleteGroupsToPlanMyPeakMessage,
} from '@/types';
import type { AthleteGroup } from '@/schemas/athleteGroup.schema';
import type { PlanMyPeakIngestAthleteGroupsResponse } from '@/schemas/planMyPeakApi.schema';
import type { PlanMyPeakExportConfig } from '@/types/planMyPeak.types';
import type { PlanMyPeakLibrary } from '@/schemas/planMyPeakApi.schema';
import type { TrainingPlanExportProgressDialogState } from '@/types/export.types';
import { planMyPeakAdapter } from '@/export/adapters/planMyPeak';
import { importTrainingPlanToPlanMyPeak } from '@/export/adapters/planMyPeak/trainingPlanImport';
import {
  findExistingPlanMyPeakLibraries,
  normalizeTargetLibraryNames,
  type PlanMyPeakDuplicateAction,
} from '@/export/adapters/planMyPeak/duplicatePreflight';
import { logger } from '@/utils/logger';
import { selectedItemsForLibrary, type OverlaySelection } from './selection';
import type {
  SiteControlImportByKind,
  SiteControlImportCompletedPayload,
} from '@/types/siteControl.types';

export type OverlayImportPhase =
  | 'idle'
  | 'checking'
  | 'duplicates'
  | 'importing'
  | 'result';

/** Which kind of thing an import item covered, so counts stay in their own unit. */
export type OverlayImportKind = 'library' | 'plan' | 'group';

export interface OverlayImportItemResult {
  kind: OverlayImportKind;
  /** Library or plan name as it appears in TrainingPeaks */
  name: string;
  ok: boolean;
  importedCount: number;
  /** Reason this item failed, when it did */
  message?: string;
  /**
   * Things a successful import still wants the coach to know: sessions
   * imported without their structure, skipped, or not supported. Server
   * messages, verbatim.
   */
  notes?: string[];
}

export interface OverlayImportOutcome {
  ok: boolean;
  importedCount: number;
  failedCount: number;
  destinations: string[];
  items: OverlayImportItemResult[];
  /** Set when the import could not start at all */
  startupError?: string;
}

interface PendingImport {
  selection: OverlaySelection;
  loadedItems: ReadonlyMap<number, ReadonlyArray<LibraryItem>>;
}

async function fetchLibraryItems(libraryId: number): Promise<LibraryItem[]> {
  const response = await chrome.runtime.sendMessage<
    GetLibraryItemsMessage,
    ApiResponse<LibraryItem[]>
  >({ type: 'GET_LIBRARY_ITEMS', libraryId });

  if (!response.success) {
    throw new Error(response.error.message || 'Failed to load library items');
  }

  return response.data;
}

async function fetchPlanWorkouts(planId: number): Promise<PlanWorkout[]> {
  const response = await chrome.runtime.sendMessage<
    GetPlanWorkoutsMessage,
    ApiResponse<PlanWorkout[]>
  >({ type: 'GET_PLAN_WORKOUTS', planId });

  if (!response.success) {
    throw new Error(response.error.message || 'Failed to load plan workouts');
  }

  return response.data;
}

/**
 * Send the selected athlete groups to PlanMyPeak.
 *
 * Groups go through the ingest endpoint in a single call, unlike libraries and
 * plans, so the whole selection is one progress item rather than one per group.
 */
async function importAthleteGroups(
  groups: AthleteGroup[]
): Promise<PlanMyPeakIngestAthleteGroupsResponse> {
  const response = await chrome.runtime.sendMessage<
    ImportAthleteGroupsToPlanMyPeakMessage,
    ApiResponse<PlanMyPeakIngestAthleteGroupsResponse>
  >({ type: 'IMPORT_ATHLETE_GROUPS_TO_PLANMYPEAK', groups });

  if (!response.success) {
    throw new Error(
      response.error.message || 'Failed to import athlete groups'
    );
  }

  return response.data;
}

async function fetchPlanNotes(planId: number): Promise<CalendarNote[]> {
  const response = await chrome.runtime.sendMessage<
    GetPlanNotesMessage,
    ApiResponse<CalendarNote[]>
  >({ type: 'GET_PLAN_NOTES', planId });

  if (!response.success) {
    throw new Error(response.error.message || 'Failed to load plan notes');
  }

  return response.data;
}

function initialProgress(
  labels: ReadonlyArray<string>
): TrainingPlanExportProgressDialogState {
  return {
    overallCurrent: 0,
    overallTotal: labels.length,
    currentPhaseLabel: 'Preparing import',
    currentPhaseCurrent: 0,
    currentPhaseTotal: labels.length,
    phases: labels.map((label, index) => ({
      id: `item-${index}`,
      label,
      status: 'pending',
      current: 0,
      total: 1,
    })),
  };
}

/**
 * Split the results into per-kind counts.
 *
 * The totals alone cannot be rendered honestly across kinds: workouts and
 * groups are different units, so summing them produces a number in no unit at
 * all. `failed` counts containers, matching `failedCount`.
 */
function summarizeByKind(
  items: ReadonlyArray<OverlayImportItemResult>
): SiteControlImportByKind {
  const byKind: SiteControlImportByKind = {
    libraries: { imported: 0, failed: 0 },
    plans: { imported: 0, failed: 0 },
    groups: { imported: 0, failed: 0 },
  };

  const bucketFor = {
    library: byKind.libraries,
    plan: byKind.plans,
    group: byKind.groups,
  } as const;

  for (const item of items) {
    const bucket = bucketFor[item.kind];
    bucket.imported += item.importedCount;
    if (!item.ok) {
      bucket.failed += 1;
    }
  }

  return byKind;
}

export interface UseOverlayImportReturn {
  phase: OverlayImportPhase;
  progress: TrainingPlanExportProgressDialogState | null;
  outcome: OverlayImportOutcome | null;
  /** Existing PlanMyPeak libraries blocking the import, if any */
  conflicts: PlanMyPeakLibrary[];
  /** Error from the duplicate preflight itself */
  preflightError: string | null;
  startImport: (pending: PendingImport) => Promise<void>;
  resolveDuplicates: (action: PlanMyPeakDuplicateAction) => Promise<void>;
  reset: () => void;
}

export function useOverlayImport(
  onImportCompleted?: (payload: SiteControlImportCompletedPayload) => void
): UseOverlayImportReturn {
  const [phase, setPhase] = useState<OverlayImportPhase>('idle');
  const [progress, setProgress] =
    useState<TrainingPlanExportProgressDialogState | null>(null);
  const [outcome, setOutcome] = useState<OverlayImportOutcome | null>(null);
  const [conflicts, setConflicts] = useState<PlanMyPeakLibrary[]>([]);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);

  const runImport = useCallback(
    async (
      target: PendingImport,
      existingLibraryAction: 'replace' | 'append'
    ): Promise<void> => {
      const libraries = [...target.selection.libraries.values()];
      const plans = [...target.selection.plans.values()];
      const groups = [...target.selection.groups.values()];
      const groupsLabel =
        groups.length === 1
          ? `Athlete group: ${groups[0].groupName}`
          : `${groups.length} athlete groups`;
      const labels = [
        ...libraries.map((library) => library.libraryName),
        ...plans.map((plan) => plan.planName),
        ...(groups.length > 0 ? [groupsLabel] : []),
      ];

      setPhase('importing');
      setProgress(initialProgress(labels));

      const items: OverlayImportItemResult[] = [];
      const destinations: string[] = [];

      const advance = (
        index: number,
        status: 'started' | 'completed' | 'failed',
        message?: string
      ): void => {
        setProgress((previous) => {
          if (!previous) return previous;
          const phases = previous.phases.map((entry, entryIndex) =>
            entryIndex === index
              ? {
                  ...entry,
                  status,
                  current: status === 'started' ? 0 : 1,
                  message,
                }
              : entry
          );
          const completed = phases.filter(
            (entry) => entry.status === 'completed' || entry.status === 'failed'
          ).length;

          return {
            ...previous,
            phases,
            overallCurrent: completed,
            currentPhaseCurrent: completed,
            currentPhaseLabel:
              phases[index]?.label ?? previous.currentPhaseLabel,
            currentItemName: phases[index]?.label,
          };
        });
      };

      for (const [index, library] of libraries.entries()) {
        advance(index, 'started');

        try {
          const loaded =
            target.loadedItems.get(library.libraryId) ??
            (await fetchLibraryItems(library.libraryId));
          const selected = selectedItemsForLibrary(
            target.selection,
            library.libraryId,
            loaded
          );

          const config: PlanMyPeakExportConfig = {
            createFolder: true,
            targetLibraryName: library.libraryName,
            existingLibraryAction,
            includeMetadata: true,
          };

          const workouts = await planMyPeakAdapter.transform(selected, config);
          const validation = await planMyPeakAdapter.validate(workouts);

          if (!validation.isValid) {
            throw new Error(
              validation.errors.map((error) => error.message).join('; ') ||
                'Validation failed'
            );
          }

          const result = await planMyPeakAdapter.export(workouts, config);

          if (!result.success) {
            throw new Error(
              result.errors?.join('; ') || 'PlanMyPeak upload failed'
            );
          }

          destinations.push(result.fileName);
          items.push({
            kind: 'library',
            name: library.libraryName,
            ok: true,
            importedCount: result.itemsExported,
          });
          advance(index, 'completed');
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown import error';
          logger.error('[ImportOverlay] Library import failed:', message);
          items.push({
            kind: 'library',
            name: library.libraryName,
            ok: false,
            importedCount: 0,
            message,
          });
          advance(index, 'failed', message);
        }
      }

      for (const [planIndex, plan] of plans.entries()) {
        const index = libraries.length + planIndex;
        advance(index, 'started');

        try {
          const [workouts, notes] = await Promise.all([
            fetchPlanWorkouts(plan.planId),
            fetchPlanNotes(plan.planId),
          ]);

          const result = await importTrainingPlanToPlanMyPeak({
            trainingPlan: plan.plan,
            workouts,
            notes,
            config: {
              createFolder: true,
              targetLibraryName: plan.planName,
              existingLibraryAction,
              includeMetadata: true,
            },
          });

          if (!result.success) {
            throw new Error(
              result.errors?.join('; ') || 'PlanMyPeak plan import failed'
            );
          }

          destinations.push(result.fileName);
          const outcomeNotes = result.warnings.map(
            (warning) => warning.message
          );
          items.push({
            kind: 'plan',
            name: plan.planName,
            ok: true,
            importedCount: result.itemsExported,
            ...(outcomeNotes.length > 0 ? { notes: outcomeNotes } : {}),
          });
          advance(index, 'completed');
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown import error';
          logger.error('[ImportOverlay] Plan import failed:', message);
          items.push({
            kind: 'plan',
            name: plan.planName,
            ok: false,
            importedCount: 0,
            message,
          });
          advance(index, 'failed', message);
        }
      }

      if (groups.length > 0) {
        const index = libraries.length + plans.length;
        advance(index, 'started');

        try {
          const result = await importAthleteGroups(
            groups.map((entry) => entry.group)
          );

          // The endpoint reports what it actually ingested; fall back to the
          // number sent when it does not, so the count is never zero on success.
          const importedGroups = result.groupsProcessed ?? groups.length;

          items.push({
            kind: 'group',
            name: groupsLabel,
            ok: true,
            importedCount: importedGroups,
          });
          advance(index, 'completed');
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown import error';
          logger.error('[ImportOverlay] Athlete group import failed:', message);
          items.push({
            kind: 'group',
            name: groupsLabel,
            ok: false,
            importedCount: 0,
            message,
          });
          advance(index, 'failed', message);
        }
      }

      const importedCount = items.reduce(
        (total, item) => total + item.importedCount,
        0
      );
      const failedCount = items.filter((item) => !item.ok).length;
      const finalOutcome: OverlayImportOutcome = {
        // A partial failure is not a success.
        ok: failedCount === 0 && items.length > 0,
        importedCount,
        failedCount,
        destinations: Array.from(new Set(destinations)),
        items,
      };

      setOutcome(finalOutcome);
      setPhase('result');
      onImportCompleted?.({
        ok: finalOutcome.ok,
        importedCount: finalOutcome.importedCount,
        failedCount: finalOutcome.failedCount,
        byKind: summarizeByKind(items),
      });
    },
    [onImportCompleted]
  );

  const startImport = useCallback(
    async (target: PendingImport): Promise<void> => {
      setPreflightError(null);
      setConflicts([]);
      setOutcome(null);
      setPending(target);
      setPhase('checking');

      const targetNames = normalizeTargetLibraryNames([
        ...[...target.selection.libraries.values()].map(
          (library) => library.libraryName
        ),
        ...[...target.selection.plans.values()].map((plan) => plan.planName),
      ]);

      const check = await findExistingPlanMyPeakLibraries(targetNames);

      if (!check.ok) {
        setPreflightError(check.message);
        setPhase('idle');
        return;
      }

      if (check.conflicts.length > 0) {
        setConflicts(check.conflicts);
        setPhase('duplicates');
        return;
      }

      await runImport(target, 'append');
    },
    [runImport]
  );

  const resolveDuplicates = useCallback(
    async (action: PlanMyPeakDuplicateAction): Promise<void> => {
      if (action === 'ignore') {
        setConflicts([]);
        setPending(null);
        setPhase('idle');
        return;
      }

      if (!pending) return;

      setConflicts([]);
      await runImport(pending, action);
    },
    [pending, runImport]
  );

  const reset = useCallback((): void => {
    setPhase('idle');
    setProgress(null);
    setOutcome(null);
    setConflicts([]);
    setPreflightError(null);
    setPending(null);
  }, []);

  return {
    phase,
    progress,
    outcome,
    conflicts,
    preflightError,
    startImport,
    resolveDuplicates,
    reset,
  };
}
