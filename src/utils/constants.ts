/**
 * Application constants
 *
 * Centralized configuration values
 */

/**
 * TrainingPeaks environment (production vs sandbox).
 * Switchable at runtime via the Settings panel; stored in chrome.storage.
 */
export type TrainingPeaksEnvironment = 'production' | 'sandbox';

export interface TrainingPeaksEnvironmentConfig {
  apiBaseUrl: string;
  appUrl: string;
  rxApiBaseUrl: string;
}

export const TRAININGPEAKS_ENVIRONMENTS: Record<
  TrainingPeaksEnvironment,
  TrainingPeaksEnvironmentConfig
> = {
  production: {
    apiBaseUrl: 'https://tpapi.trainingpeaks.com',
    appUrl: 'https://app.trainingpeaks.com',
    rxApiBaseUrl: 'https://api.peakswaresb.com',
  },
  sandbox: {
    apiBaseUrl: 'https://tpapi.sandbox.trainingpeaks.com',
    appUrl: 'https://app.sandbox.trainingpeaks.com',
    rxApiBaseUrl: 'https://api.uat.peakswaresb.com',
  },
};

export const DEFAULT_TRAININGPEAKS_ENVIRONMENT: TrainingPeaksEnvironment =
  'production';

export function isTrainingPeaksEnvironment(
  value: string | undefined
): value is TrainingPeaksEnvironment {
  return value === 'production' || value === 'sandbox';
}

const TRAININGPEAKS_ENVIRONMENT_NAMES: readonly TrainingPeaksEnvironment[] = [
  'production',
  'sandbox',
];

/**
 * Which TrainingPeaks environment serves the web app at `origin`, or null when
 * the origin is not a TrainingPeaks app origin. Exact match only, so a
 * lookalike such as `https://app.trainingpeaks.com.evil.test` is rejected.
 */
export function trainingPeaksEnvironmentForAppOrigin(
  origin: string | null | undefined
): TrainingPeaksEnvironment | null {
  if (!origin) {
    return null;
  }

  return (
    TRAININGPEAKS_ENVIRONMENT_NAMES.find(
      (environment) => TRAININGPEAKS_ENVIRONMENTS[environment].appUrl === origin
    ) ?? null
  );
}

/**
 * Which TrainingPeaks environment serves the API at `origin`, or null when the
 * origin is not a TrainingPeaks API origin. Exact match only.
 */
export function trainingPeaksEnvironmentForApiOrigin(
  origin: string | null | undefined
): TrainingPeaksEnvironment | null {
  if (!origin) {
    return null;
  }

  return (
    TRAININGPEAKS_ENVIRONMENT_NAMES.find(
      (environment) =>
        TRAININGPEAKS_ENVIRONMENTS[environment].apiBaseUrl === origin
    ) ?? null
  );
}

/**
 * TrainingPeaks API base URL (production default).
 * Prefer the environment-aware helpers in trainingPeaksConfigService for
 * runtime calls; this constant remains the production fallback.
 */
export const API_BASE_URL = TRAININGPEAKS_ENVIRONMENTS.production.apiBaseUrl;

/**
 * Build mode flags exposed by Vite.
 * Use these instead of guessing based on the current hostname.
 */
export const IS_DEVELOPMENT = import.meta.env.DEV;

/**
 * Explicit PlanMyPeak host target.
 * This can override the default behavior so local-target bundles can be built.
 */
export type PlanMyPeakTarget = 'local' | 'production';

function isPlanMyPeakTarget(
  value: string | undefined
): value is PlanMyPeakTarget {
  return value === 'local' || value === 'production';
}

export function resolvePlanMyPeakTarget(
  configuredTarget: string | undefined,
  isDevelopment: boolean
): PlanMyPeakTarget {
  if (isPlanMyPeakTarget(configuredTarget)) {
    return configuredTarget;
  }

  return isDevelopment ? 'local' : 'production';
}

/**
 * Active PlanMyPeak host target.
 * Defaults to local in Vite dev mode and production for built bundles.
 */
export const PLANMYPEAK_TARGET = resolvePlanMyPeakTarget(
  import.meta.env.VITE_PLANMYPEAK_TARGET,
  IS_DEVELOPMENT
);

