/**
 * Type definitions for the extension
 */

import type { LibraryItem } from '@/schemas/library.schema';
import type {
  TrainingPlan,
  PlanWorkout,
  CalendarNote,
  CalendarEvent,
} from '@/schemas/trainingPlan.schema';
import type { RxBuilderWorkout } from '@/schemas/rxBuilder.schema';
import type { AthleteGroup } from '@/schemas/athleteGroup.schema';
import type {
  PlanMyPeakCoach,
  PlanMyPeakIngestAthleteGroupsResponse,
} from '@/schemas/planMyPeakApi.schema';
import type { PlanMyPeakWorkout } from '@/types/planMyPeak.types';
import type {
  PlanMyPeakCreatePlanEntryRequest,
  PlanMyPeakCreatePlanRequest,
} from '@/background/api/planMyPeak';
import type {
  IntervalsFolderResponse,
  IntervalsPlanConflictAction,
} from '@/types/intervalsicu.types';
import type { SiteControlRequest } from '@/types/siteControl.types';
import type {
  CapturedWorkoutRecord,
  CapturedWorkoutStatus,
} from '@/schemas/capturedWorkout.schema';
import type {
  AuthRefreshProvider,
  AuthRefreshResult,
} from '@/services/authRefreshService';

/**
 * Message types for chrome.runtime messaging
 */
export interface TokenFoundMessage {
  type: 'TOKEN_FOUND';
  token: string;
  timestamp: number;
}

export interface MyPeakAuthFoundMessage {
  type: 'MY_PEAK_AUTH_FOUND';
  timestamp: number;
  token?: string | null;
  apiKey?: string | null;
}

export interface GetTokenMessage {
  type: 'GET_TOKEN';
}

export interface ClearTokenMessage {
  type: 'CLEAR_TOKEN';
}

export interface ValidateTokenMessage {
  type: 'VALIDATE_TOKEN';
}

export interface ValidateMyPeakTokenMessage {
  type: 'VALIDATE_MY_PEAK_TOKEN';
}

/**
 * Refresh a provider's captured token by opening a temporary background tab
 * on the site and closing it once the token lands. Never touches the coach's
 * own tabs. Handled in the background so it completes if the popup closes.
 */
export interface RefreshProviderAuthMessage {
  type: 'REFRESH_PROVIDER_AUTH';
  provider: AuthRefreshProvider;
}

export type { AuthRefreshProvider, AuthRefreshResult };

/**
 * A PlanMyPeak request that may belong to an auth recovery run.
 *
 * Recovery is a property of the request, not of its type: several callers
 * share these message types, including an idle query that runs whenever the
 * popup opens. A request carrying no run id, or one the background does not
 * know, is resolved passively — it never refreshes and never opens a tab.
 */
export interface PlanMyPeakAuthRunScoped {
  authRunId?: string;
}

/**
 * Start an auth recovery run for explicit work the coach began (a popup
 * export). The background mints the id; a caller cannot invent one. Accepted
 * from extension pages only.
 */
export interface BeginPlanMyPeakAuthRunMessage {
  type: 'BEGIN_PLANMYPEAK_AUTH_RUN';
}

export interface BeginPlanMyPeakAuthRunResult {
  authRunId: string | null;
}

/** End a run on every exit from the work that began it. */
export interface EndPlanMyPeakAuthRunMessage {
  type: 'END_PLANMYPEAK_AUTH_RUN';
  authRunId: string;
}

/**
 * Ask the background to remove the stored PlanMyPeak credential if it is
 * stale. The background re-decides under its credential lock, so a fresh
 * replacement captured in the meantime survives.
 */
export interface DiscardStaleMyPeakTokenMessage {
  type: 'DISCARD_STALE_MY_PEAK_TOKEN';
}

export interface GetPlanMyPeakLibrariesMessage extends PlanMyPeakAuthRunScoped {
  type: 'GET_PLANMYPEAK_LIBRARIES';
}

export interface CreatePlanMyPeakLibraryMessage extends PlanMyPeakAuthRunScoped {
  type: 'CREATE_PLANMYPEAK_LIBRARY';
  name: string;
  description?: string | null;
}

export interface DeletePlanMyPeakLibraryMessage extends PlanMyPeakAuthRunScoped {
  type: 'DELETE_PLANMYPEAK_LIBRARY';
  libraryId: string;
}

