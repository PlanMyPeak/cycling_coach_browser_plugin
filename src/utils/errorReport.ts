/**
 * Builds the intentionally small, user-reviewable support report.
 *
 * This must not consume raw exception text or API logs: those can contain
 * private training data even after credentials have been redacted.
 */

export const SUPPORT_EMAIL = 'support@planmypeak.com';

export type ErrorReportCategory = 'ui_error' | 'operation_failed';
export type ErrorReportOperation =
  | 'unknown_operation'
  | 'api_request'
  | 'export'
  | 'load_data'
  | 'trainingpeaks_libraries'
  | 'trainingpeaks_library_items'
  | 'trainingpeaks_athlete_groups'
  | 'trainingpeaks_training_plans';
export type ErrorReportFailureCode =
  | 'network_request_failed'
  | 'authentication_required'
  | 'permission_denied'
  | 'validation_failed'
  | 'operation_failed'
  | 'unexpected_error';

export interface ErrorReportContext {
  operation?: ErrorReportOperation;
  failureCode?: ErrorReportFailureCode;
}

export interface ErrorReport {
  category: ErrorReportCategory;
  operation: ErrorReportOperation;
  failureCode: ErrorReportFailureCode;
  referenceId: string;
  extensionVersion: string;
  browser: string;
  platform: string;
  timestamp: string;
}

function getExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return 'unknown';
  }
}

function createReferenceId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  } catch {
    return `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`.toUpperCase();
  }
}

function getBrowserMetadata(): { browser: string; platform: string } {
  try {
    // User-agent data is limited to browser/platform metadata and is capped
    // so it cannot become an accidental dump of arbitrary page data.
    return {
      browser:
        typeof navigator.userAgent === 'string'
          ? navigator.userAgent.slice(0, 160)
          : 'unknown',
      platform:
        typeof navigator.platform === 'string'
          ? navigator.platform.slice(0, 80)
          : 'unknown',
    };
  } catch {
    return { browser: 'unknown', platform: 'unknown' };
  }
}

export function createErrorReport(
  category: ErrorReportCategory = 'ui_error',
  context: ErrorReportContext = {}
): ErrorReport {
  const metadata = getBrowserMetadata();

  return {
    category,
    operation: context.operation ?? 'unknown_operation',
    failureCode: context.failureCode ?? 'unexpected_error',
    referenceId: createReferenceId(),
    extensionVersion: getExtensionVersion(),
    ...metadata,
    timestamp: new Date().toISOString(),
  };
}

export function formatErrorReport(report: ErrorReport): string {
  return [
    'PlanMyPeak Browser Extension error report',
    '',
    `Error category: ${report.category}`,
    `Operation: ${report.operation}`,
    `Failure code: ${report.failureCode}`,
    `Reference ID: ${report.referenceId}`,
    `Extension version: ${report.extensionVersion}`,
    `Browser: ${report.browser}`,
    `Platform: ${report.platform}`,
    `Timestamp: ${report.timestamp}`,
    '',
    'What happened? (Please describe the problem here)',
    '',
    'Privacy note: Please review this draft and remove any personal, account, or training information before sending.',
  ].join('\n');
}

/** Map user-visible failure text to a finite, non-sensitive support code. */
export function classifyErrorMessage(
  message: string | undefined
): ErrorReportFailureCode {
  const normalized = message?.toLowerCase() ?? '';

  if (
    normalized.includes('401') ||
    normalized.includes('no_token') ||
    normalized.includes('authent') ||
    normalized.includes('unauthorized') ||
    normalized.includes('sign-in') ||
    normalized.includes('authentication')
  ) {
    return 'authentication_required';
  }
  if (normalized.includes('403') || normalized.includes('forbidden')) {
    return 'permission_denied';
  }
  if (normalized.includes('validation') || normalized.includes('schema')) {
    return 'validation_failed';
  }
  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('network') ||
    normalized.includes('timeout') ||
    normalized.includes('fetch')
  ) {
    return 'network_request_failed';
  }
  if (message) {
    return 'operation_failed';
  }
  return 'unexpected_error';
}

/** Classify the combined safe fields available on an API log entry. */
export function classifyApiLogFailure(
  errorCode: string | undefined,
  status: number | null,
  errorMessage: string | undefined
): ErrorReportFailureCode {
  return classifyErrorMessage(
    [errorCode, status === null ? undefined : String(status), errorMessage]
      .filter(Boolean)
      .join(' ')
  );
}

/** Convert dynamic API operation names into a finite, non-sensitive code. */
export function classifyOperationName(
  operationName: string | undefined
): ErrorReportOperation {
  const normalized = operationName?.toLowerCase() ?? '';

  if (normalized.includes('athlete groups')) {
    return 'trainingpeaks_athlete_groups';
  }
  if (normalized.startsWith('library ') && normalized.includes(' items')) {
    return 'trainingpeaks_library_items';
  }
  if (normalized === 'libraries' || normalized.includes(' libraries')) {
    return 'trainingpeaks_libraries';
  }
  if (
    normalized === 'training plans' ||
    normalized.includes('training plans')
  ) {
    return 'trainingpeaks_training_plans';
  }
  if (normalized.includes('export')) {
    return 'export';
  }
  if (normalized) {
    return 'api_request';
  }
  return 'unknown_operation';
}

export async function copyErrorReport(report: ErrorReport): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(formatErrorReport(report));
    return true;
  } catch {
    return false;
  }
}