/**
 * Whether the current PlanMyPeak target is a local development host.
 */
export const IS_LOCAL_PLANMYPEAK_TARGET = PLANMYPEAK_TARGET === 'local';

/**
 * Default ports for local PlanMyPeak development.
 * These can be overridden via chrome.storage in local builds.
 * Any TCP port is accepted: local-target builds request localhost and
 * 127.0.0.1 without a port in the manifest, which matches every port.
 * Note: the app runs over https locally; Supabase runs over http.
 */
export const DEFAULT_PLANMYPEAK_APP_PORT = 3002;
export const DEFAULT_PLANMYPEAK_SUPABASE_PORT = 54341;

/**
 * Whether a value is a usable TCP port number.
 */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Parse a user-entered port string, returning null when it is not a port.
 *
 * Rejects anything that is not purely digits so values such as `3002abc`,
 * which `parseInt` would happily read as `3002`, do not slip through.
 */
export function parsePort(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const port = Number(value.trim());
  return isValidPort(port) ? port : null;
}

/**
 * PlanMyPeak production origin.
 */
export const PLANMYPEAK_PRODUCTION_ORIGIN = 'https://portal.planmypeak.com';

/**
 * PlanMyPeak staging origin.
 *
 * Staging is a first-party PlanMyPeak deployment used for QA. It is always a
 * permitted host and site-control origin, so any build can be pointed at it
 * from Settings without a rebuild; which deployment the extension actually
 * talks to is the runtime selection below.
 */
export const PLANMYPEAK_STAGING_ORIGIN = 'https://staging.app.planmypeak.com';

/**
 * PlanMyPeak environment (which deployment the extension talks to).
 *
 * Switchable at runtime via the Settings panel and stored in chrome.storage.
 * `local` is only selectable in local-target builds, which are the only ones
 * whose manifest carries loopback host permissions.
 */
export type PlanMyPeakEnvironment = 'production' | 'staging' | 'local';

export interface PlanMyPeakEnvironmentConfig {
  /** Web app base URL. The local port is resolved at runtime from storage. */
  appUrl: string;
  /** Short host label for UI copy. */
  hostLabel: string;
  /** Display name used by the environment selector. */
  label: string;
}

export const PLANMYPEAK_ENVIRONMENTS: Record<
  PlanMyPeakEnvironment,
  PlanMyPeakEnvironmentConfig
> = {
  production: {
    appUrl: PLANMYPEAK_PRODUCTION_ORIGIN,
    hostLabel: 'portal.planmypeak.com',
    label: 'Production',
  },
  staging: {
    appUrl: PLANMYPEAK_STAGING_ORIGIN,
    hostLabel: 'staging.app.planmypeak.com',
    label: 'Staging',
  },
  local: {
    appUrl: `https://localhost:${DEFAULT_PLANMYPEAK_APP_PORT}`,
    hostLabel: `localhost:${DEFAULT_PLANMYPEAK_APP_PORT}`,
    label: 'Local',
  },
};

export function isPlanMyPeakEnvironment(
  value: string | undefined
): value is PlanMyPeakEnvironment {
  return value === 'production' || value === 'staging' || value === 'local';
}

/**
 * Environment used until the user picks one: the local app in local-target
 * builds, the portal everywhere else.
 */
export const DEFAULT_PLANMYPEAK_ENVIRONMENT: PlanMyPeakEnvironment =
  IS_LOCAL_PLANMYPEAK_TARGET ? 'local' : 'production';

/**
 * Environments this build can actually reach.
 *
 * `local` is omitted from production bundles because their manifest has no
 * loopback host permissions or content-script matches, so selecting it would
 * silently break auth capture and the site-control channel.
 */
export const AVAILABLE_PLANMYPEAK_ENVIRONMENTS: readonly PlanMyPeakEnvironment[] =
  IS_LOCAL_PLANMYPEAK_TARGET
    ? ['local', 'staging', 'production']
    : ['production', 'staging'];

/**
 * Whether an environment can be selected in this build.
 * Guards stored values too: a bundle rebuilt for production must not keep
 * running against a `local` selection left in storage by a local build.
 */