/** List workouts, optionally scoped to a library and/or a provider. */
export interface GetPlanMyPeakWorkoutsMessage extends PlanMyPeakAuthRunScoped {
  type: 'GET_PLANMYPEAK_WORKOUTS';
  libraryId?: string;
  provider?: string;
  providerWorkoutId?: string;
}

/**
 * Remove one workout. Used when reconciling a library on Replace, since a
 * library holding workouts cannot be deleted and recreated.
 */
export interface DeletePlanMyPeakWorkoutMessage extends PlanMyPeakAuthRunScoped {
  type: 'DELETE_PLANMYPEAK_WORKOUT';
  workoutId: string;
}

/**
 * Message to export transformed workouts to a PlanMyPeak workout library
 */
export interface ExportWorkoutsToPlanMyPeakLibraryMessage extends PlanMyPeakAuthRunScoped {
  type: 'EXPORT_WORKOUTS_TO_PLANMYPEAK_LIBRARY';
  workouts: PlanMyPeakWorkout[];
  libraryId: string;
  /**
   * Captured-workout record key by `provider_workout_id`. When present, the
   * background upload loop writes each workout's outcome to its record right
   * after its POST, so a popup that closes mid-send loses nothing.
   */
  capturedKeys?: Record<string, string>;
}

/**
 * A workout create/update observed on TrainingPeaks by the main-world
 * interceptor and relayed by the isolated bridge. Carries the parsed request
 * and response bodies only — never headers.
 */
export interface WorkoutCapturedMessage {
  type: 'WORKOUT_CAPTURED';
  kind: 'create' | 'update';
  athleteId: number;
  workoutId: number;
  request: unknown;
  response: unknown;
  timestamp: number;
}

export interface GetCapturedWorkoutsMessage {
  type: 'GET_CAPTURED_WORKOUTS';
}

export interface UpdateCapturedWorkoutMessage {
  type: 'UPDATE_CAPTURED_WORKOUT';
  key: string;
  status?: CapturedWorkoutStatus;
  planMyPeakWorkoutId?: string;
  planMyPeakLibraryName?: string;
  /** A string records the error; `null` clears it. */
  lastSendError?: string | null;
}

export interface RemoveCapturedWorkoutsMessage {
  type: 'REMOVE_CAPTURED_WORKOUTS';
  statuses: CapturedWorkoutStatus[];
}

export interface CapturedWorkoutsListResult {
  /** Newest first */
  records: CapturedWorkoutRecord[];
  pendingCount: number;
  /** Records no verified PlanMyPeak account has claimed yet. */
  unlinkedCount: number;
}

export interface RemoveCapturedWorkoutsResult {
  removed: number;
}

/**
 * Link every capture that has no owner to the PlanMyPeak account the extension
 * is signed in to right now, on its configured destination.
 *
 * The explicit recovery path for captures stored before ownership existed.
 * Carries nothing: the account is resolved in the background from the stored
 * session, so the popup cannot name a coach. Accepted from the popup only.
 */
export interface ClaimCapturedWorkoutsMessage {
  type: 'CLAIM_CAPTURED_WORKOUTS';
}

export interface ClaimCapturedWorkoutsResult {
  claimed: number;
}

export type { CapturedWorkoutRecord, CapturedWorkoutStatus };

/**
 * Look a workout up by its TrainingPeaks id before writing it. Rarely needed,
 * since the workout POST is itself an upsert.
 */
export interface GetPlanMyPeakWorkoutByProviderIdMessage {
  type: 'GET_PLANMYPEAK_WORKOUT_BY_PROVIDER_ID';
  providerWorkoutId: string;
}

/** List the coach's TrainingPeaks plan folders, which carry their plan ids. */
export interface GetTrainingPlanFoldersMessage {
  type: 'GET_TRAINING_PLAN_FOLDERS';
}

/** List the coach's training-plan libraries (creates their default if absent). */
export interface GetPlanMyPeakPlanLibrariesMessage extends PlanMyPeakAuthRunScoped {
  type: 'GET_PLANMYPEAK_PLAN_LIBRARIES';
}

export interface CreatePlanMyPeakPlanLibraryMessage extends PlanMyPeakAuthRunScoped {
  type: 'CREATE_PLANMYPEAK_PLAN_LIBRARY';
  name: string;
  description?: string | null;
}

