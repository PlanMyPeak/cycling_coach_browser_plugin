/**
 * UI string constants
 *
 * Centralized strings for UI components to enable consistency and easier maintenance.
 * This also prepares the codebase for potential i18n/localization in the future.
 */

import { PLANMYPEAK_HOST_LABEL } from './constants';
import { SUPPORT_EMAIL } from './errorReport';

/**
 * Connection health summary status messages
 */
export const CONNECTION_HEALTH_MESSAGES = {
  ALL_AUTHENTICATED: 'All enabled connections authenticated',
  SOME_NOT_AUTHENTICATED: 'Some enabled connections are not authenticated',
  NONE_AUTHENTICATED: 'No enabled connections authenticated',
  /**
   * Rendered as its own control rather than appended to the count, so the
   * Settings it names is somewhere the reader can actually go. Kept as a
   * separate string for that reason - re-joining it to `authenticatedCount`
   * would turn the one actionable part of this summary back into prose.
   */
  MANAGE_SETTINGS_SUFFIX: 'Manage optional providers in Settings.',
  authenticatedCount: (authenticated: number, enabled: number): string =>
    `Authenticated ${authenticated}/${enabled} enabled connections.`,
} as const;

/**
 * Settings page strings
 */
export const SETTINGS_STRINGS = {
  TITLE: 'Settings',
  SUBTITLE: 'Manage provider connections',
  TRAINING_PEAKS_REQUIRED: 'TrainingPeaks (Required)',
  TRAINING_PEAKS_DESCRIPTION:
    'This connection is mandatory for loading workouts and training plans.',
  PLANMYPEAK_OPTIONAL: 'PlanMyPeak (Optional)',
  PLANMYPEAK_DESCRIPTION:
    'Enable if you want to export directly to PlanMyPeak.',
  INTERVALS_OPTIONAL: 'Intervals.icu (Optional)',
  INTERVALS_DESCRIPTION: 'Enable if you want Intervals.icu export options.',
  CONNECTION_DISABLED:
    'Connection disabled. Enable to configure authentication.',
  ENABLED: 'Enabled',
  DISABLED: 'Disabled',
} as const;

/**
 * Auth status display strings
 */
export const AUTH_STATUS_STRINGS = {
  CHECKING: 'Checking...',
  AUTHENTICATED: 'Authenticated',
  NOT_AUTHENTICATED: 'Not Authenticated',
  CONNECTED: 'Connected',
  NOT_CONNECTED: 'Not Connected',
  VALIDATION_NEEDED: 'Validation Needed',
  ERROR: 'Error',
  TOKEN_AGE_PREFIX: 'Token',
  API_KEY_CONFIGURED: 'API key configured',
  // Provider-specific
  TRAINING_PEAKS: {
    LABEL: 'TrainingPeaks',
    OPEN_TO_CAPTURE: 'Open TrainingPeaks to capture a token',
    REQUIRED_PREFIX: 'Required connection. ',
  },
  PLANMYPEAK: {
    LABEL: 'PlanMyPeak',
    OPEN_TO_SIGN_IN: `Open ${PLANMYPEAK_HOST_LABEL} and sign in`,
    openToSignIn: (hostLabel: string): string =>
      `Open ${hostLabel} and sign in`,
    SUPABASE_SUFFIX: '(Supabase)',
  },
  INTERVALS: {
    LABEL: 'Intervals.icu',
    ADD_API_KEY: 'Add your Intervals.icu API key below.',
  },
} as const;

/**
 * Export dialog strings
 */
export const EXPORT_DIALOG_STRINGS = {
  NO_DESTINATIONS_ENABLED: 'No export destinations enabled',
  OPEN_SETTINGS_GUIDANCE:
    'Open Settings and enable PlanMyPeak and/or Intervals.icu',
} as const;

/**
 * Error boundary strings
 */
export const ERROR_BOUNDARY_STRINGS = {
  TITLE: 'Something went wrong',
  DEFAULT_MESSAGE: 'An unexpected error occurred.',
  TRY_AGAIN: 'Try again',
  SEND_REPORT: 'Copy report for email',
  REPORT_COPIED: `Report copied. Paste it into an email to ${SUPPORT_EMAIL}.`,
  REPORT_COPY_FAILED: `Could not copy the report. Please email ${SUPPORT_EMAIL}.`,
  PRIVACY_NOTICE: `The report contains limited diagnostic details. Review it and remove any personal or training information before emailing ${SUPPORT_EMAIL}.`,
} as const;

