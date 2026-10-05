import type {
  CreatePlanMyPeakLibraryMessage,
  GetTrainingPlanFoldersMessage,
  GetPlanMyPeakPlanLibrariesMessage,
  CreatePlanMyPeakPlanLibraryMessage,
  GetPlanMyPeakPlanMessage,
  UpsertPlanMyPeakPlanMessage,
  UpdatePlanMyPeakPlanMessage,
  UpsertPlanMyPeakPlanEntryMessage,
  DeletePlanMyPeakPlanEntryMessage,
  ExportWorkoutsToPlanMyPeakLibraryMessage,
  GetPlanMyPeakLibrariesMessage,
  TrainingPlanExportProgressPayload,
} from '@/types';
import {
  isTotalUploadFailure,
  type PlanMyPeakUploadSummary,
} from '@/background/api/planMyPeak';
import type { PlanFolder } from '@/schemas/trainingPlan.schema';
import type { PlanMyPeakWorkout } from '@/types/planMyPeak.types';
import type {
  PlanMyPeakPlanLibrary,
  PlanMyPeakPlanSummary,
  PlanMyPeakPlanDetail,
  PlanMyPeakPlanEntry,
} from '@/schemas/planMyPeakApi.schema';
import { TRAINING_PEAKS_PROVIDER_CODE } from '@/schemas/planMyPeakApi.schema';
import type { PlanMyPeakUpsertResult } from '@/background/api/planMyPeak';
import type {
  ApiResponse,
  CalendarNote,
  PlanWorkout,
  TrainingPlan,
} from '@/types/api.types';
import type {
  ExportResult as ExportResultType,
  ValidationMessage,
} from '../base';
import type { PlanMyPeakExportConfig } from '@/types/planMyPeak.types';
import {
  isPlanMyPeakAuthErrorCode,
  planMyPeakAuthFailureFromCode,
  type PlanMyPeakAuthFailure,
} from '@/utils/planMyPeakAuthErrors';
import { PLANMYPEAK_AUTH_MESSAGES } from '@/utils/uiStrings';
import { authRunField } from './transport';
import type { PlanMyPeakLibrary } from '@/schemas/planMyPeakApi.schema';
import { getDayOfWeek, getWeekNumber } from '@/utils/dateUtils';
import { planMyPeakAdapter } from './PlanMyPeakAdapter';
import { normalizeTpPlanWorkoutsToPlanMyPeakLibraryItems } from './trainingPlanNormalizer';

const TP_SHARED_PLAN_WORKOUT_LIBRARY_NAME = 'TrainingPeaks Plan Workouts';

/**
 * The TrainingPeaks folder a plan sits in, used as the PlanMyPeak plan library.
 *
 * Membership lives on the folder rather than the plan — `/planfolder/v1/folder/all`
 * returns each folder with the ids it holds — so the plan's folder is the one
 * listing its id. A plan in no folder returns null and lands in the coach's
 * default plan library.
 */
function resolveTrainingPeaksPlanFolderName(
  planId: number,
  folders: PlanFolder[]
): string | null {
  const folder = folders.find((entry) => entry.planIds.includes(planId));
  return folder?.folderName.trim() || null;
}

/**
 * Turn a TrainingPeaks calendar note into a PlanMyPeak workout.
 *
 * PlanMyPeak has no day-level note, but it does have a `note` discipline —
 * added precisely for calendar annotations, and one of the four types stored
 * with no structure. So a note becomes a workout of that type scheduled on its
 * own day, which is closer to what the coach wrote than dropping it.
 *
 * The provider id is namespaced: note ids and workout ids are both plain
 * integers in TrainingPeaks and would otherwise collide in one identity space.
 */
function toPlanMyPeakNoteWorkout(note: CalendarNote): PlanMyPeakWorkout {
  const title = note.title?.trim() || `Note ${note.id}`;

  return {
    id: `note-${note.id}`,
    name: title,
    detailed_description: note.description?.trim() || null,
    sport_type: 'cycling',
    discipline: 'note',
    type: 'mixed',
    intensity: 'easy',
    suitable_phases: [],
    suitable_weekdays: null,
    structure: {
      primaryIntensityMetric: 'percentOfFtp',
      primaryLengthMetric: 'duration',
      structure: [],
    },
    base_duration_min: 1,
    base_tss: 0,
    variable_components: null,
    source_file: `note_${note.id}.json`,
    source_format: 'json',
    signature: `note-${note.id}`,
    provider_workout_id: notePlacementId(note),
    provider_item_type: 'Note',
    provider_intensity_factor: null,
    provider_tss: null,
  };
}