/** Create or update a plan, matched on provider identity. 201 created, 200 updated. */
export interface UpsertPlanMyPeakPlanMessage extends PlanMyPeakAuthRunScoped {
  type: 'UPSERT_PLANMYPEAK_PLAN';
  payload: PlanMyPeakCreatePlanRequest;
}

/** Shorten or rename a plan. Shortening past a scheduled week is a 409. */
export interface UpdatePlanMyPeakPlanMessage extends PlanMyPeakAuthRunScoped {
  type: 'UPDATE_PLANMYPEAK_PLAN';
  planId: string;
  payload: Partial<PlanMyPeakCreatePlanRequest>;
}

/** Read a plan with its schedule, for reconciling against the source. */
export interface GetPlanMyPeakPlanMessage extends PlanMyPeakAuthRunScoped {
  type: 'GET_PLANMYPEAK_PLAN';
  planId: string;
}

export interface GetPlanMyPeakPlansMessage extends PlanMyPeakAuthRunScoped {
  type: 'GET_PLANMYPEAK_PLANS';
  libraryId?: string;
  provider?: string;
  providerPlanId?: string;
}

/**
 * Start a raw training-plan import: the background fetches the plan's native
 * TrainingPeaks payloads and forwards them to PlanMyPeak untouched (begin →
 * parts → complete). The reply says whether to poll, fall back to the legacy
 * client-side path, or join an import already in progress.
 */
export interface StartPlanMyPeakPlanImportMessage extends PlanMyPeakAuthRunScoped {
  type: 'START_PLANMYPEAK_PLAN_IMPORT';
  planId: number;
  /** Only when the coach picked a library explicitly; the server has a default. */
  targetWorkoutLibraryId?: string | null;
  /**
   * A staging import of this plan the coach explicitly chose to abandon
   * after being told another window may be uploading it. Only that import
   * is abandoned, and only while it is still staging.
   */
  abandonImportId?: string;
}

/** Read a raw import's status, summary and per-item outcomes. */
export interface GetPlanMyPeakPlanImportMessage extends PlanMyPeakAuthRunScoped {
  type: 'GET_PLANMYPEAK_PLAN_IMPORT';
  importId: string;
}

/** Abandon a raw import that is still staging. */
export interface AbandonPlanMyPeakPlanImportMessage extends PlanMyPeakAuthRunScoped {
  type: 'ABANDON_PLANMYPEAK_PLAN_IMPORT';
  importId: string;
}

/** Schedule or move one session. 201 scheduled, 200 moved. */
export interface UpsertPlanMyPeakPlanEntryMessage extends PlanMyPeakAuthRunScoped {
  type: 'UPSERT_PLANMYPEAK_PLAN_ENTRY';
  planId: string;
  payload: PlanMyPeakCreatePlanEntryRequest;
}

export interface DeletePlanMyPeakPlanEntryMessage extends PlanMyPeakAuthRunScoped {
  type: 'DELETE_PLANMYPEAK_PLAN_ENTRY';
  planId: string;
  entryId: string;
}

/**
 * Message to import (ingest) TrainingPeaks athlete groups into PlanMyPeak.
 * Forwards the raw TrainingPeaks groups payload verbatim.
 */
export interface ImportAthleteGroupsToPlanMyPeakMessage {
  type: 'IMPORT_ATHLETE_GROUPS_TO_PLANMYPEAK';
  groups: AthleteGroup[];
}

/**
 * Message to fetch the authenticated PlanMyPeak coach profile.
 */
export interface GetPlanMyPeakCoachMessage {
  type: 'GET_PLANMYPEAK_COACH';
}

export type { PlanMyPeakCoach, PlanMyPeakIngestAthleteGroupsResponse };

/**
 * Message to request user profile from API
 */
export interface GetUserMessage {
  type: 'GET_USER';
}

/**
 * Message to request libraries list from API
 */
export interface GetLibrariesMessage {
  type: 'GET_LIBRARIES';
}

/**
 * Message to request library items from API
 */
export interface GetLibraryItemsMessage {
  type: 'GET_LIBRARY_ITEMS';
  libraryId: number;
}

/**
 * Message to request training plans list from API
 */
