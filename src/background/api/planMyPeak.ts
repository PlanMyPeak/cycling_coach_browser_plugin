/**
 * PlanMyPeak API client for background service worker
 *
 * Handles authenticated requests to PlanMyPeak workout and training-plan endpoints.
 */

import { getPlanMyPeakApiUrl } from '@/services/planMyPeakConfigService';
import {
  startExport,
  updateExportItem,
  completeExport,
} from '@/services/exportProgressService';
import {
  updateCapturedWorkout,
  type CapturedWorkoutPatch,
} from '@/services/capturedWorkoutService';
import { peekCaptureContext } from '@/services/planMyPeakIdentityService';
import { refreshBadge } from '@/services/badgeService';
import { logger } from '@/utils/logger';
import {
  PlanMyPeakCoachSchema,
  PlanMyPeakCreateWorkoutResponseSchema,
  PlanMyPeakIngestAthleteGroupsResponseSchema,
  PlanMyPeakLibrariesResponseSchema,
  PlanMyPeakLibrarySchema,
  PlanMyPeakWorkoutLibraryResponseSchema,
  type PlanMyPeakCoach,
  type PlanMyPeakIngestAthleteGroupsResponse,
  type PlanMyPeakLibrary,
  type PlanMyPeakWorkoutLibraryItem,
  type PlanMyPeakWorkoutTypeValue,
  TRAINING_PEAKS_PROVIDER_CODE,
  PlanMyPeakPlanLibrariesResponseSchema,
  PlanMyPeakPlanLibrarySchema,
  PlanMyPeakPlanDetailSchema,
  PlanMyPeakPlanEntrySchema,
  PlanMyPeakPlanSummarySchema,
  PlanMyPeakPlansResponseSchema,
  type PlanMyPeakPlanDetail,
  type PlanMyPeakPlanEntry,
  type PlanMyPeakPlanLibrary,
  type PlanMyPeakPlanSummary,
} from '@/schemas/planMyPeakApi.schema';
import type { AthleteGroup } from '@/schemas/athleteGroup.schema';
import type {
  PlanMyPeakLength,
  PlanMyPeakStep,
  PlanMyPeakStructureBlock,
  PlanMyPeakWorkout,
} from '@/types/planMyPeak.types';
import type { ApiError, ApiResponse } from '@/types/api.types';
import {
  authRunTerminalReason,
  latchAuthRun,
  recoverForRun,
  reportCredentialRejected,
  resolveCredential,
  type AuthRun,
  type PlanMyPeakAuthFailureReason,
} from '@/background/api/planMyPeakAuthRecovery';
import {
  isPlanMyPeakAuthErrorCode,
  type PlanMyPeakAuthErrorCode,
} from '@/utils/planMyPeakAuthErrors';
import { PLANMYPEAK_AUTH_MESSAGES } from '@/utils/uiStrings';
import { ZodError, z } from 'zod';

// The server splits these one character apart and they are different
// resources: /workout-library returns workouts, /workout-libraries returns the
// containers holding them. Named for what they return rather than mirroring the
// URL spelling, so a transposition cannot typecheck.
const WORKOUT_ITEMS_ENDPOINT = '/backend/workout-library';
const WORKOUT_CONTAINERS_ENDPOINT = '/backend/workout-libraries';
// Plans and their containers. Three paths one word apart, so these are named
// for what they return rather than mirroring the URLs.
const PLANS_ENDPOINT = '/backend/workout-plans';
const PLAN_CONTAINERS_ENDPOINT = '/backend/workout-plan-libraries';
const ATHLETE_TAGS_INGEST_ENDPOINT =
  '/backend/athlete-tags/ingest/training-peaks';
const COACH_ME_ENDPOINT = '/backend/coaches/me';

type PlanMyPeakApiWorkoutType =
  | 'endurance'
  | 'tempo'
  | 'sweet_spot'
  | 'threshold'
  | 'vo2max'
  | 'recovery'
  | 'mixed'
  | 'easy'
  | 'interval'
  | 'long_run'
  | 'fartlek'
  | 'progression'
  | 'hill_repeats'
  | 'technique'
  | 'sprint'
  | 'strength'
  | 'hypertrophy'
  | 'power'
  | 'circuit';

type PlanMyPeakApiIntensity = 'easy' | 'moderate' | 'hard' | 'very_hard';

type PlanMyPeakApiStepIntensityClass =
  | 'warmUp'
  | 'active'
  | 'rest'
  | 'coolDown';

interface PlanMyPeakApiStepLength {
  unit:
    | 'second'
    | 'minute'
    | 'hour'
    | 'meter'
    | 'kilometer'
    | 'mile'
    | 'repetition';
  value: number;
}

interface PlanMyPeakApiStepTarget {
  type:
    | 'power'
    | 'heartrate'
    | 'pace'
    | 'cadence'
    | 'speed'
    | 'strokeRate'
    | 'resistance'
    | 'rpe';
  // Both required by the server. Optional here previously, and an `undefined`
  // drops the key from the JSON entirely, so an incomplete target reached the
  // wire as a 400.
  minValue: number;
  maxValue: number;
  unit?:
    | 'percentOfFtp'
    | 'watts'
    | 'bpm'
    | 'percentOfMaxHr'
    | 'percentOfThresholdHr'
    | 'rpm'
    | 'roundOrStridePerMinute'
    | 'secondsPerKilometer'
    | 'secondsPerMile'
    | 'secondsPer100Meters'
    | 'secondsPer100Yards'
    | 'kilometersPerHour'
    | 'milesPerHour'
    | 'kilograms'
    | 'pounds'
    | 'percentOf1RM'
    | 'scale10';
}

interface PlanMyPeakApiWorkoutStep {
  name: string;
  intensityClass: PlanMyPeakApiStepIntensityClass;
  length: PlanMyPeakApiStepLength;
  targets: PlanMyPeakApiStepTarget[];
}

interface PlanMyPeakApiWorkoutSegment {
  type: 'step' | 'repetition';
  length: {
    unit: 'repetition';
    value: number;
  };
  // Required, and the server rejects an empty array. Optional here previously,
  // which let a segment with no steps reach the wire as a 400.
  steps: PlanMyPeakApiWorkoutStep[];
}

/**
 * Body of POST /workout-library.
 *
 * The server enforces `additionalProperties: false` by *rejecting* unknown keys
 * (it used to silently strip them), so this must carry nothing extra. Duration
 * and TSS are deliberately absent: the server derives both from the structure,
 * and a second set of numbers would eventually disagree with the ones it shows.
 * Everything TrainingPeaks supplies that PlanMyPeak does not model travels in
 * `providerMetadata`.
 */
