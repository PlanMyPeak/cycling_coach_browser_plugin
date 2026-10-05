/**
 * Message handler for background service worker
 *
 * Handles messages from content scripts and popup
 */

import type {
  RuntimeMessage,
  TrainingPlanExportProgressMessage,
  TrainingPlanExportProgressPayload,
  WorkoutCapturedMessage,
  UpdateCapturedWorkoutMessage,
  CapturedWorkoutsListResult,
  RemoveCapturedWorkoutsResult,
  ClaimCapturedWorkoutsResult,
  CapturedWorkoutRecord,
  CapturedWorkoutStatus,
  AuthRefreshProvider,
  BeginPlanMyPeakAuthRunResult,
  PlanMyPeakAuthRunScoped,
} from '@/types';
import {
  beginAuthRun,
  endAuthRun,
  getAuthRun,
} from '@/background/api/planMyPeakAuthRecovery';
import { isPlanMyPeakAuthErrorCode } from '@/utils/planMyPeakAuthErrors';
import {
  removePlanMyPeakCredentialIf,
  removePlanMyPeakCredentialIfStale,
  storeObservedPlanMyPeakAuth,
} from '@/background/api/planMyPeakCredential';
import type {
  UserProfile,
  Library,
  LibraryItem,
  TrainingPlan,
  PlanWorkout,
  CalendarNote,
  CalendarEvent,
  RxBuilderWorkout,
  AthleteGroup,
  ApiResponse,
} from '@/types/api.types';
import type { PlanFolder } from '@/schemas/trainingPlan.schema';
import type {
  PlanMyPeakPlanLibrary,
  PlanMyPeakPlanSummary,
  PlanMyPeakPlanDetail,
  PlanMyPeakPlanEntry,
  PlanMyPeakLibrary,
  PlanMyPeakWorkoutLibraryItem,
  PlanMyPeakIngestAthleteGroupsResponse,
  PlanMyPeakCoach,
} from '@/schemas/planMyPeakApi.schema';
import type {
  PlanMyPeakSaveTrainingPlanResponse,
  PlanMyPeakTrainingPlanNote,
  PlanMyPeakWorkout,
} from '@/types/planMyPeak.types';
import { logger } from '@/utils/logger';
import {
  STORAGE_KEYS,
  createApiHeaders,
  isPlanMyPeakControlOrigin,
  originFromUrl,
  trainingPeaksEnvironmentForAppOrigin,
} from '@/utils/constants';
import {
  claimUnlinkedCapturedWorkouts,
  listCapturedWorkouts,
  removeCapturedWorkouts,
  storeCapture,
  updateCapturedWorkout,
} from '@/services/capturedWorkoutService';
import {
  primePlanMyPeakIdentityIfCurrent,
  resolveCaptureContext,
  resolvePlanMyPeakCoachId,
} from '@/services/planMyPeakIdentityService';
import {
  handleCapturedWorkoutImportStatus,
  handleCapturedWorkoutSummary,
  handleImportMissingWorkouts,
  isSiteControlCapturedImportActive,
} from './capturedImports/siteControlHandlers';
import { trackPopupCapturedSend } from './capturedImports/importRunner';
import { refreshBadge } from '@/services/badgeService';
import {
  refreshProviderAuth,
  type AuthRefreshResult,
} from '@/services/authRefreshService';
import {
  isAuthenticated as isTrainingPeaksAuthenticated,
  isTokenExpired as isTrainingPeaksTokenExpired,
} from '@/services/authService';
import {
  isAuthenticated as isPlanMyPeakAuthenticated,
  getAuthToken as getPlanMyPeakAuthToken,
} from '@/services/myPeakAuthService';
import {
  createErrorResponse,
  createSuccessResponse,
  parseSiteControlRequest,
} from '@/schemas/siteControl.schema';
import {
  PLANMYPEAK_SITE_CONTROL_VERSION,
  SITE_CONTROL_REQUEST_TYPES,
} from '@/types/siteControl.types';
import { getPlanMyPeakAppUrl } from '@/services/planMyPeakConfigService';
import {
  getTrainingPeaksApiBaseUrl,
  getTrainingPeaksAppUrl,
} from '@/services/trainingPeaksConfigService';
import {
  fetchUser,
  fetchLibraries,
  fetchLibraryItems,
  fetchTrainingPlans,
  fetchTrainingPlanFolders,
  fetchPlanWorkouts,
  fetchPlanNotes,
  fetchPlanEvents,
  fetchRxBuilderWorkouts,
  fetchAthleteGroups,
} from './api/trainingPeaks';
import {
  fetchPlanMyPeakLibraries,
  fetchPlanMyPeakWorkoutByProviderId,
  createPlanMyPeakLibrary,
  deletePlanMyPeakLibrary,
  deletePlanMyPeakWorkout,
  fetchPlanMyPeakWorkouts,
  upsertPlanMyPeakPlan,
  upsertPlanMyPeakPlanEntry,
  deletePlanMyPeakPlanEntry,
  updatePlanMyPeakPlan,
  fetchPlanMyPeakPlan,
  fetchPlanMyPeakPlans,
  fetchPlanMyPeakPlanLibraries,
  createPlanMyPeakPlanLibrary,
  exportWorkoutsToPlanMyPeakLibrary,
  type PlanMyPeakRequestAuth,
  type PlanMyPeakUploadSummary,
  type PlanMyPeakCreatePlanRequest,
  type PlanMyPeakCreatePlanEntryRequest,
  type PlanMyPeakUpsertResult,
  ingestTrainingPeaksAthleteGroups,
  fetchPlanMyPeakCoach,
} from './api/planMyPeak';
import {
  abandonPlanImport,
  fetchPlanImport,
  type PlanImportApiFailure,
} from './api/planMyPeakPlanImport';
import { startRawPlanImport } from './planImport/rawPlanImportRunner';
import type { PlanImportResponse } from '@/schemas/planMyPeakPlanImport.schema';
import type { RawPlanImportStart } from '@/types/planImport.types';
import {
  createIntervalsFolder,
  deleteIntervalsFolder,
  findIntervalsLibraryFolderByName,
  findIntervalsPlanFolderByName,
  exportTrainingPlanToIntervalsPlan,
  exportWorkoutsToLibrary,
} from './api/intervalsicu';
import {
  setIntervalsApiKey,
  getIntervalsApiKey,
  hasIntervalsApiKey,
  clearIntervalsApiKey,
} from '@/services/intervalsApiKeyService';
import {
  getLogs as getDebugLogs,
  clearLogs as clearDebugLogs,
} from '@/services/debugLogService';
import type { ApiLogEntry } from '@/types/debugLog.types';
import type {
  IntervalsFolderResponse,
  IntervalsTrainingPlanExportResult,
  IntervalsWorkoutResponse,
} from '@/types/intervalsicu.types';
import type { SiteControlRequestMessage } from '@/types';
import type {
  SiteControlError,
  SiteControlPingResult,
  SiteControlPlanContentsResult,
  SiteControlTrainingPlanLibrary,
  SiteControlResponse,
} from '@/types/siteControl.types';
import type { ApiError } from '@/schemas/api.schema';