/**
 * Format token age for display
 * @param age - Token age in milliseconds
 * @returns Formatted string like "2h 30m ago" or "15m ago"
 */
export function formatTokenAge(age: number | null): string {
  if (age === null) return 'Unknown';
  const hours = Math.floor(age / (1000 * 60 * 60));
  const minutes = Math.floor((age % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) {
    return `${hours}h ${minutes}m ago`;
  }
  return `${minutes}m ago`;
}

/**
 * Build provider status label
 * @param provider - Provider name
 * @param isLoading - Whether auth check is in progress
 * @param isAuthenticated - Whether provider is authenticated
 * @param error - Error message if any
 * @param userName - Optional user name for display
 */
export function buildProviderStatusLabel(
  provider: 'TrainingPeaks' | 'PlanMyPeak' | 'Intervals.icu',
  isLoading: boolean,
  isAuthenticated: boolean,
  error: string | null,
  userName?: string
): string {
  if (isLoading) {
    return `${provider}: ${AUTH_STATUS_STRINGS.CHECKING}`;
  }
  if (error) {
    return provider === 'PlanMyPeak'
      ? `${provider}: ${AUTH_STATUS_STRINGS.VALIDATION_NEEDED}`
      : `${provider}: ${AUTH_STATUS_STRINGS.ERROR}`;
  }
  if (isAuthenticated) {
    if (provider === 'Intervals.icu') {
      return `${provider}: ${AUTH_STATUS_STRINGS.CONNECTED}`;
    }
    const displayName = userName?.trim() ?? AUTH_STATUS_STRINGS.AUTHENTICATED;
    return `${provider}: ${displayName}`;
  }
  if (provider === 'Intervals.icu') {
    return `${provider}: ${AUTH_STATUS_STRINGS.NOT_CONNECTED}`;
  }
  return `${provider}: ${AUTH_STATUS_STRINGS.NOT_AUTHENTICATED}`;
}

/**
 * Status lines for the quiet auth refresh (temporary background tab).
 * Keyed by the background's outcome, plus the in-flight state.
 */
export const AUTH_REFRESH_MESSAGES = {
  trainingpeaks: {
    refreshing: 'Refreshing TrainingPeaks sign-in in a background tab…',
    refreshed: 'TrainingPeaks sign-in refreshed.',
    sign_in_required:
      'Sign in to TrainingPeaks in the tab we opened, then try again.',
    cancelled: 'The TrainingPeaks tab was closed before sign-in was captured.',
    error: 'Could not refresh TrainingPeaks sign-in',
  },
  planmypeak: {
    refreshing: 'Refreshing PlanMyPeak sign-in in a background tab…',
    refreshed: 'PlanMyPeak sign-in refreshed.',
    sign_in_required:
      'Sign in to PlanMyPeak in the tab we opened, then try again.',
    cancelled: 'The PlanMyPeak tab was closed before sign-in was captured.',
    error: 'Could not refresh PlanMyPeak sign-in',
  },
} as const;

/**
 * PlanMyPeak authentication failures, worded by outcome.
 *
 * None of these says a sign-in tab was opened: a run that is latched or
 * cooling down opens none, and the same message is used either way. Shown in
 * the popup and — for page-driven imports — sent to the PlanMyPeak page, so
 * they must never carry a credential.
 */
export const PLANMYPEAK_AUTH_MESSAGES = {
  SIGN_IN_REQUIRED:
    'PlanMyPeak sign-in required. Sign in to PlanMyPeak, then try again.',
  ENVIRONMENT_MISMATCH:
    'The PlanMyPeak sign-in belongs to a different environment than the one selected in Settings. Sign in on the selected environment, then try again.',
  /** One shared reason for the libraries a batch did not reach. */
  STOPPED_AFTER_AUTH_FAILURE:
    'Not exported: PlanMyPeak sign-in is required. Sign in to PlanMyPeak, then export again.',
  /** The duplicate check could not run because the coach is signed out. */
  DUPLICATE_CHECK_SIGN_IN_REQUIRED:
    'Sign in to PlanMyPeak to check for existing libraries before exporting.',
  GATE_TITLE: 'PlanMyPeak sign-in required',
  GATE_ACTION: 'Sign in to PlanMyPeak',
  RECOVERING: 'Refreshing PlanMyPeak sign-in…',
} as const;