export function isAvailablePlanMyPeakEnvironment(
  value: string | undefined
): value is PlanMyPeakEnvironment {
  return (
    isPlanMyPeakEnvironment(value) &&
    AVAILABLE_PLANMYPEAK_ENVIRONMENTS.includes(value)
  );
}

/**
 * PlanMyPeak app URL for the build's default environment (local uses the
 * default port). Prefer the runtime helpers in planMyPeakConfigService, which
 * honour the selected environment and configured port.
 */
export const PLANMYPEAK_APP_URL =
  PLANMYPEAK_ENVIRONMENTS[DEFAULT_PLANMYPEAK_ENVIRONMENT].appUrl;

/**
 * Short PlanMyPeak host label for the build's default environment.
 */
export const PLANMYPEAK_HOST_LABEL =
  PLANMYPEAK_ENVIRONMENTS[DEFAULT_PLANMYPEAK_ENVIRONMENT].hostLabel;

/**
 * Loopback hosts a local-target build serves PlanMyPeak from.
 *
 * The port is deliberately not part of this list: the dev app port is
 * user-configurable, so any port on these hosts is accepted. That mirrors the
 * content-script matches vite injects for local-target builds, which are
 * port-less and therefore match every port (see vite.config.ts). Schemes vary
 * by setup — 3002 is served over https locally, other ports over http — so
 * both are allowed.
 */
const LOCAL_PLANMYPEAK_HOSTS: readonly string[] = ['localhost', '127.0.0.1'];

/**
 * Origins allowed to drive the extension through the site-control channel.
 *
 * Every build allows the two first-party PlanMyPeak deployments — the portal
 * and staging — regardless of which one is currently selected in Settings, so
 * switching environments needs no rebuild. Local-target builds additionally
 * accept any port on {@link LOCAL_PLANMYPEAK_HOSTS}, which this list cannot
 * enumerate — use {@link isPlanMyPeakControlOrigin} for the actual gate. The
 * default local origin is listed so the value stays useful for display and for
 * callers that want a representative example.
 */
export const PLANMYPEAK_CONTROL_ORIGINS: readonly string[] =
  IS_LOCAL_PLANMYPEAK_TARGET
    ? [
        PLANMYPEAK_PRODUCTION_ORIGIN,
        PLANMYPEAK_STAGING_ORIGIN,
        `https://localhost:${DEFAULT_PLANMYPEAK_APP_PORT}`,
        `https://127.0.0.1:${DEFAULT_PLANMYPEAK_APP_PORT}`,
      ]
    : [PLANMYPEAK_PRODUCTION_ORIGIN, PLANMYPEAK_STAGING_ORIGIN];

/**
 * Whether an origin is a loopback dev origin this build may be driven from.
 *
 * Only ever true in local-target builds. The hostname is compared exactly, so
 * lookalikes such as `https://localhost.evil.test` are rejected; only the port
 * is left open, because the dev port is configurable at runtime.
 */