type MessageResponse =
  | { success: true }
  | { success: false; error: string }
  | { token: string | null; timestamp: number | null }
  | { valid: boolean; userId?: number | string }
  | { apiKey: string | null }
  | { hasKey: boolean }
  | { logs: ApiLogEntry[] }
  | ApiResponse<UserProfile>
  | ApiResponse<Library[]>
  | ApiResponse<PlanMyPeakLibrary[]>
  | ApiResponse<PlanMyPeakWorkoutLibraryItem[]>
  | ApiResponse<PlanMyPeakWorkoutLibraryItem | null>
  | ApiResponse<LibraryItem[]>
  | ApiResponse<TrainingPlan[]>
  | ApiResponse<AthleteGroup[]>
  | ApiResponse<PlanWorkout[]>
  | ApiResponse<CalendarNote[]>
  | ApiResponse<CalendarEvent[]>
  | ApiResponse<IntervalsFolderResponse>
  | ApiResponse<IntervalsFolderResponse | null>
  | ApiResponse<IntervalsTrainingPlanExportResult>
  | ApiResponse<IntervalsWorkoutResponse[]>
  | ApiResponse<PlanMyPeakLibrary>
  | ApiResponse<PlanMyPeakSaveTrainingPlanResponse>
  | ApiResponse<PlanMyPeakTrainingPlanNote>
  | ApiResponse<PlanMyPeakIngestAthleteGroupsResponse>
  | ApiResponse<PlanMyPeakCoach>
  | ApiResponse<null>
  | ApiResponse<CapturedWorkoutsListResult>
  | ApiResponse<CapturedWorkoutRecord | null>
  | ApiResponse<RemoveCapturedWorkoutsResult>
  | ApiResponse<ClaimCapturedWorkoutsResult>
  | AuthRefreshResult
  | BeginPlanMyPeakAuthRunResult
  | SiteControlResponse;

/**
 * Handle TOKEN_FOUND message from content script
 */
async function handleTokenFound(
  token: string,
  timestamp: number
): Promise<void> {
  try {
    logger.info('Storing TrainingPeaks authentication token');
    logger.debug('Token timestamp:', new Date(timestamp).toISOString());

    // Store token in chrome.storage.local
    await chrome.storage.local.set({
      auth_token: token,
      token_timestamp: timestamp,
    });

    logger.info('TrainingPeaks authentication token stored successfully');

    // Verify storage (debug)
    const stored = await chrome.storage.local.get([
      'auth_token',
      'token_timestamp',
    ]);
    logger.debug('Stored token verification:', {
      hasToken: !!stored.auth_token,
      hasTimestamp: !!stored.token_timestamp,
    });
  } catch (error) {
    logger.error('❌ Failed to store token:', error);
    throw error;
  }
}

/**
 * Handle MY_PEAK_AUTH_FOUND message from content script
 *
 * Stores MyPeak/Supabase auth details observed in browser requests.
 * `apiKey` may be captured before an authenticated user token, so both fields
 * are stored independently and only updated when present.
 */
async function handleMyPeakAuthFound(
  token: string | null | undefined,
  apiKey: string | null | undefined,
  timestamp: number,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  try {
    // The environment is derived from where the credential was observed,
    // never from the message, and a capture from a confirmed inactive
    // environment is refused so it cannot displace the active one.
    const outcome = await storeObservedPlanMyPeakAuth({
      token,
      apiKey,
      timestamp,
      senderOrigin: sender.origin ?? originFromUrl(sender.tab?.url),
    });

    if (outcome === 'ignored') {
      logger.debug('No MyPeak auth fields to store (message ignored)');
    } else if (outcome === 'stored') {
      logger.info('✅ MyPeak auth details stored successfully');
    }
  } catch (error) {
    logger.error('❌ Failed to store MyPeak auth details:', error);
    throw error;
  }
}

/**
 * Handle GET_TOKEN message from popup
 */
async function handleGetToken(): Promise<{
  token: string | null;
  timestamp: number | null;
}> {
  try {
    const data = await chrome.storage.local.get([
      'auth_token',
      'token_timestamp',
    ]);
    return {
      token: (data.auth_token as string) || null,
      timestamp: (data.token_timestamp as number) || null,
    };
  } catch (error) {
    logger.error('Failed to retrieve token:', error);
    throw error;
  }
}

/**
 * Handle CLEAR_TOKEN message from popup
 */
async function handleClearToken(): Promise<void> {
  try {
    await chrome.storage.local.remove(['auth_token', 'token_timestamp']);
    logger.info('Token cleared');
  } catch (error) {
    logger.error('Failed to clear token:', error);
    throw error;
  }
}

/**
 * Handle VALIDATE_TOKEN message from popup
 * Validates token by calling TrainingPeaks API from background context (bypasses CORS)
 */
async function handleValidateToken(): Promise<{
  valid: boolean;
  userId?: number;
}> {
  try {
    logger.debug('Starting token validation...');

    // Get token from storage
    const data = await chrome.storage.local.get(['auth_token']);
    const token = data.auth_token as string | undefined;

    logger.debug('Has token:', !!token);

    if (!token) {
      logger.debug('No token to validate');
      return { valid: false };
    }

    // Call TrainingPeaks API from background context (has host_permissions)
    const apiBaseUrl = await getTrainingPeaksApiBaseUrl();
    const appUrl = await getTrainingPeaksAppUrl();
    const endpoint = `${apiBaseUrl}/users/v3/user`;
    logger.debug('Calling API:', endpoint);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: createApiHeaders(token, appUrl),
    });

    logger.debug('Response status:', response.status);
    logger.debug('Response ok:', response.ok);

    if (response.ok) {
      const data = await response.json();
      logger.info('Token is valid, User ID:', data.user?.userId);
      return { valid: true, userId: data.user?.userId };
    }

    // Token validation failed
    if (response.status === 401) {
      logger.warn('Token validation returned 401 (token expired)');
    } else {
      logger.error('Token validation failed - Status:', response.status);
    }

    if (response.status === 401) {
      await chrome.storage.local.remove([
        STORAGE_KEYS.AUTH_TOKEN,
        STORAGE_KEYS.TOKEN_TIMESTAMP,
      ]);
      logger.warn('Cleared TrainingPeaks auth token after VALIDATE_TOKEN 401');
    }

    logger.warn('Token validation failed');

    return { valid: false };
  } catch (error) {
    logger.error('Error validating token:', error);
    // On network error, don't clear token (might be temporary)
    return { valid: false };
  }
}

/**
 * The credential policy a PlanMyPeak request runs under.
 *
 * A request carrying the id of a live run may recover; anything else — no id,
 * an ended run, an expired one, an id the background never minted — is
 * resolved passively.
 */
function requestAuth(message: PlanMyPeakAuthRunScoped): PlanMyPeakRequestAuth {
  return { run: getAuthRun(message.authRunId) };
}

/**
 * Handle BEGIN_PLANMYPEAK_AUTH_RUN.
 *
 * A run lets requests open a sign-in tab, so it is minted only for the
 * extension's own pages (no `sender.tab`). A page — including the in-page
 * overlay — gets no run and stays passive in this change.
 */
function handleBeginPlanMyPeakAuthRun(
  sender: chrome.runtime.MessageSender
): BeginPlanMyPeakAuthRunResult {
  if (sender.tab) {
    logger.warn('Rejected BEGIN_PLANMYPEAK_AUTH_RUN from a tab');
    return { authRunId: null };
  }

  return { authRunId: beginAuthRun().id };
}

function handleEndPlanMyPeakAuthRun(authRunId: string): void {
  const run = getAuthRun(authRunId);
  if (run) {
    endAuthRun(run);
  }
}