interface PlanMyPeakCreateWorkoutRequest {
  name: string;
  description?: string | null;
  workoutType: PlanMyPeakWorkoutTypeValue;
  structure: {
    primaryIntensityMetric:
      | 'percentOfFtp'
      | 'watts'
      | 'heartrate'
      | 'percentOfThresholdPace'
      | 'pace'
      | 'speed'
      | 'resistance'
      | 'rpe';
    primaryLengthMetric: 'duration' | 'distance' | 'repetitions';
    structure: PlanMyPeakApiWorkoutSegment[];
  };
  /**
   * Provider identity. Both values are required together — the server refuses
   * half an identity rather than half-storing it — and the pair is unique per
   * coach, which is what makes a re-import an update instead of a duplicate.
   */
  provider: string;
  providerWorkoutId: string;
  /**
   * Replaced wholesale on every write, never merged, so this must always be the
   * complete object. Anything omitted is dropped.
   */
  providerMetadata: Record<string, unknown> | null;
  /**
   * TrainingPeaks' planned load. Sent as a pair or not at all — PlanMyPeak
   * refuses one without the other — and only used where nothing can be derived,
   * so a power workout keeps its own figures and reports `loadSource: derived`.
   */
  providerIntensityFactor?: number;
  providerTss?: number;
  /**
   * Destination for a *new* workout. An update never moves a workout: the
   * coach's filing outranks the importer's intended destination, so a workout
   * the coach moved elsewhere stays there and the response reports where it
   * actually is. Omitted, the workout lands in the coach's default library.
   */
  libraryId?: string;
}

type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number)[];

/**
 * Build a query string, appending array values as repeated parameters.
 *
 * The repeatable filters (rideType, workoutType, durationBand) are sent as
 * `?rideType=a&rideType=b`, not comma-joined — `String(value)` on an array
 * would produce `a,b`, which the server reads as one unknown enum value.
 */
function buildQuery(params: Record<string, QueryValue>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        searchParams.append(key, String(entry));
      }
      continue;
    }
    searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return query.length > 0 ? `?${query}` : '';
}

/**
 * How a request may obtain its credential.
 *
 * Absent (or without a run) means passive: the stored credential is used if
 * it is usable, and nothing is refreshed. A run lets the request recover once
 * — see `planMyPeakAuthRecovery.ts`.
 */
export interface PlanMyPeakRequestAuth {
  run?: AuthRun | null;
}

/** Thrown when no usable credential can be obtained for a request. */
class PlanMyPeakCredentialError extends Error {
  constructor(
    readonly code: PlanMyPeakAuthErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PlanMyPeakCredentialError';
  }
}

function credentialErrorFor(
  reason: PlanMyPeakAuthFailureReason
): PlanMyPeakCredentialError {
  return reason === 'environment_mismatch'
    ? new PlanMyPeakCredentialError(
        'ENVIRONMENT_MISMATCH',
        PLANMYPEAK_AUTH_MESSAGES.ENVIRONMENT_MISMATCH
      )
    : new PlanMyPeakCredentialError(
        'NO_TOKEN',
        PLANMYPEAK_AUTH_MESSAGES.SIGN_IN_REQUIRED
      );
}

/**
 * Whether a request body can be sent a second time. Bodies are JSON strings
 * today; anything else (a stream in particular) is not retried.
 */
function isReplayableBody(body: RequestInit['body']): boolean {
  return body === undefined || body === null || typeof body === 'string';
}

/**
 * Send one request with the given credential. No policy: no credential
 * lookup, no removal, no retry.
 */
async function sendApiRequest(
  endpoint: string,
  init: RequestInit,
  token: string
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set('accept', 'application/json');
  headers.set('authorization', `Bearer ${token}`);

  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  // Use the main app API base (dynamic port for local development).
  const apiBaseUrl = await getPlanMyPeakApiUrl();

  return fetch(`${apiBaseUrl}${endpoint}`, {
    ...init,
    headers,
  });
}

/**
 * Credential policy around {@link sendApiRequest}.
 *
 * Resolves a credential (passively, or through the run's recovery), sends,
 * and on a rejection hands the removal to the credential owner. Inside a run
 * it then recovers once and re-sends through `sendApiRequest` directly — the
 * retry never re-enters this wrapper, so a second retry is impossible by
 * construction rather than by a counter.
 */
export async function makeApiRequest(
  endpoint: string,
  init: RequestInit = {},
  auth?: PlanMyPeakRequestAuth
): Promise<Response> {
  const run = auth?.run ?? null;

  // A terminal run sends nothing, even if a usable credential has since
  // appeared: the coach retries explicitly, which starts a new run.
  const terminalReason = run ? authRunTerminalReason(run) : null;
  if (terminalReason) {
    throw credentialErrorFor(terminalReason);
  }

  let token: string;
  const passive = await resolveCredential();
  if (passive.usable && passive.token !== null) {
    token = passive.token;
  } else if (run) {
    const recovered = await recoverForRun(run);
    if (!recovered.ok) {
      throw credentialErrorFor(recovered.reason);
    }
    token = recovered.token;
  } else {
    throw new Error('NO_TOKEN');
  }

  const response = await sendApiRequest(endpoint, init, token);
  if (response.status !== 401) {
    return response;
  }

  logger.warn(`[PlanMyPeak API] 401 on ${endpoint}`);
  await reportCredentialRejected(token);

  if (!run || !isReplayableBody(init.body)) {
    return response;
  }

  const recovered = await recoverForRun(run, { rejectedToken: token });
  if (!recovered.ok) {
    throw credentialErrorFor(recovered.reason);
  }

  const retried = await sendApiRequest(endpoint, init, recovered.token);
  if (retried.status === 401) {
    // Captured, then rejected: not a recovery. Latch so the rest of the run
    // does not open another tab.
    await reportCredentialRejected(recovered.token);
    latchAuthRun(run, 'sign_in_required');
  }

  return retried;
}

/**
 * The `ApiResponse` failure for an error thrown while obtaining a credential,
 * or null when `error` is something else.
 */