function isLocalPlanMyPeakControlOrigin(origin: string): boolean {
  if (!IS_LOCAL_PLANMYPEAK_TARGET) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  // `new URL` tolerates a path, but an origin must not carry one.
  if (origin !== url.origin) {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  return LOCAL_PLANMYPEAK_HOSTS.includes(url.hostname);
}

/**
 * Exact-match check for a site-control origin.
 *
 * Matching is exact by design: substring or suffix matching would accept
 * lookalikes such as `https://portal.planmypeak.com.evil.test`. Loopback dev
 * origins are the one relaxation, and only in local-target builds, where the
 * port is configurable — see {@link isLocalPlanMyPeakControlOrigin}.
 */
export function isPlanMyPeakControlOrigin(
  origin: string | null | undefined
): boolean {
  if (!origin) {
    return false;
  }

  return (
    PLANMYPEAK_CONTROL_ORIGINS.includes(origin) ||
    isLocalPlanMyPeakControlOrigin(origin)
  );
}

/**
 * The Supabase project host the production portal authenticates against. A
 * request observed there carries a production credential.
 */
const PLANMYPEAK_PRODUCTION_SUPABASE_ORIGIN =
  'https://nwvtltfibnkdogdeeluh.supabase.co';

/**
 * Which PlanMyPeak environment an observed credential belongs to, from the
 * origin it was observed on, or null when the origin maps to none.
 *
 * Exact match for the portal and staging, so a lookalike such as
 * `https://portal.planmypeak.com.evil.test` maps to nothing. In local-target
 * builds any loopback port maps to `local`, mirroring
 * {@link isLocalPlanMyPeakControlOrigin}.
 */
export function planMyPeakEnvironmentForAppOrigin(
  origin: string | null | undefined
): PlanMyPeakEnvironment | null {
  if (!origin) {
    return null;
  }

  if (
    origin === PLANMYPEAK_PRODUCTION_ORIGIN ||
    origin === PLANMYPEAK_PRODUCTION_SUPABASE_ORIGIN
  ) {
    return 'production';
  }

  if (origin === PLANMYPEAK_STAGING_ORIGIN) {
    return 'staging';
  }

  if (isLocalPlanMyPeakControlOrigin(origin)) {
    return 'local';
  }

  return null;
}

/**
 * Resolve a URL to its origin, returning null for values that are not valid
 * absolute URLs. Used to derive an origin from `sender.tab.url`.
 */
export function originFromUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * PlanMyPeak auth validation base URL (uses default port, actual port may be configured in local builds).
 * Development hits the local Supabase instance directly.
 * Production validates via the Supabase cloud instance the rewritten portal authenticates against.
 * Not environment-aware: token validation goes through the app's own
 * `/api/backend/coaches/me`, so no Supabase host is needed for staging.
 */
export const PLANMYPEAK_AUTH_BASE_URL = IS_LOCAL_PLANMYPEAK_TARGET
  ? `http://localhost:${DEFAULT_PLANMYPEAK_SUPABASE_PORT}`
  : PLANMYPEAK_PRODUCTION_SUPABASE_ORIGIN;

/**
 * PlanMyPeak Supabase anon (publishable) key, used as the `apikey` header when
 * validating a captured user token against Supabase `/auth/v1/user`.
 *
 * The rewritten portal restores its session from localStorage and routes data
 * through its own `/api/backend`, so the anon key is (almost) never emitted on
 * intercepted traffic. This is the public, static publishable key baked into
 * the production portal browser build, so embedding it here is equivalent to
 * what the web app already ships. Local builds fall back to the anon key
 * captured from intercepted local Supabase traffic.
 */
export const PLANMYPEAK_SUPABASE_ANON_KEY = IS_LOCAL_PLANMYPEAK_TARGET
  ? ''
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53dnRsdGZpYm5rZG9nZGVlbHVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMTE3ODgsImV4cCI6MjA5NzY4Nzc4OH0.WqJxwP_OTwbFjo_n1yJWENpy3Xq5xOVzqQ9YcACRr54';

/**
 * PlanMyPeak API base URL.
 */
export const PLANMYPEAK_API_BASE_URL = `${PLANMYPEAK_APP_URL}/api`;

/**
 * Backward-compatible aliases used across the codebase.
 */
export const MYPEAK_APP_URL = PLANMYPEAK_APP_URL;
export const MYPEAK_SUPABASE_URL = PLANMYPEAK_AUTH_BASE_URL;

/**
 * TrainingPeaks RxBuilder (structured strength) API base URL (production
 * default). Uses a different domain from the classic API. Prefer
 * getTrainingPeaksRxApiBaseUrl() so sandbox requests hit the UAT host.
 */
export const RX_API_BASE_URL =
  TRAININGPEAKS_ENVIRONMENTS.production.rxApiBaseUrl;

/**
 * Intervals.icu API base URL
 */
export const INTERVALS_API_BASE = 'https://intervals.icu/api/v1';

/**
 * Token expiration threshold (24 hours in milliseconds)
 */
export const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Extension display name
 */
export const EXTENSION_NAME = 'PlanMyPeak Importer';

/**
 * Storage keys
 */
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'auth_token',
  TOKEN_TIMESTAMP: 'token_timestamp',
  TRAININGPEAKS_API_LOGS: 'trainingpeaks_api_logs',
  MYPEAK_AUTH_TOKEN: 'mypeak_auth_token',
  MYPEAK_TOKEN_TIMESTAMP: 'mypeak_token_timestamp',
  /**
   * PlanMyPeak environment the stored credential was observed on, or
   * `unknown` when its origin mapped to none. Absent for credentials stored
   * before environments were recorded; those stay usable.
   */
  MYPEAK_TOKEN_ENVIRONMENT: 'mypeak_token_environment',
  MYPEAK_SUPABASE_API_KEY: 'mypeak_supabase_api_key',
  INTERVALS_API_KEY: 'intervals_api_key',
  CONNECTION_ENABLE_PLANMYPEAK: 'connection_enable_planmypeak',
  CONNECTION_ENABLE_INTERVALS: 'connection_enable_intervals',
  PLANMYPEAK_APP_PORT: 'planmypeak_app_port',
  PLANMYPEAK_SUPABASE_PORT: 'planmypeak_supabase_port',
  PLANMYPEAK_ENVIRONMENT: 'planmypeak_environment',
  TRAININGPEAKS_ENVIRONMENT: 'trainingpeaks_environment',
  /**
   * Map of workouts captured from TrainingPeaks calendar writes, keyed by
   * `environment:athleteId:workoutId`. Written only by the background worker
   * through capturedWorkoutService; the popup reads it and sends messages.
   */
  CAPTURED_WORKOUTS: 'captured_workouts',
  /**
   * Monotonic counter bumped on every write to `captured_workouts` and to
   * `captured_import_operations`. Reported to PlanMyPeak pages so they can tell
   * that something changed between two polls without being told what.
   */
  CAPTURED_WORKOUTS_REVISION: 'captured_workouts_revision',
  /**
   * Captured-workout import operations, keyed by context id. Holds only the
   * active and the latest finished operation per context. Written only by the
   * background worker through capturedImportOperations.
   */
  CAPTURED_IMPORT_OPERATIONS: 'captured_import_operations',
  /**
   * Raw training-plan imports in flight, keyed `environment:planId`. Holds
   * the client operation id so a retry after a lost response reuses it, and
   * the server's import id so a closed popup can poll the same import.
   * Written only by the background worker through planImportOperationService.
   */
  PLAN_IMPORT_OPERATIONS: 'planmypeak_plan_import_operations',
} as const;