/**
 * Handle REFRESH_PROVIDER_AUTH.
 *
 * Opens a tab, so it is accepted only from the extension's own pages (no
 * `sender.tab`) or from the PlanMyPeak overlay on an allowlisted origin —
 * never from an arbitrary tab.
 */
async function handleRefreshProviderAuth(
  provider: AuthRefreshProvider,
  sender: chrome.runtime.MessageSender
): Promise<AuthRefreshResult> {
  const origin = sender.origin ?? originFromUrl(sender.tab?.url);
  if (sender.tab && !isPlanMyPeakControlOrigin(origin)) {
    logger.warn('Rejected REFRESH_PROVIDER_AUTH from an untrusted tab');
    return { outcome: 'error', error: 'Refresh not allowed from this page' };
  }

  if (provider !== 'trainingpeaks' && provider !== 'planmypeak') {
    return { outcome: 'error', error: 'Unknown provider' };
  }

  return await refreshProviderAuth(provider);
}

/**
 * Handle VALIDATE_MY_PEAK_TOKEN message from popup
 *
 * Validates MyPeak auth against the PlanMyPeak app backend
 * (`/api/backend/coaches/me`) using the captured coach bearer token. The portal
 * (local and production) authenticates through its own backend rather than
 * Supabase directly, so this avoids any dependency on a Supabase anon API key.
 */
async function handleValidateMyPeakToken(): Promise<{
  valid: boolean;
  userId?: string;
}> {
  try {
    logger.debug('Starting MyPeak token validation...');

    const data = await chrome.storage.local.get([
      STORAGE_KEYS.MYPEAK_AUTH_TOKEN,
    ]);

    const token = data[STORAGE_KEYS.MYPEAK_AUTH_TOKEN] as string | undefined;

    if (!token) {
      logger.debug('No MyPeak auth token to validate');
      return { valid: false };
    }

    return await validateMyPeakTokenViaAppBackend(token);
  } catch (error) {
    logger.error('Error validating MyPeak token:', error);
    return { valid: false };
  }
}

/**
 * Validate a PlanMyPeak token against the app's own backend.
 *
 * The portal (local and production) authenticates through its `/api/backend/*`
 * routes (server-side) rather than calling Supabase from the browser, so this
 * needs no Supabase anon key. A `200` from `/api/backend/coaches/me` confirms
 * the bearer token is a valid logged-in session; a `401` clears the stored
 * token. `getPlanMyPeakAppUrl()` resolves to whichever environment is selected
 * in Settings — the portal, staging, or the local dev app.
 */
async function validateMyPeakTokenViaAppBackend(token: string): Promise<{
  valid: boolean;
  userId?: string;
}> {
  const appUrl = await getPlanMyPeakAppUrl();
  const endpoint = `${appUrl}/api/backend/coaches/me`;
  logger.debug('Validating MyPeak token via app backend endpoint:', endpoint);

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
  });

  if (response.ok) {
    const coach = (await response.json()) as { id?: string };
    logger.info('MyPeak token is valid, coach:', coach?.id);
    return { valid: true, userId: coach?.id };
  }

  const errorText = await response.text();
  logger.warn(
    'MyPeak token validation (app backend) failed - Status:',
    response.status,
    'Response:',
    errorText
  );

  if (response.status === 401) {
    // Compare-and-remove: a credential captured while this request was in
    // flight is not the one that was rejected, and must survive.
    await removePlanMyPeakCredentialIf(
      token,
      'VALIDATE_MY_PEAK_TOKEN was rejected'
    );
  }

  return { valid: false };
}

/**
 * Handle GET_USER message from popup
 * Fetches user profile from TrainingPeaks API
 */
async function handleGetUser(): Promise<ApiResponse<UserProfile>> {
  logger.debug('Handling GET_USER message');
  return await fetchUser();
}

/**
 * Handle GET_LIBRARIES message from popup
 * Fetches libraries list from TrainingPeaks API
 */
async function handleGetLibraries(): Promise<ApiResponse<Library[]>> {
  logger.debug('Handling GET_LIBRARIES message');
  return await fetchLibraries();
}

/**
 * Handle GET_PLANMYPEAK_LIBRARIES message from popup
 * Fetches workout libraries from PlanMyPeak API
 */