/** Identity for a note, namespaced so it cannot collide with a workout id. */
function notePlacementId(note: CalendarNote): string {
  return `note-${note.id}`;
}

/** PlanMyPeak bounds a plan to 52 weeks and a day to 51 positions. */
const MAX_PLAN_WEEKS = 52;
const MAX_ENTRY_POSITION = 50;

export interface ExportTrainingPlanClassicWorkoutsToPlanMyPeakOptions {
  trainingPlan: TrainingPlan;
  workouts: PlanWorkout[];
  notes?: CalendarNote[];
  config: PlanMyPeakExportConfig;
  onProgress?: (progress: TrainingPlanExportProgressPayload) => void;
}

function parseTpDateToUtcMidnight(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Week 1 of the imported plan.
 *
 * TrainingPeaks leaves `startDate` null on plans that were never placed on a
 * calendar (unscheduled templates, off-the-shelf plans), so the plan's own date
 * cannot be the only anchor or those plans could never be imported. The earliest
 * dated entry is the week TrainingPeaks itself shows as week 1, so it stands in.
 */
function resolvePlanStart(
  trainingPlan: TrainingPlan,
  workouts: PlanWorkout[],
  notes: CalendarNote[]
): Date | null {
  const declaredStart = trainingPlan.startDate
    ? parseTpDateToUtcMidnight(trainingPlan.startDate)
    : null;

  if (declaredStart) {
    return declaredStart;
  }

  const entryDates = [
    ...workouts.map((workout) => parseTpDateToUtcMidnight(workout.workoutDay)),
    ...notes.map((note) => parseTpDateToUtcMidnight(note.noteDate)),
  ].filter((date): date is Date => date !== null);

  if (entryDates.length === 0) {
    return null;
  }

  return entryDates.reduce((earliest, date) =>
    date < earliest ? date : earliest
  );
}

function authFailureField(code: string | undefined): {
  authFailure?: PlanMyPeakAuthFailure;
} {
  const authFailure = planMyPeakAuthFailureFromCode(code);
  return authFailure ? { authFailure } : {};
}

async function resolveSharedPlanWorkoutLibrary(
  preferredName: string | undefined,
  authRun: { authRunId?: string }
): Promise<ApiResponse<PlanMyPeakLibrary>> {
  const librariesResponse = await chrome.runtime.sendMessage<
    GetPlanMyPeakLibrariesMessage,
    ApiResponse<PlanMyPeakLibrary[]>
  >({
    type: 'GET_PLANMYPEAK_LIBRARIES',
    ...authRun,
  });

  if (!librariesResponse.success) {
    return librariesResponse;
  }

  // Libraries carry no provider identity of their own, so name is all we have
  // to recognise ours by. A coach who renames it gets a second one created here.
  // Provider identity on the library would fix that; raised with the backend as
  // a future item.
  const sharedName =
    preferredName?.trim() || `${TP_SHARED_PLAN_WORKOUT_LIBRARY_NAME} (Shared)`;

  const existing = librariesResponse.data.find(
    (library) => library.name.trim().toLowerCase() === sharedName.toLowerCase()
  );
  if (existing) {
    return { success: true, data: existing };
  }

  return chrome.runtime.sendMessage<
    CreatePlanMyPeakLibraryMessage,
    ApiResponse<PlanMyPeakLibrary>
  >({
    type: 'CREATE_PLANMYPEAK_LIBRARY',
    name: sharedName,
    ...authRun,
  });
}

/**
 * PlanMyPeak training-plan export path.
 *
 * Flow:
 * 1. Transform TP plan workouts into PlanMyPeak workout payloads
 * 2. Deduplicate workouts by source_id (TP + SHA-256(structure)) in a shared library
 * 3. Create training plan template referencing workout IDs (workoutKey)
 * 4. Create plan notes (week/day) when available
 */
export async function exportTrainingPlanClassicWorkoutsToPlanMyPeak({
  trainingPlan,
  workouts,
  notes = [],
  config,
  onProgress,
}: ExportTrainingPlanClassicWorkoutsToPlanMyPeakOptions): Promise<ExportResultType> {
  const planName =
    trainingPlan.title?.trim() || `Training Plan ${trainingPlan.planId}`;
  const warnings: ValidationMessage[] = [];
  // The popup's recovery run, carried on every PlanMyPeak request this export
  // makes: it does its own library lookup and creation, so it has to be able
  // to recover there too.
  const authRun = authRunField(config.authRunId);
  const normalizedItems = normalizeTpPlanWorkoutsToPlanMyPeakLibraryItems(
    workouts,
    { exerciseLibraryId: trainingPlan.planId }
  );

  if (normalizedItems.length === 0) {
    onProgress?.({
      phase: 'complete',
      status: 'failed',
      current: 0,
      total: 1,
      overallCurrent: 0,
      overallTotal: 1,
      itemName: planName,
      message: 'No classic plan workouts were available to export',
    });

    return {
      success: false,
      fileName: planName,
      format: 'api',
      itemsExported: 0,
      warnings,
      errors: ['No classic plan workouts were available to export'],
    };
  }

  const transformConfig: PlanMyPeakExportConfig = {
    ...config,
    createFolder: true,
    // The plan's own name, matching what the single-plan export sends. A
    // decorated fallback here would create a second library for any caller that
    // did not set one, because matching is by name.
    targetLibraryName: config.targetLibraryName || planName,
  };

  const transformedWorkouts = await planMyPeakAdapter.transform(
    normalizedItems,
    transformConfig
  );
  const validation = await planMyPeakAdapter.validate(transformedWorkouts);
  warnings.push(...validation.warnings);

  if (!validation.isValid) {
    const errors = validation.errors.map((error) => error.message);
    onProgress?.({
      phase: 'complete',
      status: 'failed',
      current: 0,
      total: 1,
      overallCurrent: 0,
      overallTotal: 1,
      itemName: planName,
      message: errors[0] || 'Validation failed',
    });

    return {
      success: false,
      fileName: planName,
      format: 'api',
      itemsExported: 0,
      warnings,
      errors,
    };
  }

  const folderPhaseTotal = 2;
  const classicPhaseTotal = transformedWorkouts.length;
  const notesPhaseTotal = notes.length;
  const overallTotal = Math.max(
    1,
    folderPhaseTotal + classicPhaseTotal + notesPhaseTotal
  );

  let overallCurrent = 0;
  let folderCurrent = 0;
  let classicCurrent = 0;

  const emitProgress = (
    phase: TrainingPlanExportProgressPayload['phase'],
    status: TrainingPlanExportProgressPayload['status'],
    current: number,
    total: number,
    itemName?: string,
    message?: string
  ): void => {
    onProgress?.({
      phase,
      status,
      current,
      total,
      overallCurrent,
      overallTotal,
      itemName,
      message,
    });
  };

  const failWithProgress = (
    errors: string[],
    options: {
      phase: Exclude<TrainingPlanExportProgressPayload['phase'], 'complete'>;
      phaseCurrent: number;
      phaseTotal: number;
      message: string;
      itemsExported?: number;
      /** The failing response's error code, to carry an auth failure as data. */
      errorCode?: string;
    }
  ): ExportResultType => {
    emitProgress(
      options.phase,
      'failed',
      options.phaseCurrent,
      options.phaseTotal,
      planName,
      options.message
    );
    emitProgress(
      'complete',
      'failed',
      overallCurrent,
      overallTotal,
      planName,
      options.message
    );

    return {
      success: false,
      fileName: planName,
      format: 'api',
      itemsExported: options.itemsExported ?? 0,
      warnings,
      errors,
      ...authFailureField(options.errorCode),
    };
  };

  emitProgress(
    'folder',
    'started',
    folderCurrent,
    folderPhaseTotal,
    planName,
    'Resolving shared PlanMyPeak workout library'
  );

  const libraryResult = await resolveSharedPlanWorkoutLibrary(
    transformConfig.targetLibraryName,
    authRun
  );
  if (!libraryResult.success) {
    return failWithProgress(
      [
        libraryResult.error.message ||
          'Failed to resolve PlanMyPeak shared plan workout library',
      ],
      {
        phase: 'folder',
        phaseCurrent: folderCurrent,
        phaseTotal: folderPhaseTotal,
        message: 'Failed to resolve shared PlanMyPeak workout library',
        errorCode: libraryResult.error.code,
      }
    );
  }

  folderCurrent += 1;
  overallCurrent += 1;
  emitProgress(
    'folder',
    'progress',
    folderCurrent,
    folderPhaseTotal,
    libraryResult.data.name,
    'Shared workout library ready'
  );

  /** TrainingPeaks workout id -> the PlanMyPeak workout it became. */
  const workoutIdByTpWorkoutId = new Map<number, string>();

  emitProgress(
    'classicWorkouts',
    'started',
    classicCurrent,
    classicPhaseTotal,
    planName,
    'Uploading plan workouts'
  );

  // One batch, and no lookup first: the workout POST is itself an upsert keyed
  // on provider identity, so a workout this plan shares with another import is
  // updated rather than duplicated. This used to dedupe on a hash of the
  // structure, which silently dropped every workout that had none — plyometric
  // and other prose-only sessions among them.
  const uploadResult = await chrome.runtime.sendMessage<
    ExportWorkoutsToPlanMyPeakLibraryMessage,
    ApiResponse<PlanMyPeakUploadSummary>
  >({
    type: 'EXPORT_WORKOUTS_TO_PLANMYPEAK_LIBRARY',
    workouts: [...transformedWorkouts, ...notes.map(toPlanMyPeakNoteWorkout)],
    libraryId: libraryResult.data.id,
    ...authRun,
  });

  if (!uploadResult.success) {
    return failWithProgress([uploadResult.error.message], {
      phase: 'classicWorkouts',
      phaseCurrent: classicCurrent,
      phaseTotal: classicPhaseTotal,
      message: 'Failed to upload plan workouts',
      errorCode: uploadResult.error.code,
    });
  }

  // An auth failure ends the export even when some workouts landed: building
  // the plan needs the same credential, and would only repeat the failure.
  const authFailureCode = uploadResult.data.failures.find((failure) =>
    isPlanMyPeakAuthErrorCode(failure.code)
  )?.code;

  // Every workout failing is still a failed export; the summary now carries
  // each failure, so report all of them instead of only the first.
  if (isTotalUploadFailure(uploadResult.data) || authFailureCode) {
    return failWithProgress(
      uploadResult.data.failures.map(
        (failure) => `Failed to upload "${failure.name}": ${failure.message}`
      ),
      {
        phase: 'classicWorkouts',
        phaseCurrent: classicCurrent,
        phaseTotal: classicPhaseTotal,
        message: 'Failed to upload plan workouts',
        itemsExported: uploadResult.data.results.length,
        errorCode: authFailureCode,
      }
    );
  }

  /** Namespaced note id -> the PlanMyPeak workout it became. */
  const workoutIdByNoteId = new Map<string, string>();

  for (const entry of uploadResult.data.results) {
    const providerWorkoutId = entry.workout.providerWorkoutId ?? '';

    if (providerWorkoutId.startsWith('note-')) {
      workoutIdByNoteId.set(providerWorkoutId, entry.workout.id);
      continue;
    }

    const tpWorkoutId = Number.parseInt(providerWorkoutId, 10);
    if (Number.isFinite(tpWorkoutId)) {
      workoutIdByTpWorkoutId.set(tpWorkoutId, entry.workout.id);
    }
  }

  for (const failure of uploadResult.data.failures) {
    warnings.push({
      field: 'workouts',
      severity: 'warning',
      message: `Failed to upload "${failure.name}": ${failure.message}`,
    });
  }

  classicCurrent = uploadResult.data.results.length;
  overallCurrent += classicCurrent;

  emitProgress(
    'classicWorkouts',
    'completed',
    classicCurrent,
    classicPhaseTotal,
    planName,
    'Classic workout processing complete'
  );

  const planStart = resolvePlanStart(trainingPlan, workouts, notes);
  if (!planStart) {
    return failWithProgress(
      [
        `Could not determine a start week for "${planName}": TrainingPeaks reported startDate ${String(
          trainingPlan.startDate
        )} and no workout or note carries a usable date.`,
      ],
      {
        phase: 'folder',
        phaseCurrent: folderCurrent,
        phaseTotal: folderPhaseTotal,
        message: 'Invalid training plan start date',
      }
    );
  }

  /** One scheduled session, in PlanMyPeak's terms. */
  interface Placement {
    providerEntryId: string;
    weekNumber: number;
    dayOfWeek: number;
    position: number;
    planMyPeakWorkoutId: string;
    title: string;
  }

  const placements: Placement[] = [];
  const seenProviderEntryIds = new Set<string>();

  // Earliest first, so `orderOnDay` gaps fall back to a stable ordering.
  const sortedPlanWorkouts = [...workouts].sort((a, b) => {
    const dayCompare = a.workoutDay.localeCompare(b.workoutDay);
    return dayCompare !== 0
      ? dayCompare
      : (a.orderOnDay ?? 0) - (b.orderOnDay ?? 0);
  });

  for (const workout of sortedPlanWorkouts) {
    const planMyPeakWorkoutId = workoutIdByTpWorkoutId.get(workout.workoutId);
    if (!planMyPeakWorkoutId) {
      warnings.push({
        field: `workouts:${workout.workoutId}`,
        severity: 'warning',
        message: `Skipped placement for "${workout.title}" because its workout was not uploaded`,
      });
      continue;
    }

    const workoutDate = parseTpDateToUtcMidnight(workout.workoutDay);
    if (!workoutDate) {
      warnings.push({
        field: `workouts:${workout.workoutId}`,
        severity: 'warning',
        message: `Skipped placement for "${workout.title}" due to invalid date ${workout.workoutDay}`,
      });
      continue;
    }

    const weekNumber = getWeekNumber(workoutDate, planStart);
    if (weekNumber < 1 || weekNumber > MAX_PLAN_WEEKS) {
      warnings.push({
        field: `workouts:${workout.workoutId}`,
        severity: 'warning',
        message: `Skipped placement for "${workout.title}": week ${weekNumber} is outside the 1-${MAX_PLAN_WEEKS} PlanMyPeak supports`,
      });
      continue;
    }

    const providerEntryId = String(workout.workoutId);

    // The diagnostic the PlanMyPeak side needs: if TrainingPeaks reuses a
    // workoutId within one plan, the second occurrence would be read as a *move*
    // of the first and the plan would silently end up short. Detected here, in
    // the payload, before any request — no round trip and no confusing it with a
    // coach having moved something.
    if (seenProviderEntryIds.has(providerEntryId)) {
      warnings.push({
        field: `workouts:${workout.workoutId}`,
        severity: 'warning',
        message: `TrainingPeaks reused workout id ${providerEntryId} within this plan. Only the last occurrence will be scheduled — please report this, it affects how imports identify sessions.`,
      });
    }
    seenProviderEntryIds.add(providerEntryId);

    placements.push({
      providerEntryId,
      weekNumber,
      // getDayOfWeek is 0 = Monday; PlanMyPeak uses ISO, 1 = Monday.
      dayOfWeek: getDayOfWeek(workoutDate) + 1,
      position:
        typeof workout.orderOnDay === 'number' &&
        Number.isFinite(workout.orderOnDay)
          ? Math.min(
              MAX_ENTRY_POSITION,
              Math.max(0, Math.round(workout.orderOnDay))
            )
          : 0,
      planMyPeakWorkoutId,
      title: workout.title,
    });
  }

  for (const note of notes) {
    const planMyPeakWorkoutId = workoutIdByNoteId.get(notePlacementId(note));
    const noteDate = parseTpDateToUtcMidnight(note.noteDate);

    if (!planMyPeakWorkoutId || !noteDate) {
      warnings.push({
        field: `notes:${note.id}`,
        severity: 'warning',
        message: `Skipped note "${note.title}" - ${planMyPeakWorkoutId ? `invalid date ${note.noteDate}` : 'it could not be uploaded'}`,
      });
      continue;
    }

    const weekNumber = getWeekNumber(noteDate, planStart);
    if (weekNumber < 1 || weekNumber > MAX_PLAN_WEEKS) {
      warnings.push({
        field: `notes:${note.id}`,
        severity: 'warning',
        message: `Skipped note "${note.title}": week ${weekNumber} is outside the 1-${MAX_PLAN_WEEKS} PlanMyPeak supports`,
      });
      continue;
    }

    placements.push({
      providerEntryId: notePlacementId(note),
      weekNumber,
      dayOfWeek: getDayOfWeek(noteDate) + 1,
      // After the day's sessions, since a note comments on them.
      position: MAX_ENTRY_POSITION,
      planMyPeakWorkoutId,
      title: note.title?.trim() || `Note ${note.id}`,
    });
  }

  const sourceWeekCount = Math.min(
    MAX_PLAN_WEEKS,
    Math.max(
      1,
      trainingPlan.weekCount ?? 0,
      ...placements.map((placement) => placement.weekNumber)
    )
  );

  // Resolve the plan's container. Listing creates the coach's default if they
  // have none, so there is always somewhere to put it.
  const planLibrariesResponse = await chrome.runtime.sendMessage<
    GetPlanMyPeakPlanLibrariesMessage,
    ApiResponse<PlanMyPeakPlanLibrary[]>
  >({ type: 'GET_PLANMYPEAK_PLAN_LIBRARIES', ...authRun });

  if (!planLibrariesResponse.success) {
    return failWithProgress([planLibrariesResponse.error.message], {
      phase: 'plan',
      phaseCurrent: 0,
      phaseTotal: 1,
      message: 'Failed to read PlanMyPeak plan libraries',
      errorCode: planLibrariesResponse.error.code,
    });
  }

  // Mirror the TrainingPeaks folder as the PlanMyPeak plan library, the way a
  // workout library already mirrors its TrainingPeaks source. Falls back to the
  // coach's default when we have no folder name — listing creates that default
  // if they have none, so there is always a destination.
  const foldersResponse = await chrome.runtime.sendMessage<
    GetTrainingPlanFoldersMessage,
    ApiResponse<PlanFolder[]>
  >({ type: 'GET_TRAINING_PLAN_FOLDERS' });

  if (!foldersResponse.success) {
    warnings.push({
      field: 'planLibrary',
      severity: 'warning',
      message: `Could not read TrainingPeaks plan folders, using the default PlanMyPeak plan library: ${foldersResponse.error.message}`,
    });
  }

  const planFolderName = foldersResponse.success
    ? resolveTrainingPeaksPlanFolderName(
        trainingPlan.planId,
        foldersResponse.data
      )
    : null;

  let planLibrary =
    planLibrariesResponse.data.find((library) => library.isDefault) ??
    planLibrariesResponse.data[0];

  if (planFolderName) {
    const byName = planLibrariesResponse.data.find(
      (library) =>
        library.name.trim().toLowerCase() === planFolderName.toLowerCase()
    );

    if (byName) {
      planLibrary = byName;
    } else {
      const created = await chrome.runtime.sendMessage<
        CreatePlanMyPeakPlanLibraryMessage,
        ApiResponse<PlanMyPeakPlanLibrary>
      >({
        type: 'CREATE_PLANMYPEAK_PLAN_LIBRARY',
        name: planFolderName,
        ...authRun,
      });

      if (created.success) {
        planLibrary = created.data;
      } else {
        warnings.push({
          field: 'planLibrary',
          severity: 'warning',
          message: `Could not create plan library "${planFolderName}", using "${planLibrary?.name ?? 'the default'}" instead: ${created.error.message}`,
        });
      }
    }
  }

  emitProgress('plan', 'started', 0, 1, planName, 'Creating training plan');

  // The plan is created at its full length. Shortening happens last, after any
  // stranded entries are gone, because the server refuses to shrink a plan below
  // its highest scheduled week.
  const upsertPlanResponse = await chrome.runtime.sendMessage<
    UpsertPlanMyPeakPlanMessage,
    ApiResponse<PlanMyPeakUpsertResult<PlanMyPeakPlanSummary>>
  >({
    type: 'UPSERT_PLANMYPEAK_PLAN',
    payload: {
      name: planName,
      description: trainingPlan.description ?? null,
      weekCount: sourceWeekCount,
      libraryId: planLibrary?.id,
      provider: TRAINING_PEAKS_PROVIDER_CODE,
      providerPlanId: String(trainingPlan.planId),
      providerMetadata: {
        trainingPeaksPlanId: trainingPlan.planId,
        trainingPeaksStartDate: trainingPlan.startDate,
      },
    },
    ...authRun,
  });

  if (!upsertPlanResponse.success) {
    return failWithProgress([upsertPlanResponse.error.message], {
      phase: 'plan',
      phaseCurrent: 0,
      phaseTotal: 1,
      message: `Failed to create training plan "${planName}"`,
      errorCode: upsertPlanResponse.error.code,
    });
  }

  const plan = upsertPlanResponse.data.value;
  if (!upsertPlanResponse.data.created) {
    warnings.push({
      field: 'plan',
      severity: 'warning',
      message: `"${plan.name}" already existed in PlanMyPeak and was updated in place.`,
    });
  }
  if (planLibrary && plan.library.id !== planLibrary.id) {
    warnings.push({
      field: 'plan',
      severity: 'warning',
      // Deliberately states where it is, not why. An update never re-files a
      // plan, but the reason could be a coach moving it *or* an earlier import
      // filing it elsewhere — and the response cannot tell us which.
      message: `"${plan.name}" already lives in "${plan.library.name}", so it was updated there rather than moved to "${planLibrary?.name ?? 'the target library'}".`,
    });
  }

  emitProgress('plan', 'completed', 1, 1, planName, 'Training plan ready');

  // Read the existing schedule before touching it, so the reconcile knows which
  // entries the source no longer has.
  const existingPlanResponse = await chrome.runtime.sendMessage<
    GetPlanMyPeakPlanMessage,
    ApiResponse<PlanMyPeakPlanDetail>
  >({ type: 'GET_PLANMYPEAK_PLAN', planId: plan.id, ...authRun });

  // Once PlanMyPeak refuses the credential, every later write would fail the
  // same way, so the export stops and reports it as data: the batch loop stops
  // the remaining plans and the result modal offers sign-in. Scheduling is not
  // reconciled or shortened on a partial schedule, since that would act on a
  // plan this export did not finish writing.
  let authFailure: PlanMyPeakAuthFailure | null = existingPlanResponse.success
    ? null
    : planMyPeakAuthFailureFromCode(existingPlanResponse.error.code);

  const existingEntries = existingPlanResponse.success
    ? existingPlanResponse.data.entries
    : [];

  emitProgress(
    'entries',
    'started',
    0,
    placements.length,
    planName,
    'Scheduling workouts'
  );

  let entriesCurrent = 0;
  let scheduledWorkoutCount = 0;

  for (const placement of placements) {
    if (authFailure) {
      break;
    }

    const entryResponse = await chrome.runtime.sendMessage<
      UpsertPlanMyPeakPlanEntryMessage,
      ApiResponse<PlanMyPeakUpsertResult<PlanMyPeakPlanEntry>>
    >({
      type: 'UPSERT_PLANMYPEAK_PLAN_ENTRY',
      planId: plan.id,
      payload: {
        workoutId: placement.planMyPeakWorkoutId,
        weekNumber: placement.weekNumber,
        dayOfWeek: placement.dayOfWeek,
        position: placement.position,
        provider: TRAINING_PEAKS_PROVIDER_CODE,
        providerEntryId: placement.providerEntryId,
        // `note` is deliberately absent: an omitted note is kept, and we have
        // none to offer. Sending null would erase whatever the coach wrote.
      },
      ...authRun,
    });

    entriesCurrent += 1;
    overallCurrent += 1;

    if (!entryResponse.success) {
      warnings.push({
        field: `entries:${placement.providerEntryId}`,
        severity: 'warning',
        message: `Failed to schedule "${placement.title}" in week ${placement.weekNumber}: ${entryResponse.error.message}`,
      });
      authFailure = planMyPeakAuthFailureFromCode(entryResponse.error.code);
    } else {
      scheduledWorkoutCount += 1;
    }

    emitProgress(
      'entries',
      'progress',
      entriesCurrent,
      placements.length,
      placement.title,
      entryResponse.success ? 'Scheduled' : 'Failed'
    );
  }

  if (authFailure) {
    const notScheduled = placements.length - scheduledWorkoutCount;
    warnings.push({
      field: 'entries',
      severity: 'warning',
      message: `${notScheduled} of ${placements.length} session(s) in "${planName}" were not scheduled: ${PLANMYPEAK_AUTH_MESSAGES.SIGN_IN_REQUIRED}`,
    });
    emitProgress(
      'entries',
      'failed',
      entriesCurrent,
      placements.length,
      planName,
      'Stopped: PlanMyPeak sign-in required'
    );
    emitProgress(
      'complete',
      'failed',
      overallCurrent,
      overallTotal,
      planName,
      'Stopped: PlanMyPeak sign-in required'
    );

    return {
      // A partly scheduled plan still landed something; an empty one did not.
      success: scheduledWorkoutCount > 0,
      fileName: planName,
      format: 'api',
      itemsExported: scheduledWorkoutCount,
      warnings,
      ...(scheduledWorkoutCount > 0
        ? {}
        : { errors: [PLANMYPEAK_AUTH_MESSAGES.SIGN_IN_REQUIRED] }),
      authFailure,
    };
  }

  emitProgress(
    'entries',
    'completed',
    entriesCurrent,
    placements.length,
    planName,
    'Scheduling complete'
  );

  // Remove sessions this import no longer has. Only entries we placed are
  // considered: one a coach scheduled by hand carries no provider identity and
  // is never adopted, so it is never removed either.
  const stale = existingEntries.filter(
    (entry) =>
      entry.provider === TRAINING_PEAKS_PROVIDER_CODE &&
      entry.providerEntryId !== null &&
      !seenProviderEntryIds.has(entry.providerEntryId)
  );

  for (const entry of stale) {
    const deleted = await chrome.runtime.sendMessage<
      DeletePlanMyPeakPlanEntryMessage,
      ApiResponse<null>
    >({
      type: 'DELETE_PLANMYPEAK_PLAN_ENTRY',
      planId: plan.id,
      entryId: entry.id,
      ...authRun,
    });

    if (!deleted.success) {
      warnings.push({
        field: `entries:${entry.id}`,
        severity: 'warning',
        message: `Kept "${entry.workout.name}" in week ${entry.weekNumber}: ${deleted.error.message}`,
      });
      authFailure = planMyPeakAuthFailureFromCode(deleted.error.code);
      if (authFailure) {
        break;
      }
    }
  }

  // Shortening last, once nothing is stranded outside the new length. Not
  // attempted after an auth failure: stale entries may still be in place.
  if (!authFailure && plan.weekCount > sourceWeekCount) {
    const shortened = await chrome.runtime.sendMessage<
      UpdatePlanMyPeakPlanMessage,
      ApiResponse<PlanMyPeakPlanSummary>
    >({
      type: 'UPDATE_PLANMYPEAK_PLAN',
      planId: plan.id,
      payload: { weekCount: sourceWeekCount },
      ...authRun,
    });

    if (!shortened.success) {
      warnings.push({
        field: 'plan',
        severity: 'warning',
        message: `Left "${plan.name}" at ${plan.weekCount} weeks: ${shortened.error.message}`,
      });
      authFailure = planMyPeakAuthFailureFromCode(shortened.error.code);
    }
  }

  emitProgress(
    'complete',
    'completed',
    overallCurrent,
    overallTotal,
    planName,
    'Training plan export complete'
  );

  return {
    success: true,
    fileName: planName,
    format: 'api',
    itemsExported: scheduledWorkoutCount,
    warnings,
    ...(authFailure ? { authFailure } : {}),
  };
}