export interface GetTrainingPlansMessage {
  type: 'GET_TRAINING_PLANS';
}

/**
 * Message to request athlete groups (coach tags) from API
 */
export interface GetAthleteGroupsMessage {
  type: 'GET_ATHLETE_GROUPS';
  coachId: number;
}

/**
 * Message to request plan workouts from API
 */
export interface GetPlanWorkoutsMessage {
  type: 'GET_PLAN_WORKOUTS';
  planId: number;
}

/**
 * Message to request plan notes from API
 */
export interface GetPlanNotesMessage {
  type: 'GET_PLAN_NOTES';
  planId: number;
}

/**
 * Message to request plan events from API
 */
export interface GetPlanEventsMessage {
  type: 'GET_PLAN_EVENTS';
  planId: number;
}

/**
 * Message to request RxBuilder (structured strength) workouts from API
 */
export interface GetRxBuilderWorkoutsMessage {
  type: 'GET_RX_BUILDER_WORKOUTS';
  planId: number;
}

/**
 * Message to create Intervals.icu folder
 */
export interface CreateIntervalsFolderMessage {
  type: 'CREATE_INTERVALS_FOLDER';
  libraryName: string;
  description?: string;
}

/**
 * Message to export workouts to Intervals.icu library
 */
export interface ExportWorkoutsToLibraryMessage {
  type: 'EXPORT_WORKOUTS_TO_LIBRARY';
  workouts: LibraryItem[];
  folderId?: number;
}

/**
 * Message to export a TrainingPeaks training plan to an Intervals.icu PLAN folder
 */
export interface ExportTrainingPlanToIntervalsMessage {
  type: 'EXPORT_TRAINING_PLAN_TO_INTERVALS';
  trainingPlan: TrainingPlan;
  workouts: PlanWorkout[];
  rxWorkouts?: RxBuilderWorkout[];
  notes?: CalendarNote[];
  events?: CalendarEvent[];
  /** Correlates background progress events back to the active popup export */
  exportId?: string;
  /** Existing Intervals plan conflict strategy (when name already exists) */
  existingPlanAction?: IntervalsPlanConflictAction;
}

/**
 * Message to find an existing Intervals.icu PLAN folder by exact name
 */
export interface FindIntervalsPlanFolderByNameMessage {
  type: 'FIND_INTERVALS_PLAN_FOLDER_BY_NAME';
  planName: string;
}

/**
 * Message to find an existing Intervals.icu library folder by exact name
 */
export interface FindIntervalsLibraryFolderByNameMessage {
  type: 'FIND_INTERVALS_LIBRARY_FOLDER_BY_NAME';
  folderName: string;
}

/**
 * Message to delete an Intervals.icu folder/plan by id
 */
export interface DeleteIntervalsFolderMessage {
  type: 'DELETE_INTERVALS_FOLDER';
  folderId: number;
}

export type TrainingPlanExportProgressPhase =
  | 'folder'
  | 'classicWorkouts'
  | 'rxWorkouts'
  | 'plan'
  | 'entries'
  | 'notes'
  | 'events'
  | 'complete';

export type TrainingPlanExportProgressStatus =
  | 'started'
  | 'progress'
  | 'completed'
  | 'failed';

export interface TrainingPlanExportProgressPayload {
  phase: TrainingPlanExportProgressPhase;
  status: TrainingPlanExportProgressStatus;
  current: number;
  total: number;
  overallCurrent: number;
  overallTotal: number;
  itemName?: string;
  message?: string;
}

/**
 * Background -> popup progress event for Intervals training plan export.
 */
export interface TrainingPlanExportProgressMessage {
  type: 'TRAINING_PLAN_EXPORT_PROGRESS';
  exportId: string;
  progress: TrainingPlanExportProgressPayload;
}

/**
 * Message to set Intervals.icu API key
 */
export interface SetIntervalsApiKeyMessage {
  type: 'SET_INTERVALS_API_KEY';
  apiKey: string;
}

/**
 * Message to get Intervals.icu API key
 */
export interface GetIntervalsApiKeyMessage {
  type: 'GET_INTERVALS_API_KEY';
}

/**
 * Message to check if Intervals.icu API key exists
 */
export interface HasIntervalsApiKeyMessage {
  type: 'HAS_INTERVALS_API_KEY';
}

/**
 * Message to clear Intervals.icu API key
 */