async function handleGetPlanMyPeakLibraries(
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakLibrary[]>> {
  logger.debug('Handling GET_PLANMYPEAK_LIBRARIES message');
  return await fetchPlanMyPeakLibraries(auth);
}

/**
 * Handle CREATE_PLANMYPEAK_LIBRARY message from popup
 * Creates a workout library in PlanMyPeak
 */
async function handleCreatePlanMyPeakLibrary(
  name: string,
  description: string | null | undefined,
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakLibrary>> {
  logger.debug('Handling CREATE_PLANMYPEAK_LIBRARY message:', name);
  return await createPlanMyPeakLibrary(name, description, auth);
}

async function handleImportAthleteGroupsToPlanMyPeak(
  groups: AthleteGroup[]
): Promise<ApiResponse<PlanMyPeakIngestAthleteGroupsResponse>> {
  logger.debug(
    'Handling IMPORT_ATHLETE_GROUPS_TO_PLANMYPEAK message:',
    groups.length
  );
  return await ingestTrainingPeaksAthleteGroups(groups);
}

async function handleGetPlanMyPeakCoach(): Promise<
  ApiResponse<PlanMyPeakCoach>
> {
  logger.debug('Handling GET_PLANMYPEAK_COACH message');
  // Read before the request: the identity cache is bound to the credential
  // the lookup actually ran under, not to whatever is stored once it returns.
  const tokenAtRequest = await getPlanMyPeakAuthToken();
  const coach = await fetchPlanMyPeakCoach();
  if (coach.success) {
    // The popup asks for the coach before it sends anything, so a later
    // upload can acknowledge captures for this account without a lookup.
    await primePlanMyPeakIdentityIfCurrent(tokenAtRequest, coach.data.id);
  }
  return coach;
}

/**
 * Handle DELETE_PLANMYPEAK_LIBRARY message from popup
 * Deletes a workout library in PlanMyPeak
 */
async function handleDeletePlanMyPeakLibrary(
  libraryId: string,
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<null>> {
  logger.debug('Handling DELETE_PLANMYPEAK_LIBRARY message:', libraryId);
  return await deletePlanMyPeakLibrary(libraryId, auth);
}

/**
 * Handle GET_PLANMYPEAK_WORKOUTS message from popup
 */
async function handleGetPlanMyPeakWorkouts(
  filters: {
    libraryId?: string;
    provider?: string;
    providerWorkoutId?: string;
  },
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakWorkoutLibraryItem[]>> {
  logger.debug('Handling GET_PLANMYPEAK_WORKOUTS message:', filters);
  return await fetchPlanMyPeakWorkouts(filters, auth);
}

/**
 * Handle DELETE_PLANMYPEAK_WORKOUT message from popup
 */
async function handleDeletePlanMyPeakWorkout(
  workoutId: string,
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<null>> {
  logger.debug('Handling DELETE_PLANMYPEAK_WORKOUT message:', workoutId);
  return await deletePlanMyPeakWorkout(workoutId, auth);
}

/**
 * Handle EXPORT_WORKOUTS_TO_PLANMYPEAK_LIBRARY message from popup
 * Uploads transformed workouts to a PlanMyPeak library
 */
async function handleExportWorkoutsToPlanMyPeakLibrary(
  workouts: PlanMyPeakWorkout[],
  libraryId: string,
  capturedKeys: Record<string, string> | undefined,
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakUploadSummary>> {
  logger.debug(
    'Handling EXPORT_WORKOUTS_TO_PLANMYPEAK_LIBRARY message:',
    workouts.length,
    'workouts -> library',
    libraryId
  );

  // One captured-workout import per account at a time, whichever surface
  // started it. A popup send racing a page-driven run would upload the same
  // captures twice into the same upsert and report both as its own.
  if (capturedKeys && Object.keys(capturedKeys).length > 0) {
    const active = await isSiteControlCapturedImportActive();
    if (active) {
      return {
        success: false,
        error: {
          message:
            'PlanMyPeak is already importing these workouts. Wait for that import to finish, then try again.',
          code: 'IMPORT_IN_PROGRESS',
        },
      };
    }
  }

  const isCapturedSend = !!capturedKeys && Object.keys(capturedKeys).length > 0;
  const upload = exportWorkoutsToPlanMyPeakLibrary(workouts, libraryId, {
    capturedKeys,
    // The captured-workout send stays passive in this change: recovering there
    // needs account identity to tolerate a credential changing mid-lookup.
    auth: isCapturedSend ? undefined : auth,
  });

  // Registered so a page-driven import started meanwhile waits for this send
  // instead of uploading the same captures alongside it.
  return isCapturedSend ? await trackPopupCapturedSend(upload) : await upload;
}

/**
 * Handle WORKOUT_CAPTURED from the TrainingPeaks content-script bridge.
 *
 * Origin-gated: this message writes durable state that later drives uploads
 * into the coach's PlanMyPeak account, so it is accepted only from a tab whose
 * URL origin is a TrainingPeaks app origin. The popup can never send it. The
 * environment (production / sandbox) is derived from that origin, not from
 * anything in the message.
 */
async function handleWorkoutCaptured(
  message: WorkoutCapturedMessage,
  sender: chrome.runtime.MessageSender
): Promise<{ success: true } | { success: false; error: string }> {
  const origin = originFromUrl(sender.url ?? sender.tab?.url);
  const environment = trainingPeaksEnvironmentForAppOrigin(origin);

  if (!sender.tab || !environment) {
    logger.warn('Rejected WORKOUT_CAPTURED from a non-TrainingPeaks sender');
    return { success: false, error: 'Capture rejected: untrusted sender' };
  }

  // Who this capture belongs to is decided now, from the stored PlanMyPeak
  // session, and never revisited. If it cannot be resolved the record is
  // stored unowned and stays private to the popup until the coach links it.
  const owner = await resolveCaptureContext();

  const stored = await storeCapture(
    message,
    environment,
    owner ? { coachId: owner.coachId, destination: owner.destination } : null
  );
  if (!stored) {
    return { success: false, error: 'Capture rejected: invalid payload' };
  }

  await refreshBadge();
  return { success: true };
}

async function handleGetCapturedWorkouts(): Promise<
  ApiResponse<CapturedWorkoutsListResult>
> {
  const list = await listCapturedWorkouts();
  return { success: true, data: list };
}

/**
 * Handle CLAIM_CAPTURED_WORKOUTS from the popup.
 *
 * Accepted only from the extension's own pages (no `sender.tab`): a content
 * script on any site must not be able to hand unowned captures to the current
 * session. The account is resolved here, freshly, from the stored credential;
 * a session that cannot be verified links nothing.
 */
async function handleClaimCapturedWorkouts(
  sender: chrome.runtime.MessageSender
): Promise<ApiResponse<ClaimCapturedWorkoutsResult>> {
  if (sender.tab) {
    logger.warn('Rejected CLAIM_CAPTURED_WORKOUTS from a tab');
    return {
      success: false,
      error: {
        message: 'Captured workouts can only be linked from the extension',
      },
    };
  }

  const context = await resolveCaptureContext();
  if (!context) {
    return {
      success: false,
      error: {
        message:
          'Sign in to PlanMyPeak in the extension before linking captured workouts.',
        code: 'NO_TOKEN',
      },
    };
  }

  const claimed = await claimUnlinkedCapturedWorkouts({
    coachId: context.coachId,
    destination: context.destination,
  });
  return { success: true, data: { claimed } };
}

async function handleUpdateCapturedWorkout(
  message: UpdateCapturedWorkoutMessage
): Promise<ApiResponse<CapturedWorkoutRecord | null>> {
  const record = await updateCapturedWorkout(message.key, {
    status: message.status,
    planMyPeakWorkoutId: message.planMyPeakWorkoutId,
    planMyPeakLibraryName: message.planMyPeakLibraryName,
    lastSendError: message.lastSendError,
  });
  await refreshBadge();
  return { success: true, data: record };
}

async function handleRemoveCapturedWorkouts(
  statuses: CapturedWorkoutStatus[]
): Promise<ApiResponse<RemoveCapturedWorkoutsResult>> {
  const removed = await removeCapturedWorkouts(statuses);
  await refreshBadge();
  return { success: true, data: { removed } };
}

/**
 * Handle GET_PLANMYPEAK_WORKOUT_BY_PROVIDER_ID message from popup
 * Finds a PlanMyPeak workout by its TrainingPeaks id (optionally scoped to a library)
 */
async function handleGetPlanMyPeakWorkoutByProviderId(
  providerWorkoutId: string
): Promise<ApiResponse<PlanMyPeakWorkoutLibraryItem | null>> {
  logger.debug(
    'Handling GET_PLANMYPEAK_WORKOUT_BY_PROVIDER_ID message:',
    providerWorkoutId
  );
  return await fetchPlanMyPeakWorkoutByProviderId(providerWorkoutId);
}

/**
 * Handle GET_TRAINING_PLAN_FOLDERS message from popup.
 * Folders are how TrainingPeaks groups plans; each carries the ids it holds.
 */
async function handleGetTrainingPlanFolders(): Promise<
  ApiResponse<PlanFolder[]>
> {
  logger.debug('Handling GET_TRAINING_PLAN_FOLDERS message');
  return await fetchTrainingPlanFolders();
}

/** Training-plan library and plan operations, all thin pass-throughs. */
async function handleGetPlanMyPeakPlanLibraries(
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakPlanLibrary[]>> {
  logger.debug('Handling GET_PLANMYPEAK_PLAN_LIBRARIES message');
  return await fetchPlanMyPeakPlanLibraries(auth);
}

async function handleCreatePlanMyPeakPlanLibrary(
  name: string,
  description: string | null | undefined,
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakPlanLibrary>> {
  logger.debug('Handling CREATE_PLANMYPEAK_PLAN_LIBRARY message:', name);
  return await createPlanMyPeakPlanLibrary(name, description, auth);
}

async function handleUpsertPlanMyPeakPlan(
  payload: PlanMyPeakCreatePlanRequest,
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakUpsertResult<PlanMyPeakPlanSummary>>> {
  logger.debug('Handling UPSERT_PLANMYPEAK_PLAN message:', payload.name);
  return await upsertPlanMyPeakPlan(payload, auth);
}

async function handleUpdatePlanMyPeakPlan(
  planId: string,
  payload: Partial<PlanMyPeakCreatePlanRequest>,
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakPlanSummary>> {
  logger.debug('Handling UPDATE_PLANMYPEAK_PLAN message:', planId);
  return await updatePlanMyPeakPlan(planId, payload, auth);
}

async function handleGetPlanMyPeakPlan(
  planId: string,
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakPlanDetail>> {
  logger.debug('Handling GET_PLANMYPEAK_PLAN message:', planId);
  return await fetchPlanMyPeakPlan(planId, auth);
}

async function handleGetPlanMyPeakPlans(
  filters: {
    libraryId?: string;
    provider?: string;
    providerPlanId?: string;
  },
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakPlanSummary[]>> {
  logger.debug('Handling GET_PLANMYPEAK_PLANS message:', filters);
  return await fetchPlanMyPeakPlans(filters, auth);
}

/**
 * Raw training-plan import. The background fetches the native TrainingPeaks
 * payloads itself and forwards them; the popup only learns ids and outcomes.
 */
async function handleStartPlanMyPeakPlanImport(
  planId: number,
  targetWorkoutLibraryId: string | null | undefined,
  abandonImportId: string | undefined,
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<RawPlanImportStart>> {
  logger.debug('Handling START_PLANMYPEAK_PLAN_IMPORT message:', planId);
  return await startRawPlanImport({
    planId,
    targetWorkoutLibraryId,
    abandonImportId,
    auth,
  });
}

/** The import client's failures carry `details`; the popup gets the rest. */
function planImportFailureToApiResponse(
  error: PlanImportApiFailure
): ApiResponse<never> {
  return {
    success: false,
    error: {
      message: error.message,
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.code ? { code: error.code } : {}),
    },
  };
}

async function handleGetPlanMyPeakPlanImport(
  importId: string,
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanImportResponse>> {
  logger.debug('Handling GET_PLANMYPEAK_PLAN_IMPORT message:', importId);
  const result = await fetchPlanImport(importId, auth);
  return result.success
    ? { success: true, data: result.data }
    : planImportFailureToApiResponse(result.error);
}

async function handleAbandonPlanMyPeakPlanImport(
  importId: string,
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanImportResponse>> {
  logger.debug('Handling ABANDON_PLANMYPEAK_PLAN_IMPORT message:', importId);
  const result = await abandonPlanImport(importId, auth);
  return result.success
    ? { success: true, data: result.data }
    : planImportFailureToApiResponse(result.error);
}

async function handleUpsertPlanMyPeakPlanEntry(
  planId: string,
  payload: PlanMyPeakCreatePlanEntryRequest,
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakUpsertResult<PlanMyPeakPlanEntry>>> {
  logger.debug(
    'Handling UPSERT_PLANMYPEAK_PLAN_ENTRY message:',
    planId,
    payload.weekNumber,
    payload.dayOfWeek
  );
  return await upsertPlanMyPeakPlanEntry(planId, payload, auth);
}

async function handleDeletePlanMyPeakPlanEntry(
  planId: string,
  entryId: string,
  auth: PlanMyPeakRequestAuth
): Promise<ApiResponse<null>> {
  logger.debug(
    'Handling DELETE_PLANMYPEAK_PLAN_ENTRY message:',
    planId,
    entryId
  );
  return await deletePlanMyPeakPlanEntry(planId, entryId, auth);
}

/**
 * Handle GET_LIBRARY_ITEMS message from popup
 * Fetches library items from TrainingPeaks API
 */
async function handleGetLibraryItems(
  libraryId: number
): Promise<ApiResponse<LibraryItem[]>> {
  logger.debug('Handling GET_LIBRARY_ITEMS message for library:', libraryId);
  return await fetchLibraryItems(libraryId);
}

/**
 * Handle GET_TRAINING_PLANS message from popup
 * Fetches training plans list from TrainingPeaks API
 */
async function handleGetTrainingPlans(): Promise<ApiResponse<TrainingPlan[]>> {
  logger.debug('Handling GET_TRAINING_PLANS message');
  return await fetchTrainingPlans();
}

/**
 * Handle GET_ATHLETE_GROUPS message from popup
 * Fetches athlete groups (coach tags) from TrainingPeaks API
 */
async function handleGetAthleteGroups(
  coachId: number
): Promise<ApiResponse<AthleteGroup[]>> {
  logger.debug('Handling GET_ATHLETE_GROUPS message for coach:', coachId);
  return await fetchAthleteGroups(coachId);
}

/**
 * Handle GET_PLAN_WORKOUTS message from popup
 * Fetches plan workouts from TrainingPeaks API
 */
async function handleGetPlanWorkouts(
  planId: number
): Promise<ApiResponse<PlanWorkout[]>> {
  logger.debug('Handling GET_PLAN_WORKOUTS message for plan:', planId);
  return await fetchPlanWorkouts(planId);
}

/**
 * Handle GET_PLAN_NOTES message from popup
 * Fetches plan notes from TrainingPeaks API
 */
async function handleGetPlanNotes(
  planId: number
): Promise<ApiResponse<CalendarNote[]>> {
  logger.debug('Handling GET_PLAN_NOTES message for plan:', planId);
  return await fetchPlanNotes(planId);
}

/**
 * Handle GET_PLAN_EVENTS message from popup
 * Fetches plan events from TrainingPeaks API
 */
async function handleGetPlanEvents(
  planId: number
): Promise<ApiResponse<CalendarEvent[]>> {
  logger.debug('Handling GET_PLAN_EVENTS message for plan:', planId);
  return await fetchPlanEvents(planId);
}

/**
 * Handle GET_RX_BUILDER_WORKOUTS message from popup
 * Fetches RxBuilder (structured strength) workouts from TrainingPeaks API
 */
async function handleGetRxBuilderWorkouts(
  planId: number
): Promise<ApiResponse<RxBuilderWorkout[]>> {
  logger.debug('Handling GET_RX_BUILDER_WORKOUTS message for plan:', planId);
  return await fetchRxBuilderWorkouts(planId);
}

/**
 * Handle CREATE_INTERVALS_FOLDER message from popup
 * Creates a folder on Intervals.icu for library organization
 */
async function handleCreateIntervalsFolder(
  libraryName: string,
  description?: string
): Promise<ApiResponse<IntervalsFolderResponse>> {
  logger.debug('Handling CREATE_INTERVALS_FOLDER message:', libraryName);
  return await createIntervalsFolder(libraryName, description);
}

/**
 * Handle EXPORT_WORKOUTS_TO_LIBRARY message from popup
 * Exports workouts to Intervals.icu as library templates (NOT calendar events)
 */
async function handleExportWorkoutsToLibrary(
  workouts: LibraryItem[],
  folderId?: number
): Promise<ApiResponse<IntervalsWorkoutResponse[]>> {
  logger.debug('Handling EXPORT_WORKOUTS_TO_LIBRARY message');
  return await exportWorkoutsToLibrary(workouts, folderId);
}

/**
 * Handle EXPORT_TRAINING_PLAN_TO_INTERVALS message from popup
 * Creates an Intervals reusable PLAN folder and exports TP plan items.
 */
async function handleExportTrainingPlanToIntervals(
  trainingPlan: TrainingPlan,
  workouts: PlanWorkout[],
  rxWorkouts: RxBuilderWorkout[] = [],
  notes: CalendarNote[] = [],
  events: CalendarEvent[] = [],
  exportId?: string,
  existingPlanAction?: 'replace' | 'append'
): Promise<ApiResponse<IntervalsTrainingPlanExportResult>> {
  logger.debug(
    'Handling EXPORT_TRAINING_PLAN_TO_INTERVALS message for plan:',
    trainingPlan.planId,
    trainingPlan.title,
    'workouts:',
    workouts.length,
    'rxWorkouts:',
    rxWorkouts.length,
    'notes:',
    notes.length,
    'events:',
    events.length
  );
  const emitProgress = async (
    progress: TrainingPlanExportProgressPayload
  ): Promise<void> => {
    if (!exportId) {
      return;
    }

    const progressMessage: TrainingPlanExportProgressMessage = {
      type: 'TRAINING_PLAN_EXPORT_PROGRESS',
      exportId,
      progress,
    };

    try {
      await chrome.runtime.sendMessage(progressMessage);
    } catch (error) {
      // Popup may close during export; progress updates are best-effort.
      logger.debug('Training plan export progress dispatch skipped:', error);
    }
  };

  return await exportTrainingPlanToIntervalsPlan(
    trainingPlan,
    workouts,
    rxWorkouts,
    notes,
    emitProgress,
    existingPlanAction,
    events
  );
}

async function handleFindIntervalsPlanFolderByName(
  planName: string
): Promise<ApiResponse<IntervalsFolderResponse | null>> {
  logger.debug('Handling FIND_INTERVALS_PLAN_FOLDER_BY_NAME:', planName);
  return await findIntervalsPlanFolderByName(planName);
}

async function handleFindIntervalsLibraryFolderByName(
  folderName: string
): Promise<ApiResponse<IntervalsFolderResponse | null>> {
  logger.debug('Handling FIND_INTERVALS_LIBRARY_FOLDER_BY_NAME:', folderName);
  return await findIntervalsLibraryFolderByName(folderName);
}

async function handleDeleteIntervalsFolder(
  folderId: number
): Promise<ApiResponse<null>> {
  logger.debug('Handling DELETE_INTERVALS_FOLDER:', folderId);
  return await deleteIntervalsFolder(folderId);
}

/**
 * Handle SET_INTERVALS_API_KEY message from popup
 * Stores Intervals.icu API key in chrome.storage
 */
async function handleSetIntervalsApiKey(
  apiKey: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await setIntervalsApiKey(apiKey);
    return { success: true };
  } catch (error) {
    logger.error('Failed to set Intervals.icu API key:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Handle GET_INTERVALS_API_KEY message from popup
 * Retrieves Intervals.icu API key from chrome.storage
 */
async function handleGetIntervalsApiKey(): Promise<{ apiKey: string | null }> {
  const apiKey = await getIntervalsApiKey();
  return { apiKey };
}

/**
 * Handle HAS_INTERVALS_API_KEY message from popup
 * Checks if Intervals.icu API key exists in chrome.storage
 */
async function handleHasIntervalsApiKey(): Promise<{ hasKey: boolean }> {
  const hasKey = await hasIntervalsApiKey();
  return { hasKey };
}

/**
 * Handle CLEAR_INTERVALS_API_KEY message from popup
 * Removes Intervals.icu API key from chrome.storage
 */
async function handleClearIntervalsApiKey(): Promise<{ success: true }> {
  await clearIntervalsApiKey();
  return { success: true };
}

/**
 * Handle GET_DEBUG_LOGS message from popup
 * Retrieves TrainingPeaks API call logs from chrome.storage
 */
async function handleGetDebugLogs(): Promise<{ logs: ApiLogEntry[] }> {
  const logs = await getDebugLogs();
  return { logs };
}

/**
 * Handle CLEAR_DEBUG_LOGS message from popup
 * Removes all TrainingPeaks API call logs from chrome.storage
 */
async function handleClearDebugLogs(): Promise<{ success: true }> {
  await clearDebugLogs();
  return { success: true };
}

/**
 * Site-control error codes that mean "the coach is not signed in", as opposed
 * to a genuine upstream failure.
 */
const AUTH_REQUIRED_API_CODES = new Set([
  'NO_TOKEN',
  'UNAUTHORIZED',
  'INVALID_TOKEN',
]);

/**
 * Translate an internal API error into the page-facing error shape.
 *
 * Only the human-readable message crosses over; codes are mapped onto the
 * site-control vocabulary so internal error taxonomy is not leaked to the page.
 */
function toSiteControlError(error: ApiError): SiteControlError {
  return {
    code:
      AUTH_REQUIRED_API_CODES.has(error.code ?? '') ||
      isPlanMyPeakAuthErrorCode(error.code)
        ? 'AUTH_REQUIRED'
        : 'API_ERROR',
    message: error.message,
  };
}

/**
 * Adapt an `ApiResponse<T>` from an existing handler into a site-control
 * response, preserving the distinction between auth and upstream failures.
 */
function toSiteControlResponse<T>(
  requestId: string,
  response: ApiResponse<T>
): SiteControlResponse {
  if (response.success) {
    return createSuccessResponse(requestId, response.data);
  }

  return createErrorResponse(requestId, toSiteControlError(response.error));
}

/**
 * Build the PING result.
 *
 * Reports readiness only — never a token, key, or user identifier. A stored but
 * expired TrainingPeaks token counts as not authenticated, so the page does not
 * offer an import that would fail at the first request.
 */
async function buildSiteControlPingResult(): Promise<SiteControlPingResult> {
  const [trainingPeaksHasToken, trainingPeaksExpired, planMyPeakHasToken] =
    await Promise.all([
      isTrainingPeaksAuthenticated(),
      isTrainingPeaksTokenExpired(),
      isPlanMyPeakAuthenticated(),
    ]);

  return {
    protocolVersion: PLANMYPEAK_SITE_CONTROL_VERSION,
    extensionVersion: chrome.runtime.getManifest().version,
    // Reported so the page can feature-detect a request type instead of
    // maintaining a table of which extension version added what.
    supports: [...SITE_CONTROL_REQUEST_TYPES],
    trainingPeaks: {
      authenticated: trainingPeaksHasToken && !trainingPeaksExpired,
    },
    planMyPeak: {
      // Presence, not freshness: an expired credential that recovery could
      // replace must not make the page hide its import entry point.
      authenticated: planMyPeakHasToken,
      // Bounded and cached per token in the identity service, so a slow or
      // unreachable PlanMyPeak degrades to `null` rather than delaying PING
      // past the page's detection timeout. The lookup carries no recovery
      // run, so it is resolved passively: it never waits on a refresh and
      // never opens a tab, and an expired credential answers at once.
      coachId: planMyPeakHasToken ? await resolvePlanMyPeakCoachId() : null,
    },
  };
}

/**
 * Fetch the four legs of a training plan in one round trip.
 *
 * The page always needs them together, and a partially-loaded plan would render
 * as a complete one, so any failing leg fails the whole request.
 */
async function handleSiteControlPlanContents(
  requestId: string,
  planId: number
): Promise<SiteControlResponse> {
  const [workouts, notes, events, rxWorkouts] = await Promise.all([
    handleGetPlanWorkouts(planId),
    handleGetPlanNotes(planId),
    handleGetPlanEvents(planId),
    handleGetRxBuilderWorkouts(planId),
  ]);

  const failed = [workouts, notes, events, rxWorkouts].find(
    (leg) => !leg.success
  );
  if (failed && !failed.success) {
    return createErrorResponse(requestId, toSiteControlError(failed.error));
  }

  if (
    !workouts.success ||
    !notes.success ||
    !events.success ||
    !rxWorkouts.success
  ) {
    return createErrorResponse(requestId, {
      code: 'API_ERROR',
      message: 'Failed to load training plan contents',
    });
  }

  const contents: SiteControlPlanContentsResult = {
    planId,
    workouts: workouts.data,
    notes: notes.data,
    events: events.data,
    rxWorkouts: rxWorkouts.data,
  };

  return createSuccessResponse(requestId, contents);
}

/**
 * Fetch the coach's TrainingPeaks plan libraries for the page.
 *
 * Returned in TrainingPeaks' own shape, membership included, so the page groups
 * plans by the same rule the popup and the overlay do rather than by a
 * synthesised per-plan field. `TrainingPlan` stays the verbatim TrainingPeaks
 * response.
 */
async function handleSiteControlTrainingPlanLibraries(
  requestId: string
): Promise<SiteControlResponse> {
  const folders = await handleGetTrainingPlanFolders();

  if (!folders.success) {
    return createErrorResponse(requestId, toSiteControlError(folders.error));
  }

  const libraries: SiteControlTrainingPlanLibrary[] = folders.data.map(
    (folder) => ({
      id: folder.folderId,
      name: folder.folderName,
      planIds: folder.planIds,
    })
  );

  return createSuccessResponse(requestId, libraries);
}

/**
 * Fetch the libraries the page may offer, owned by the signed-in coach.
 *
 * Every surface inside the extension shows owned libraries only (`useLibraries`
 * filters on `ownerId`), and the import overlay browses that same filtered
 * list. Returning the raw TrainingPeaks response here would let the page list
 * libraries the overlay cannot show: a coach clicking one would get an importer
 * with nothing selected and no explanation, because the pre-selection silently
 * finds no match. Filtering to the same rule keeps the page's list and what the
 * importer can actually act on in agreement.
 *
 * The owner is resolved from the captured session rather than supplied by the
 * page, for the same reason `GET_ATHLETE_GROUPS` takes no coach id.
 */
async function handleSiteControlLibraries(
  requestId: string
): Promise<SiteControlResponse> {
  const [user, libraries] = await Promise.all([
    handleGetUser(),
    handleGetLibraries(),
  ]);

  if (!libraries.success) {
    return createErrorResponse(requestId, toSiteControlError(libraries.error));
  }

  if (!user.success) {
    return createErrorResponse(requestId, toSiteControlError(user.error));
  }

  const owned = libraries.data.filter(
    (library) => library.ownerId === user.data.userId
  );

  return createSuccessResponse(requestId, owned);
}

/**
 * Fetch the signed-in coach's athlete groups for the page.
 *
 * The coach id is resolved here from the captured TrainingPeaks session rather
 * than accepted from the page, so an allowlisted origin cannot read another
 * coach's groups by supplying an id.
 */
async function handleSiteControlAthleteGroups(
  requestId: string
): Promise<SiteControlResponse> {
  const user = await handleGetUser();
  if (!user.success) {
    return createErrorResponse(requestId, toSiteControlError(user.error));
  }

  return toSiteControlResponse(
    requestId,
    await handleGetAthleteGroups(user.data.userId)
  );
}

/**
 * Handle a site-control request relayed by the PlanMyPeak content-script bridge.
 *
 * The bridge already gates on origin, but this check is the one that actually
 * protects the handlers: `sender` is set by the browser and cannot be forged by
 * the page. Requests that did not come from a content script in a tab on an
 * allowlisted origin are refused before any data access.
 */
async function handleSiteControlRequest(
  message: SiteControlRequestMessage,
  sender: chrome.runtime.MessageSender
): Promise<SiteControlResponse> {
  // Re-validate the request itself: the envelope reaching the background must
  // stand on its own rather than trusting that the bridge checked it.
  const parsed = parseSiteControlRequest(message.request);
  if (parsed.outcome === 'ignore') {
    return createErrorResponse('', {
      code: 'INVALID_REQUEST',
      message: 'Malformed site-control request',
    });
  }
  if (parsed.outcome === 'error') {
    return createErrorResponse(parsed.requestId, parsed.error);
  }

  const request = parsed.request;
  const origin = sender.origin ?? originFromUrl(sender.tab?.url);

  if (!sender.tab || !isPlanMyPeakControlOrigin(origin)) {
    logger.warn('Rejected site-control request from unauthorized sender');
    return createErrorResponse(request.requestId, {
      code: 'FORBIDDEN_ORIGIN',
      message: 'Origin is not allowed to control this extension',
    });
  }

  logger.debug('Handling site-control request:', request.type);

  switch (request.type) {
    case 'PING':
      return createSuccessResponse(
        request.requestId,
        await buildSiteControlPingResult()
      );

    case 'GET_LIBRARIES':
      return await handleSiteControlLibraries(request.requestId);

    case 'GET_LIBRARY_ITEMS':
      return toSiteControlResponse(
        request.requestId,
        await handleGetLibraryItems(request.payload.libraryId)
      );

    case 'GET_TRAINING_PLANS':
      return toSiteControlResponse(
        request.requestId,
        await handleGetTrainingPlans()
      );

    case 'GET_TRAINING_PLAN_LIBRARIES':
      return await handleSiteControlTrainingPlanLibraries(request.requestId);

    case 'GET_PLAN_CONTENTS':
      return await handleSiteControlPlanContents(
        request.requestId,
        request.payload.planId
      );

    case 'GET_ATHLETE_GROUPS':
      return await handleSiteControlAthleteGroups(request.requestId);

    case 'OPEN_IMPORTER':
      // The overlay lives in the page context, so the bridge handles this
      // request without a round trip. Reaching the background means something
      // bypassed the bridge.
      return createErrorResponse(request.requestId, {
        code: 'INTERNAL_ERROR',
        message: 'OPEN_IMPORTER is handled in the page context',
      });

    // Captured-workout imports. The origin passed along is the verified
    // sender origin, so the handlers can insist the page is the destination
    // the extension is configured for — the summary must never describe
    // production captures to a staging page.
    case 'GET_CAPTURED_WORKOUT_SUMMARY':
      return await handleCapturedWorkoutSummary(request.requestId, origin);

    case 'IMPORT_MISSING_WORKOUTS':
      return await handleImportMissingWorkouts(
        request.requestId,
        request.payload,
        origin
      );

    case 'GET_CAPTURED_WORKOUT_IMPORT_STATUS':
      return await handleCapturedWorkoutImportStatus(
        request.requestId,
        request.payload,
        origin
      );
  }
}

/**
 * Main message router
 */
export async function handleMessage(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender
): Promise<MessageResponse> {
  logger.debug('Background received message:', message.type, 'from:', sender);

  switch (message.type) {
    case 'TOKEN_FOUND':
      await handleTokenFound(message.token, message.timestamp);
      return { success: true };

    case 'MY_PEAK_AUTH_FOUND':
      await handleMyPeakAuthFound(
        message.token,
        message.apiKey,
        message.timestamp,
        sender
      );
      return { success: true };

    case 'GET_TOKEN':
      return await handleGetToken();

    case 'CLEAR_TOKEN':
      await handleClearToken();
      return { success: true };

    case 'VALIDATE_TOKEN':
      return await handleValidateToken();

    case 'VALIDATE_MY_PEAK_TOKEN':
      return await handleValidateMyPeakToken();

    case 'REFRESH_PROVIDER_AUTH':
      return await handleRefreshProviderAuth(message.provider, sender);

    case 'BEGIN_PLANMYPEAK_AUTH_RUN':
      return handleBeginPlanMyPeakAuthRun(sender);

    case 'END_PLANMYPEAK_AUTH_RUN':
      handleEndPlanMyPeakAuthRun(message.authRunId);
      return { success: true };

    case 'DISCARD_STALE_MY_PEAK_TOKEN':
      await removePlanMyPeakCredentialIfStale();
      return { success: true };

    case 'GET_USER':
      return await handleGetUser();

    case 'GET_LIBRARIES':
      return await handleGetLibraries();

    case 'GET_PLANMYPEAK_LIBRARIES':
      return await handleGetPlanMyPeakLibraries(requestAuth(message));

    case 'CREATE_PLANMYPEAK_LIBRARY':
      return await handleCreatePlanMyPeakLibrary(
        message.name,
        message.description,
        requestAuth(message)
      );

    case 'DELETE_PLANMYPEAK_LIBRARY':
      return await handleDeletePlanMyPeakLibrary(
        message.libraryId,
        requestAuth(message)
      );

    case 'EXPORT_WORKOUTS_TO_PLANMYPEAK_LIBRARY':
      return await handleExportWorkoutsToPlanMyPeakLibrary(
        message.workouts,
        message.libraryId,
        message.capturedKeys,
        requestAuth(message)
      );

    case 'WORKOUT_CAPTURED':
      return await handleWorkoutCaptured(message, sender);

    case 'GET_CAPTURED_WORKOUTS':
      return await handleGetCapturedWorkouts();

    case 'UPDATE_CAPTURED_WORKOUT':
      return await handleUpdateCapturedWorkout(message);

    case 'REMOVE_CAPTURED_WORKOUTS':
      return await handleRemoveCapturedWorkouts(message.statuses);

    case 'CLAIM_CAPTURED_WORKOUTS':
      return await handleClaimCapturedWorkouts(sender);

    case 'GET_PLANMYPEAK_WORKOUTS':
      return await handleGetPlanMyPeakWorkouts(
        {
          libraryId: message.libraryId,
          provider: message.provider,
          providerWorkoutId: message.providerWorkoutId,
        },
        requestAuth(message)
      );

    case 'DELETE_PLANMYPEAK_WORKOUT':
      return await handleDeletePlanMyPeakWorkout(
        message.workoutId,
        requestAuth(message)
      );

    case 'GET_PLANMYPEAK_WORKOUT_BY_PROVIDER_ID':
      return await handleGetPlanMyPeakWorkoutByProviderId(
        message.providerWorkoutId
      );

    case 'GET_TRAINING_PLAN_FOLDERS':
      return await handleGetTrainingPlanFolders();

    case 'GET_PLANMYPEAK_PLAN_LIBRARIES':
      return await handleGetPlanMyPeakPlanLibraries(requestAuth(message));

    case 'CREATE_PLANMYPEAK_PLAN_LIBRARY':
      return await handleCreatePlanMyPeakPlanLibrary(
        message.name,
        message.description,
        requestAuth(message)
      );

    case 'UPSERT_PLANMYPEAK_PLAN':
      return await handleUpsertPlanMyPeakPlan(
        message.payload,
        requestAuth(message)
      );

    case 'UPDATE_PLANMYPEAK_PLAN':
      return await handleUpdatePlanMyPeakPlan(
        message.planId,
        message.payload,
        requestAuth(message)
      );

    case 'START_PLANMYPEAK_PLAN_IMPORT':
      return await handleStartPlanMyPeakPlanImport(
        message.planId,
        message.targetWorkoutLibraryId,
        message.abandonImportId,
        requestAuth(message)
      );

    case 'GET_PLANMYPEAK_PLAN_IMPORT':
      return await handleGetPlanMyPeakPlanImport(
        message.importId,
        requestAuth(message)
      );

    case 'ABANDON_PLANMYPEAK_PLAN_IMPORT':
      return await handleAbandonPlanMyPeakPlanImport(
        message.importId,
        requestAuth(message)
      );

    case 'GET_PLANMYPEAK_PLAN':
      return await handleGetPlanMyPeakPlan(
        message.planId,
        requestAuth(message)
      );

    case 'GET_PLANMYPEAK_PLANS':
      return await handleGetPlanMyPeakPlans(
        {
          libraryId: message.libraryId,
          provider: message.provider,
          providerPlanId: message.providerPlanId,
        },
        requestAuth(message)
      );

    case 'UPSERT_PLANMYPEAK_PLAN_ENTRY':
      return await handleUpsertPlanMyPeakPlanEntry(
        message.planId,
        message.payload,
        requestAuth(message)
      );

    case 'DELETE_PLANMYPEAK_PLAN_ENTRY':
      return await handleDeletePlanMyPeakPlanEntry(
        message.planId,
        message.entryId,
        requestAuth(message)
      );

    case 'IMPORT_ATHLETE_GROUPS_TO_PLANMYPEAK':
      return await handleImportAthleteGroupsToPlanMyPeak(message.groups);

    case 'GET_PLANMYPEAK_COACH':
      return await handleGetPlanMyPeakCoach();

    case 'GET_LIBRARY_ITEMS':
      return await handleGetLibraryItems(message.libraryId);

    case 'GET_TRAINING_PLANS':
      return await handleGetTrainingPlans();

    case 'GET_ATHLETE_GROUPS':
      return await handleGetAthleteGroups(message.coachId);

    case 'GET_PLAN_WORKOUTS':
      return await handleGetPlanWorkouts(message.planId);

    case 'GET_PLAN_NOTES':
      return await handleGetPlanNotes(message.planId);

    case 'GET_PLAN_EVENTS':
      return await handleGetPlanEvents(message.planId);

    case 'GET_RX_BUILDER_WORKOUTS':
      return await handleGetRxBuilderWorkouts(message.planId);

    case 'CREATE_INTERVALS_FOLDER':
      return await handleCreateIntervalsFolder(
        message.libraryName,
        message.description
      );

    case 'EXPORT_WORKOUTS_TO_LIBRARY':
      return await handleExportWorkoutsToLibrary(
        message.workouts,
        message.folderId
      );

    case 'EXPORT_TRAINING_PLAN_TO_INTERVALS':
      return await handleExportTrainingPlanToIntervals(
        message.trainingPlan,
        message.workouts,
        message.rxWorkouts ?? [],
        message.notes ?? [],
        message.events ?? [],
        message.exportId,
        message.existingPlanAction
      );

    case 'FIND_INTERVALS_PLAN_FOLDER_BY_NAME':
      return await handleFindIntervalsPlanFolderByName(message.planName);

    case 'FIND_INTERVALS_LIBRARY_FOLDER_BY_NAME':
      return await handleFindIntervalsLibraryFolderByName(message.folderName);

    case 'DELETE_INTERVALS_FOLDER':
      return await handleDeleteIntervalsFolder(message.folderId);

    case 'TRAINING_PLAN_EXPORT_PROGRESS':
      // Background can receive its own progress broadcasts. Ignore quietly.
      return { success: true };

    case 'SET_INTERVALS_API_KEY':
      return await handleSetIntervalsApiKey(message.apiKey);

    case 'GET_INTERVALS_API_KEY':
      return await handleGetIntervalsApiKey();

    case 'HAS_INTERVALS_API_KEY':
      return await handleHasIntervalsApiKey();

    case 'CLEAR_INTERVALS_API_KEY':
      return await handleClearIntervalsApiKey();

    case 'GET_DEBUG_LOGS':
      return await handleGetDebugLogs();

    case 'CLEAR_DEBUG_LOGS':
      return await handleClearDebugLogs();

    case 'SITE_CONTROL_REQUEST':
      return await handleSiteControlRequest(message, sender);

    default:
      logger.warn('Unknown message type received');
      return { success: false, error: 'Unknown message type' };
  }
}