/**
 * Date range constants for training plan API endpoints
 * These dates represent the widest possible range supported by the API
 */
export const PLAN_DATE_RANGE = {
  START_DATE: '2010-12-15',
  END_DATE: '2038-09-13',
} as const;

/**
 * React Query cache durations (in milliseconds)
 * Controls how long data remains fresh before refetching
 */
export const CACHE_DURATIONS = {
  USER: 5 * 60 * 1000, // 5 minutes - user profile rarely changes
  LIBRARIES: 10 * 60 * 1000, // 10 minutes - library list is relatively static
  LIBRARY_ITEMS: 3 * 60 * 1000, // 3 minutes - library items may be edited
  TRAINING_PLANS: 10 * 60 * 1000, // 10 minutes - plan list rarely changes
  PLAN_WORKOUTS: 3 * 60 * 1000, // 3 minutes - workouts may be modified
  PLAN_NOTES: 3 * 60 * 1000, // 3 minutes - notes may be edited
  PLAN_EVENTS: 3 * 60 * 1000, // 3 minutes - events may change
  RX_BUILDER_WORKOUTS: 3 * 60 * 1000, // 3 minutes - strength workouts may be modified
  ATHLETE_GROUPS: 5 * 60 * 1000, // 5 minutes - athlete groups change infrequently
} as const;

/**
 * Create headers for TrainingPeaks API requests
 *
 * Headers match exactly what TrainingPeaks web app sends for authentication.
 * Some headers (sec-*) are automatically added by the browser.
 *
 * @param token - Bearer token for authentication
 * @returns Headers object for fetch requests
 */
export function createApiHeaders(
  token: string,
  appOrigin: string = TRAININGPEAKS_ENVIRONMENTS.production.appUrl
): Record<string, string> {
  return {
    accept: 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    origin: appOrigin,
    referer: `${appOrigin}/`,
    // Note: sec-fetch-* headers are automatically added by Chrome
    // Note: user-agent is a forbidden header and cannot be set by extensions
  };
}