export interface ClearIntervalsApiKeyMessage {
  type: 'CLEAR_INTERVALS_API_KEY';
}

/**
 * Message to get debug API logs
 */
export interface GetDebugLogsMessage {
  type: 'GET_DEBUG_LOGS';
}

/**
 * Message to clear debug API logs
 */
export interface ClearDebugLogsMessage {
  type: 'CLEAR_DEBUG_LOGS';
}

/**
 * Envelope carrying a validated PlanMyPeak site-control request from the
 * content-script bridge to the background worker.
 *
 * The page names a site-control request type, never a `RuntimeMessage` type, so
 * the page-reachable surface stays limited to `SiteControlRequestType` and does
 * not grow when handlers are added to the router below.
 */
export interface SiteControlRequestMessage {
  type: 'SITE_CONTROL_REQUEST';
  request: SiteControlRequest;
}

export type RuntimeMessage =
  | TokenFoundMessage
  | MyPeakAuthFoundMessage
  | GetTokenMessage
  | ClearTokenMessage
  | ValidateTokenMessage
  | ValidateMyPeakTokenMessage
  | RefreshProviderAuthMessage
  | BeginPlanMyPeakAuthRunMessage
  | EndPlanMyPeakAuthRunMessage
  | DiscardStaleMyPeakTokenMessage
  | GetPlanMyPeakLibrariesMessage
  | CreatePlanMyPeakLibraryMessage
  | DeletePlanMyPeakLibraryMessage
  | ExportWorkoutsToPlanMyPeakLibraryMessage
  | GetPlanMyPeakWorkoutByProviderIdMessage
  | DeletePlanMyPeakWorkoutMessage
  | GetPlanMyPeakWorkoutsMessage
  | GetTrainingPlanFoldersMessage
  | GetPlanMyPeakPlanLibrariesMessage
  | CreatePlanMyPeakPlanLibraryMessage
  | UpsertPlanMyPeakPlanMessage
  | UpdatePlanMyPeakPlanMessage
  | GetPlanMyPeakPlanMessage
  | GetPlanMyPeakPlansMessage
  | StartPlanMyPeakPlanImportMessage
  | GetPlanMyPeakPlanImportMessage
  | AbandonPlanMyPeakPlanImportMessage
  | UpsertPlanMyPeakPlanEntryMessage
  | DeletePlanMyPeakPlanEntryMessage
  | ImportAthleteGroupsToPlanMyPeakMessage
  | GetPlanMyPeakCoachMessage
  | GetUserMessage
  | GetLibrariesMessage
  | GetLibraryItemsMessage
  | GetTrainingPlansMessage
  | GetAthleteGroupsMessage
  | GetPlanWorkoutsMessage
  | GetPlanNotesMessage
  | GetPlanEventsMessage
  | GetRxBuilderWorkoutsMessage
  | CreateIntervalsFolderMessage
  | ExportWorkoutsToLibraryMessage
  | ExportTrainingPlanToIntervalsMessage
  | FindIntervalsPlanFolderByNameMessage
  | FindIntervalsLibraryFolderByNameMessage
  | DeleteIntervalsFolderMessage
  | TrainingPlanExportProgressMessage
  | SetIntervalsApiKeyMessage
  | GetIntervalsApiKeyMessage
  | HasIntervalsApiKeyMessage
  | ClearIntervalsApiKeyMessage
  | GetDebugLogsMessage
  | ClearDebugLogsMessage
  | WorkoutCapturedMessage
  | GetCapturedWorkoutsMessage
  | UpdateCapturedWorkoutMessage
  | RemoveCapturedWorkoutsMessage
  | ClaimCapturedWorkoutsMessage
  | SiteControlRequestMessage;

export interface FindIntervalsPlanFolderByNameResponse {
  exists: boolean;
  folder: IntervalsFolderResponse | null;
}

/**
 * Token storage structure
 */
export interface TokenStorage {
  auth_token: string | null;
  token_timestamp: number | null;
}

export interface MyPeakTokenStorage {
  mypeak_auth_token: string | null;
  mypeak_token_timestamp: number | null;
  mypeak_supabase_api_key: string | null;
}

/**
 * Re-export LibraryItem from schema for convenience
 */
export type { LibraryItem } from '@/schemas/library.schema';