export function credentialFailure(
  error: unknown
): { success: false; error: ApiError } | null {
  if (error instanceof PlanMyPeakCredentialError) {
    return {
      success: false,
      error: { message: error.message, code: error.code },
    };
  }

  if (error instanceof Error && error.message === 'NO_TOKEN') {
    return {
      success: false,
      error: {
        message: PLANMYPEAK_AUTH_MESSAGES.SIGN_IN_REQUIRED,
        code: 'NO_TOKEN',
      },
    };
  }

  return null;
}

/** The failure for a non-2xx response, coding a rejection as auth. */
async function responseFailure(
  response: Response
): Promise<{ success: false; error: ApiError }> {
  const message = await parseErrorMessage(response);
  return {
    success: false,
    error:
      response.status === 401
        ? {
            message: PLANMYPEAK_AUTH_MESSAGES.SIGN_IN_REQUIRED,
            status: 401,
            code: 'UNAUTHORIZED',
          }
        : { message, status: response.status },
  };
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as {
      error?: string;
      message?: string;
    };
    return json.error || json.message || `HTTP ${response.status}`;
  } catch {
    try {
      const text = await response.text();
      return text || `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  }
}

function normalizeWorkoutType(
  type: PlanMyPeakWorkout['type']
): PlanMyPeakApiWorkoutType {
  switch (type) {
    case 'easy':
    case 'interval':
    case 'long_run':
    case 'fartlek':
    case 'progression':
    case 'hill_repeats':
    case 'technique':
    case 'sprint':
    case 'strength':
    case 'hypertrophy':
    case 'power':
    case 'vo2max':
    case 'threshold':
    case 'sweet_spot':
    case 'tempo':
    case 'endurance':
    case 'recovery':
    case 'mixed':
    case 'circuit':
      return type;
    default:
      return 'mixed';
  }
}

function normalizeWorkoutIntensity(
  intensity: PlanMyPeakWorkout['intensity']
): PlanMyPeakApiIntensity {
  if (
    intensity === 'easy' ||
    intensity === 'moderate' ||
    intensity === 'hard' ||
    intensity === 'very_hard'
  ) {
    return intensity;
  }

  return 'moderate';
}

function isLegacyBlock(value: unknown): value is PlanMyPeakStructureBlock {
  return (
    !!value &&
    typeof value === 'object' &&
    'type' in value &&
    'steps' in value &&
    Array.isArray((value as { steps?: unknown[] }).steps)
  );
}

function isLegacyStep(value: unknown): value is PlanMyPeakStep {
  return (
    !!value &&
    typeof value === 'object' &&
    'name' in value &&
    'length' in value &&
    'targets' in value
  );
}

function normalizeStepIntensityClass(
  intensityClass: PlanMyPeakStep['intensityClass']
): PlanMyPeakApiStepIntensityClass {
  switch (intensityClass) {
    case 'warmUp':
      return 'warmUp';
    case 'coolDown':
      return 'coolDown';
    case 'rest':
    case 'recovery':
      return 'rest';
    case 'active':
      return 'active';
    default:
      return 'active';
  }
}

function normalizeStepLength(
  length: PlanMyPeakLength
): PlanMyPeakApiStepLength {
  const normalizedUnit = (() => {
    switch (length.unit) {
      case 'second':
      case 'minute':
      case 'hour':
      case 'meter':
      case 'kilometer':
      case 'mile':
      case 'repetition':
        return length.unit;
      default:
        return 'second';
    }
  })();
  return {
    unit: normalizedUnit,
    value:
      typeof length.value === 'number' && Number.isFinite(length.value)
        ? Math.max(1, length.value)
        : 1,
  };
}

function normalizeTargets(
  targets: PlanMyPeakStep['targets']
): PlanMyPeakApiStepTarget[] {
  return targets.map((target) => {
    switch (target.type) {
      case 'cadence':
        return {
          type: 'cadence',
          minValue: target.minValue,
          maxValue: target.maxValue,
          unit:
            target.unit === 'roundOrStridePerMinute'
              ? 'roundOrStridePerMinute'
              : 'rpm',
        };
      case 'heartRate':
        return {
          type: 'heartrate',
          minValue: target.minValue,
          maxValue: target.maxValue,
          unit: target.unit,
        };
      case 'pace':
        return {
          type: 'pace',
          minValue: target.minValue,
          maxValue: target.maxValue,
          unit: target.unit,
        };
      case 'speed':
        return {
          type: 'speed',
          minValue: target.minValue,
          maxValue: target.maxValue,
          unit: target.unit,
        };
      case 'strokeRate':
        return {
          type: 'strokeRate',
          minValue: target.minValue,
          maxValue: target.maxValue,
          unit: target.unit,
        };
      case 'resistance':
        return {
          type: 'resistance',
          minValue: target.minValue,
          maxValue: target.maxValue,
          unit: target.unit,
        };
      case 'rpe':
        return {
          type: 'rpe',
          minValue: target.minValue,
          maxValue: target.maxValue,
          unit: 'scale10',
        };
      case 'power':
      default:
        return {
          type: 'power',
          minValue: target.minValue,
          maxValue: target.maxValue,
          unit: target.unit === 'watts' ? 'watts' : 'percentOfFtp',
        };
    }
  });
}

function flattenLegacySteps(
  steps: Array<PlanMyPeakStep | PlanMyPeakStructureBlock>
): PlanMyPeakApiWorkoutStep[] {
  const flattened: PlanMyPeakApiWorkoutStep[] = [];

  for (const step of steps) {
    if (isLegacyStep(step)) {
      flattened.push({
        name: step.name?.trim() || 'Step',
        intensityClass: normalizeStepIntensityClass(step.intensityClass),
        length: normalizeStepLength(step.length),
        targets: normalizeTargets(step.targets),
      });
      continue;
    }

    if (isLegacyBlock(step)) {
      const nested = flattenLegacySteps(step.steps);
      const repetitions =
        step.length.unit === 'repetition'
          ? Math.max(1, Math.round(step.length.value || 1))
          : 1;
      for (let i = 0; i < repetitions; i += 1) {
        flattened.push(...nested);
      }
    }
  }

  return flattened;
}

function normalizeWorkoutStructure(
  workout: PlanMyPeakWorkout
): PlanMyPeakCreateWorkoutRequest['structure'] {
  const primaryIntensityMetric = (() => {
    switch (workout.structure.primaryIntensityMetric) {
      case 'heartRate':
        return 'heartrate' as const;
      case 'watts':
      case 'percentOfThresholdPace':
      case 'pace':
      case 'speed':
      case 'resistance':
      case 'rpe':
      case 'percentOfFtp':
        return workout.structure.primaryIntensityMetric;
      default:
        return 'percentOfFtp' as const;
    }
  })();

  return {
    primaryIntensityMetric,
    primaryLengthMetric:
      workout.structure.primaryLengthMetric === 'distance'
        ? 'distance'
        : workout.structure.primaryLengthMetric === 'repetitions'
          ? 'repetitions'
          : 'duration',
    structure: workout.structure.structure.map((block) => ({
      type: block.type === 'repetition' ? 'repetition' : 'step',
      length: {
        unit: 'repetition',
        value:
          block.type === 'repetition' && block.length.unit === 'repetition'
            ? Math.max(1, Math.round(block.length.value || 1))
            : 1,
      },
      steps: flattenLegacySteps(block.steps),
    })),
  };
}

/**
 * TrainingPeaks' planned load, if it is usable.
 *
 * Returns nothing unless *both* figures are present and in range: PlanMyPeak
 * refuses one without the other, and refuses an intensity factor sent as a
 * percentage (72) where a ratio (0.72) belongs. Dropping a suspect pair costs a
 * load figure; sending it costs the whole workout a 400.
 */
function toProviderLoad(
  workout: PlanMyPeakWorkout
): { providerIntensityFactor: number; providerTss: number } | null {
  const intensityFactor = workout.provider_intensity_factor;
  const tss = workout.provider_tss;

  if (typeof intensityFactor !== 'number' || typeof tss !== 'number') {
    return null;
  }

  const intensityFactorInRange =
    Number.isFinite(intensityFactor) &&
    intensityFactor > 0 &&
    intensityFactor <= 5;
  const tssInRange = Number.isFinite(tss) && tss >= 0 && tss <= 5000;

  if (!intensityFactorInRange || !tssInRange) {
    logger.warn(
      `[PlanMyPeak API] Dropping out-of-range TrainingPeaks load for "${workout.name}" (IF ${intensityFactor}, TSS ${tss})`
    );
    return null;
  }

  return { providerIntensityFactor: intensityFactor, providerTss: tss };
}

/** Weekday names TrainingPeaks may use, to the 0-6 (Sunday = 0) PlanMyPeak wants. */
const WEEKDAY_INDEX_BY_NAME: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function normalizeSuitableWeekdays(
  weekdays: PlanMyPeakWorkout['suitable_weekdays']
): number[] | null {
  if (!Array.isArray(weekdays)) {
    return null;
  }

  const normalized = weekdays
    .map((value) => String(value).trim().toLowerCase())
    .map((value) => {
      if (value in WEEKDAY_INDEX_BY_NAME) {
        return WEEKDAY_INDEX_BY_NAME[value];
      }

      const asNumber = Number.parseInt(value, 10);
      if (Number.isFinite(asNumber) && asNumber >= 0 && asNumber <= 6) {
        return asNumber;
      }

      return null;
    })
    .filter((value): value is number => value !== null);

  return normalized.length > 0 ? normalized : null;
}

/**
 * Everything TrainingPeaks gives us that PlanMyPeak does not model.
 *
 * Always built in full, never partially: the server replaces this object
 * wholesale on every write, so an omitted key is a dropped value rather than an
 * untouched one. TrainingPeaks' own classification travels here too — PlanMyPeak
 * derives its own `rideType`, so this is a reference point rather than a
 * competing source of truth.
 */
function buildProviderMetadata(
  workout: PlanMyPeakWorkout
): Record<string, unknown> {
  return {
    // Ours, not TrainingPeaks'. TrainingPeaks supplies no training
    // classification — only a discipline id and planned IF/TSS — so these two
    // are heuristics we derive from the workout name and planned IF. Named for
    // what they are: calling them `trainingPeaks*` claimed a provenance they
    // never had, and invited PlanMyPeak to check its own classifier against our
    // guess in the belief it was checking against the provider.
    inferredWorkoutType: normalizeWorkoutType(workout.type),
    inferredIntensity: normalizeWorkoutIntensity(workout.intensity),
    suitablePhases: Array.isArray(workout.suitable_phases)
      ? workout.suitable_phases
      : [],
    suitableWeekdays: normalizeSuitableWeekdays(workout.suitable_weekdays),
    variableComponents: workout.variable_components ?? null,
    isPublic: false,
    // Recorded rather than used: our note detection reads this field, and its
    // real vocabulary is undocumented, so storing what TrainingPeaks actually
    // sent turns an untested mapping into something any import can answer.
    exerciseLibraryItemType: workout.provider_item_type,
  };
}

/**
 * Build the create/upsert body for one workout.
 *
 * `providerWorkoutId` is the TrainingPeaks library item id, deliberately not a
 * hash of the structure: a hash changes when a coach edits the workout upstream,
 * which would create a second record instead of updating the existing one — the
 * opposite of what provider identity is for.
 */
function toCreateWorkoutRequest(
  workout: PlanMyPeakWorkout,
  libraryId: string
): PlanMyPeakCreateWorkoutRequest {
  return {
    name: workout.name,
    description: workout.detailed_description ?? null,
    workoutType: workout.discipline,
    structure: normalizeWorkoutStructure(workout),
    provider: TRAINING_PEAKS_PROVIDER_CODE,
    providerWorkoutId: workout.provider_workout_id,
    providerMetadata: buildProviderMetadata(workout),
    ...toProviderLoad(workout),
    libraryId,
  };
}

async function apiRequest<T>(
  endpoint: string,
  schema: z.ZodSchema<T>,
  operationName: string,
  init?: RequestInit,
  extras: {
    /** Filled with the response status on success, for callers that need it. */
    statusOut?: { status: number };
    auth?: PlanMyPeakRequestAuth;
  } = {}
): Promise<ApiResponse<T>> {
  try {
    logger.debug(`[PlanMyPeak API] ${operationName}`);

    const response = await makeApiRequest(endpoint, init, extras.auth);

    if (extras.statusOut) {
      extras.statusOut.status = response.status;
    }

    if (!response.ok) {
      return await responseFailure(response);
    }

    const json = await response.json();
    const validated = schema.parse(json);

    return { success: true, data: validated };
  } catch (error) {
    const authFailure = credentialFailure(error);
    if (authFailure) {
      return authFailure;
    }

    if (error instanceof ZodError) {
      logger.error('[PlanMyPeak API] Response validation failed:', error);
      const firstIssue = error.issues[0];
      const issuePath =
        firstIssue && firstIssue.path.length > 0
          ? firstIssue.path.join('.')
          : 'response';
      const issueMessage = firstIssue?.message || 'Unknown validation error';
      return {
        success: false,
        error: {
          message: `Response validation failed (${issuePath}: ${issueMessage})`,
          code: 'VALIDATION_ERROR',
        },
      };
    }

    logger.error(`[PlanMyPeak API] ${operationName} failed:`, error);
    return {
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * Like {@link apiRequest}, but also reports the HTTP status.
 *
 * The workout upsert answers 201 when it stored a new workout and 200 when it
 * updated one that already carried the same provider identity. The bodies are
 * identical, so the status is the only thing that distinguishes them and callers
 * that need to report created-vs-updated have to see it.
 */
async function apiRequestWithStatus<T>(
  endpoint: string,
  schema: z.ZodSchema<T>,
  operationName: string,
  init?: RequestInit,
  auth?: PlanMyPeakRequestAuth
): Promise<ApiResponse<{ value: T; status: number }>> {
  const captured: { status: number } = { status: 0 };
  const result = await apiRequest(endpoint, schema, operationName, init, {
    statusOut: captured,
    auth,
  });

  if (!result.success) {
    return result;
  }

  return {
    success: true,
    data: { value: result.data, status: captured.status },
  };
}

/**
 * Fetch PlanMyPeak workout libraries
 */
export async function fetchPlanMyPeakLibraries(
  auth?: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakLibrary[]>> {
  const result = await apiRequest(
    WORKOUT_CONTAINERS_ENDPOINT,
    PlanMyPeakLibrariesResponseSchema,
    'Fetching PlanMyPeak libraries',
    undefined,
    { auth }
  );

  if (!result.success) {
    return result;
  }

  return {
    success: true,
    data: result.data.data,
  };
}

/**
 * Largest page the list endpoint allows.
 *
 * The default is 25, which is not enough: reconciling a library has to see every
 * workout in it, and silently working from the first page would leave stale
 * workouts behind while reporting success.
 */
const WORKOUT_PAGE_SIZE = 100;

/** Guard against paging forever if `total` and the returned rows disagree. */
const MAX_WORKOUT_PAGES = 200;

/**
 * Fetch PlanMyPeak workouts, optionally filtered, following pagination to the end.
 *
 * A filter that matches nothing is a 200 with an empty list, never a 404, so an
 * empty result means "not there" rather than "something went wrong".
 */
export async function fetchPlanMyPeakWorkouts(
  filters?: {
    libraryId?: string;
    provider?: string;
    providerWorkoutId?: string;
  },
  auth?: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakWorkoutLibraryItem[]>> {
  const collected: PlanMyPeakWorkoutLibraryItem[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_WORKOUT_PAGES; page++) {
    const query = buildQuery({
      libraryId: filters?.libraryId,
      provider: filters?.provider,
      providerWorkoutId: filters?.providerWorkoutId,
      limit: WORKOUT_PAGE_SIZE,
      offset,
    });

    const result = await apiRequest(
      `${WORKOUT_ITEMS_ENDPOINT}${query}`,
      PlanMyPeakWorkoutLibraryResponseSchema,
      `Fetching PlanMyPeak workouts${query}`,
      undefined,
      { auth }
    );

    if (!result.success) {
      return result;
    }

    collected.push(...result.data.data);

    const total = result.data.pagination.total;
    if (result.data.data.length === 0 || collected.length >= total) {
      break;
    }

    offset += WORKOUT_PAGE_SIZE;
  }

  return {
    success: true,
    data: collected,
  };
}

/**
 * Find one workout by its TrainingPeaks id, anywhere in the coach's library.
 *
 * Deliberately not scoped to a library. Provider identity is unique per *coach*,
 * which is what lets a coach move an imported workout and keep it — so scoping
 * the lookup by library would miss exactly the workouts that had been moved and
 * report them as new.
 *
 * Rarely needed: POST is itself an upsert, so an importer does not have to look
 * before it writes. Kept for callers that want to know what exists first.
 */
export async function fetchPlanMyPeakWorkoutByProviderId(
  providerWorkoutId: string
): Promise<ApiResponse<PlanMyPeakWorkoutLibraryItem | null>> {
  const trimmedId = providerWorkoutId.trim();
  if (!trimmedId) {
    return {
      success: false,
      error: {
        message: 'providerWorkoutId is required',
        code: 'VALIDATION_ERROR',
      },
    };
  }

  const result = await fetchPlanMyPeakWorkouts({
    provider: TRAINING_PEAKS_PROVIDER_CODE,
    providerWorkoutId: trimmedId,
  });

  if (!result.success) {
    return result;
  }

  const match = result.data.find(
    (workout) =>
      workout.provider === TRAINING_PEAKS_PROVIDER_CODE &&
      workout.providerWorkoutId === trimmedId
  );
  return { success: true, data: match ?? null };
}

/**
 * Create a PlanMyPeak workout library (container).
 *
 * There is no way to create one from the PlanMyPeak web app yet, so if an import
 * wants a named destination that does not exist, we create it here.
 */
export async function createPlanMyPeakLibrary(
  name: string,
  description?: string | null,
  auth?: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakLibrary>> {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return {
      success: false,
      error: {
        message: 'Library name is required',
        code: 'VALIDATION_ERROR',
      },
    };
  }

  return apiRequest(
    WORKOUT_CONTAINERS_ENDPOINT,
    PlanMyPeakLibrarySchema,
    `Creating PlanMyPeak library "${trimmedName}"`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: trimmedName,
        description: description?.trim() || null,
      }),
    },
    { auth }
  );
}

/**
 * Fetch the authenticated PlanMyPeak coach profile, including the linked
 * TrainingPeaks account (externalIds). Used to warn when the signed-in
 * TrainingPeaks user differs from the PlanMyPeak coach's linked account.
 */
export async function fetchPlanMyPeakCoach(
  init?: RequestInit
): Promise<ApiResponse<PlanMyPeakCoach>> {
  return apiRequest(
    COACH_ME_ENDPOINT,
    PlanMyPeakCoachSchema,
    'Fetching PlanMyPeak coach profile',
    init
  );
}

/**
 * Import (ingest) TrainingPeaks athlete groups into PlanMyPeak.
 *
 * Forwards the raw TrainingPeaks groups payload verbatim to the coach-authenticated
 * ingest endpoint, which associates athletes to PlanMyPeak athlete tags.
 */
export async function ingestTrainingPeaksAthleteGroups(
  groups: AthleteGroup[]
): Promise<ApiResponse<PlanMyPeakIngestAthleteGroupsResponse>> {
  if (!Array.isArray(groups) || groups.length === 0) {
    return {
      success: false,
      error: {
        message: 'No athlete groups to import',
        code: 'VALIDATION_ERROR',
      },
    };
  }

  return apiRequest(
    ATHLETE_TAGS_INGEST_ENDPOINT,
    PlanMyPeakIngestAthleteGroupsResponseSchema,
    `Importing ${groups.length} TrainingPeaks athlete group(s) into PlanMyPeak`,
    {
      method: 'POST',
      body: JSON.stringify({ groups }),
    }
  );
}

/**
 * Delete a PlanMyPeak workout library
 */
export async function deletePlanMyPeakLibrary(
  libraryId: string,
  auth?: PlanMyPeakRequestAuth
): Promise<ApiResponse<null>> {
  const trimmedLibraryId = libraryId.trim();

  if (!trimmedLibraryId) {
    return {
      success: false,
      error: {
        message: 'Library id is required',
        code: 'VALIDATION_ERROR',
      },
    };
  }

  try {
    logger.debug(`[PlanMyPeak API] Deleting library ${trimmedLibraryId}`);

    const response = await makeApiRequest(
      `${WORKOUT_CONTAINERS_ENDPOINT}/${encodeURIComponent(trimmedLibraryId)}`,
      {
        method: 'DELETE',
      },
      auth
    );

    if (response.status === 204 || response.status === 200) {
      return { success: true, data: null };
    }

    return await responseFailure(response);
  } catch (error) {
    const authFailure = credentialFailure(error);
    if (authFailure) {
      return authFailure;
    }

    logger.error('[PlanMyPeak API] Delete library failed:', error);
    return {
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * Delete one workout from the coach's library.
 *
 * A 409 here means a training plan still schedules the workout; the server
 * refuses rather than orphaning the plan entry. Callers reconciling a library
 * should collect these and report them rather than treating them as fatal.
 */
export async function deletePlanMyPeakWorkout(
  workoutId: string,
  auth?: PlanMyPeakRequestAuth
): Promise<ApiResponse<null>> {
  const trimmedId = workoutId.trim();

  if (!trimmedId) {
    return {
      success: false,
      error: {
        message: 'Workout id is required',
        code: 'VALIDATION_ERROR',
      },
    };
  }

  try {
    const response = await makeApiRequest(
      `${WORKOUT_ITEMS_ENDPOINT}/${encodeURIComponent(trimmedId)}`,
      { method: 'DELETE' },
      auth
    );

    if (response.status === 204 || response.status === 200) {
      return { success: true, data: null };
    }

    return await responseFailure(response);
  } catch (error) {
    const authFailure = credentialFailure(error);
    if (authFailure) {
      return authFailure;
    }

    logger.error('[PlanMyPeak API] Delete workout failed:', error);
    return {
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * Body of POST /workout-plans. Also used for PATCH, which is sparse.
 *
 * `weekCount` may not be shortened below the highest scheduled week — that is a
 * 409 from the service, which the schema cannot see. Shorten a plan *after*
 * removing the entries that would be stranded.
 */
export interface PlanMyPeakCreatePlanRequest {
  name: string;
  description?: string | null;
  weekCount: number;
  libraryId?: string;
  provider?: string;
  providerPlanId?: string;
  providerMetadata?: Record<string, unknown> | null;
}

/**
 * Body of POST /workout-plans/:planId/entries.
 *
 * `note` is deliberately never sent by the importer: an omitted note is kept on
 * an identity-matched write, and we have no note to offer, so saying nothing is
 * how a coach's own note survives a re-import.
 */
export interface PlanMyPeakCreatePlanEntryRequest {
  workoutId: string;
  weekNumber: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  dayOfWeek: number;
  position?: number;
  provider?: string;
  providerEntryId?: string;
}

/** Outcome of an upsert: the record, and whether it was newly created. */
export interface PlanMyPeakUpsertResult<T> {
  value: T;
  created: boolean;
}

/** List the coach's training-plan libraries, creating their default if needed. */
export async function fetchPlanMyPeakPlanLibraries(
  auth?: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakPlanLibrary[]>> {
  const result = await apiRequest(
    PLAN_CONTAINERS_ENDPOINT,
    PlanMyPeakPlanLibrariesResponseSchema,
    'Fetching PlanMyPeak plan libraries',
    undefined,
    { auth }
  );

  if (!result.success) {
    return result;
  }

  return { success: true, data: result.data.data };
}

/** Create a training-plan library. */
export async function createPlanMyPeakPlanLibrary(
  name: string,
  description?: string | null,
  auth?: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakPlanLibrary>> {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return {
      success: false,
      error: {
        message: 'Plan library name is required',
        code: 'VALIDATION_ERROR',
      },
    };
  }

  return apiRequest(
    PLAN_CONTAINERS_ENDPOINT,
    PlanMyPeakPlanLibrarySchema,
    `Creating PlanMyPeak plan library "${trimmedName}"`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: trimmedName,
        description: description?.trim() || null,
      }),
    },
    { auth }
  );
}

/**
 * Create or update a training plan.
 *
 * POST is the upsert: a plan carrying a provider identity this coach already
 * holds is updated and answers 200 rather than 201. An update never re-files the
 * plan, so `libraryId` is ignored on that path and the response reports the
 * library it is actually in.
 */
export async function upsertPlanMyPeakPlan(
  payload: PlanMyPeakCreatePlanRequest,
  auth?: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakUpsertResult<PlanMyPeakPlanSummary>>> {
  const result = await apiRequestWithStatus(
    PLANS_ENDPOINT,
    PlanMyPeakPlanSummarySchema,
    `Upserting PlanMyPeak training plan "${payload.name}"`,
    { method: 'POST', body: JSON.stringify(payload) },
    auth
  );

  if (!result.success) {
    return result;
  }

  return {
    success: true,
    data: { value: result.data.value, created: result.data.status === 201 },
  };
}

/** Shorten or rename a plan. Shortening below the highest scheduled week is a 409. */
export async function updatePlanMyPeakPlan(
  planId: string,
  payload: Partial<PlanMyPeakCreatePlanRequest>,
  auth?: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakPlanSummary>> {
  return apiRequest(
    `${PLANS_ENDPOINT}/${encodeURIComponent(planId)}`,
    PlanMyPeakPlanSummarySchema,
    `Updating PlanMyPeak training plan ${planId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    { auth }
  );
}

/** Read a plan with its full schedule, for reconciling against a source. */
export async function fetchPlanMyPeakPlan(
  planId: string,
  auth?: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakPlanDetail>> {
  return apiRequest(
    `${PLANS_ENDPOINT}/${encodeURIComponent(planId)}`,
    PlanMyPeakPlanDetailSchema,
    `Fetching PlanMyPeak training plan ${planId}`,
    undefined,
    { auth }
  );
}

/** Find plans, optionally by provider identity. A miss is an empty list. */
export async function fetchPlanMyPeakPlans(
  filters?: {
    libraryId?: string;
    provider?: string;
    providerPlanId?: string;
  },
  auth?: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakPlanSummary[]>> {
  const query = buildQuery({
    libraryId: filters?.libraryId,
    provider: filters?.provider,
    providerPlanId: filters?.providerPlanId,
  });

  const result = await apiRequest(
    `${PLANS_ENDPOINT}${query}`,
    PlanMyPeakPlansResponseSchema,
    `Fetching PlanMyPeak training plans${query}`,
    undefined,
    { auth }
  );

  if (!result.success) {
    return result;
  }

  return { success: true, data: result.data.data };
}

/**
 * Schedule or move one session in a plan.
 *
 * 201 means newly scheduled, 200 means an entry with this identity moved. The
 * bodies are identical, so the status is the only signal.
 */
export async function upsertPlanMyPeakPlanEntry(
  planId: string,
  payload: PlanMyPeakCreatePlanEntryRequest,
  auth?: PlanMyPeakRequestAuth
): Promise<ApiResponse<PlanMyPeakUpsertResult<PlanMyPeakPlanEntry>>> {
  const result = await apiRequestWithStatus(
    `${PLANS_ENDPOINT}/${encodeURIComponent(planId)}/entries`,
    PlanMyPeakPlanEntrySchema,
    `Scheduling PlanMyPeak plan entry in ${planId}`,
    { method: 'POST', body: JSON.stringify(payload) },
    auth
  );

  if (!result.success) {
    return result;
  }

  return {
    success: true,
    data: { value: result.data.value, created: result.data.status === 201 },
  };
}

/** Remove one scheduled session. */
export async function deletePlanMyPeakPlanEntry(
  planId: string,
  entryId: string,
  auth?: PlanMyPeakRequestAuth
): Promise<ApiResponse<null>> {
  try {
    const response = await makeApiRequest(
      `${PLANS_ENDPOINT}/${encodeURIComponent(planId)}/entries/${encodeURIComponent(entryId)}`,
      { method: 'DELETE' },
      auth
    );

    if (response.status === 204 || response.status === 200) {
      return { success: true, data: null };
    }

    return await responseFailure(response);
  } catch (error) {
    const authFailure = credentialFailure(error);
    if (authFailure) {
      return authFailure;
    }

    logger.error('[PlanMyPeak API] Delete plan entry failed:', error);
    return {
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/** What happened to one workout in an upload. */
export interface PlanMyPeakWorkoutUploadResult {
  workout: PlanMyPeakWorkoutLibraryItem;
  /** True when the workout was newly stored (201), false when updated (200). */
  created: boolean;
  /**
   * True when the server filed the workout somewhere other than the library we
   * asked for. Normal, not an error: an update never moves a workout, because
   * the coach's filing outranks the importer's intended destination.
   */
  filedElsewhere: boolean;
}

/** Outcome of uploading a set of workouts to one destination. */
export interface PlanMyPeakUploadSummary {
  results: PlanMyPeakWorkoutUploadResult[];
  createdCount: number;
  updatedCount: number;
  /**
   * True when nothing landed in the requested destination, which happens when
   * every workout already existed and lives in another library. The destination
   * is then an empty library we created for nothing — worth telling the user
   * about, and worth offering to clean up, rather than leaving unexplained.
   */
  destinationEmpty: boolean;
  /** Workouts that could not be uploaded, in submission order. */
  failures: PlanMyPeakUploadFailure[];
}

/** One workout that could not be uploaded, identified by provider id. */
export interface PlanMyPeakUploadFailure {
  providerWorkoutId: string;
  name: string;
  message: string;
  /** Machine-readable cause; set for authentication failures. */
  code?: string;
}

/**
 * True when the upload loop ran and nothing landed: every workout failed.
 * `success: false` from the upload is reserved for the cases where no upload
 * was attempted at all (for example a missing library id), so callers that
 * need to surface "everything failed" as a failure check this instead.
 */
export function isTotalUploadFailure(
  summary: PlanMyPeakUploadSummary
): boolean {
  return summary.results.length === 0 && summary.failures.length > 0;
}

/** What the upload loop reports about one workout, as soon as its POST returns. */
export interface PlanMyPeakUploadItemResult {
  providerWorkoutId: string;
  name: string;
  success: boolean;
  /** Set on success: newly stored (201) or updated in place (200). */
  created?: boolean;
  /** Set on failure. */
  error?: string;
  /** Machine-readable cause of a failure; set for authentication failures. */
  code?: string;
}

/**
 * Upload transformed workouts to a PlanMyPeak library.
 *
 * POST is an upsert: a workout carrying a provider identity this coach already
 * holds is updated in place rather than duplicated, and answers 200 instead of
 * 201. Uploads continue past a failure so one bad workout cannot hide the
 * outcome of the rest; every failure is collected and reported.
 */
export async function exportWorkoutsToPlanMyPeakLibrary(
  workouts: PlanMyPeakWorkout[],
  libraryId: string,
  options?: {
    targetName?: string;
    sourceName?: string;
    trackProgress?: boolean;
    /**
     * Captured-workout record key by `provider_workout_id`. Each keyed
     * workout's outcome is written to its record right after its POST, before
     * the next upload starts, so a popup that closes mid-send loses nothing.
     */
    capturedKeys?: Record<string, string>;
    /**
     * Told about each workout right after its POST, before the next begins.
     * For callers that persist progress of their own (a page-driven import).
     */
    onItemResult?: (result: PlanMyPeakUploadItemResult) => Promise<void> | void;
    /**
     * Asked before every POST whether the run may continue. A refusal stops
     * the loop: the remaining workouts are reported as failures carrying the
     * given reason, and nothing more is written.
     */
    shouldContinue?: () => Promise<
      { ok: true } | { ok: false; reason: string }
    >;
    /** Credential policy for every upload; absent means passive. */
    auth?: PlanMyPeakRequestAuth;
  }
): Promise<ApiResponse<PlanMyPeakUploadSummary>> {
  const trimmedLibraryId = libraryId.trim();
  const trackProgress = options?.trackProgress ?? true;
  const capturedKeys = options?.capturedKeys ?? {};
  let touchedCapturedRecords = false;

  // A captured workout that lands is acknowledged for the destination and
  // coach it landed in, so the page for that destination stops counting it.
  // Read once per run from the identity cache, never the network: unknown
  // means the record is still marked sent (the older, coarser signal) and the
  // next reconciliation acknowledges it as already present.
  const acknowledgementContext =
    Object.keys(capturedKeys).length > 0 ? await peekCaptureContext() : null;

  if (!trimmedLibraryId) {
    return {
      success: false,
      error: {
        message: 'PlanMyPeak library id is required',
        code: 'VALIDATION_ERROR',
      },
    };
  }

  let exportState: { exportId: string } | null = null;
  if (trackProgress && workouts.length > 0) {
    exportState = await startExport({
      destination: 'planmypeak',
      sourceName: options?.sourceName ?? 'TrainingPeaks Library',
      targetName: options?.targetName ?? 'PlanMyPeak Library',
      totalItems: workouts.length,
      items: workouts.map((w) => w.name),
    });
  }

  const results: PlanMyPeakWorkoutUploadResult[] = [];
  const failures: PlanMyPeakUploadFailure[] = [];

  // Once refused, every remaining workout is a failure with the same reason.
  // An authentication failure stops the loop the same way: the credential is
  // gone for the rest of the batch, so the remaining uploads would only repeat
  // it — and inside a recovery run they must not ask for another tab.
  let stopReason: string | null = null;
  let stopCode: string | undefined;

  for (let i = 0; i < workouts.length; i++) {
    const workout = workouts[i];
    const requestBody = toCreateWorkoutRequest(workout, trimmedLibraryId);
    const capturedKey = Object.prototype.hasOwnProperty.call(
      capturedKeys,
      workout.provider_workout_id
    )
      ? capturedKeys[workout.provider_workout_id]
      : undefined;

    if (stopReason === null && options?.shouldContinue) {
      const verdict = await options.shouldContinue();
      if (!verdict.ok) {
        stopReason = verdict.reason;
      }
    }

    if (stopReason !== null) {
      failures.push({
        providerWorkoutId: workout.provider_workout_id,
        name: workout.name,
        message: stopReason,
        ...(stopCode ? { code: stopCode } : {}),
      });
      if (capturedKey) {
        touchedCapturedRecords = true;
        await updateCapturedWorkout(capturedKey, { lastSendError: stopReason });
      }
      if (exportState) {
        await updateExportItem({
          exportId: exportState.exportId,
          itemIndex: i,
          itemName: workout.name,
          success: false,
          error: stopReason,
        });
      }
      await options?.onItemResult?.({
        providerWorkoutId: workout.provider_workout_id,
        name: workout.name,
        success: false,
        error: stopReason,
        ...(stopCode ? { code: stopCode } : {}),
      });
      continue;
    }

    const result = await apiRequestWithStatus(
      WORKOUT_ITEMS_ENDPOINT,
      PlanMyPeakCreateWorkoutResponseSchema,
      `Uploading PlanMyPeak workout "${workout.name}"`,
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      },
      options?.auth
    );

    if (!result.success) {
      const code = isPlanMyPeakAuthErrorCode(result.error.code)
        ? result.error.code
        : undefined;
      if (code) {
        stopReason = result.error.message;
        stopCode = code;
      }

      failures.push({
        providerWorkoutId: workout.provider_workout_id,
        name: workout.name,
        message: result.error.message,
        ...(code ? { code } : {}),
      });

      if (capturedKey) {
        touchedCapturedRecords = true;
        await updateCapturedWorkout(capturedKey, {
          lastSendError: result.error.message,
        });
      }

      if (exportState) {
        await updateExportItem({
          exportId: exportState.exportId,
          itemIndex: i,
          itemName: workout.name,
          success: false,
          error: result.error.message,
        });
      }
      await options?.onItemResult?.({
        providerWorkoutId: workout.provider_workout_id,
        name: workout.name,
        success: false,
        error: result.error.message,
        ...(code ? { code } : {}),
      });
      continue;
    }

    const uploaded = result.data.value;
    const created = result.data.status === 201;
    results.push({
      workout: uploaded,
      created,
      filedElsewhere: uploaded.library.id !== trimmedLibraryId,
    });

    if (capturedKey) {
      touchedCapturedRecords = true;
      const patch: CapturedWorkoutPatch = {
        status: 'sent',
        planMyPeakWorkoutId: uploaded.id,
        planMyPeakLibraryName: uploaded.library.name,
        sentAt: Date.now(),
      };
      if (acknowledgementContext) {
        patch.acknowledge = {
          coachId: acknowledgementContext.coachId,
          destination: acknowledgementContext.destination,
          reason: 'imported',
          planMyPeakWorkoutId: uploaded.id,
          libraryName: uploaded.library.name,
        };
      }
      await updateCapturedWorkout(capturedKey, patch);
    }

    if (exportState) {
      await updateExportItem({
        exportId: exportState.exportId,
        itemIndex: i,
        itemName: workout.name,
        success: true,
      });
    }
    await options?.onItemResult?.({
      providerWorkoutId: workout.provider_workout_id,
      name: workout.name,
      success: true,
      created,
    });
  }

  if (exportState) {
    await completeExport({
      exportId: exportState.exportId,
      success: failures.length === 0,
      error:
        failures.length > 0
          ? `${failures.length} of ${workouts.length} workout(s) failed to upload`
          : undefined,
    });
  }

  if (touchedCapturedRecords) {
    // The export badge keeps priority while it lingers; the owner recomputes
    // the pending count once it clears.
    await refreshBadge();
  }

  // Every failure is reported through the summary, even when nothing landed:
  // the caller needs each keyed failure to say which workouts did not make it,
  // and `isTotalUploadFailure` tells it whether to treat the whole run as one.
  const createdCount = results.filter((entry) => entry.created).length;

  return {
    success: true,
    data: {
      results,
      createdCount,
      updatedCount: results.length - createdCount,
      destinationEmpty:
        results.length > 0 && results.every((entry) => entry.filedElsewhere),
      failures,
    },
  };
}

/**
 * Create a training plan template.
 */
