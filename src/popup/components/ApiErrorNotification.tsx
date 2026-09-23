import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import type { ApiLogEntry } from '@/types/debugLog.types';
import { ErrorReportActions } from '@/components/ErrorReportActions';
import { classifyOperationName } from '@/utils/errorReport';

interface ApiErrorNotificationProps {
  error: ApiLogEntry | null;
  onViewLogs: () => void;
}

const DISMISSED_ERROR_ID_KEY = 'dismissed_api_error_id';

/** Top-level notification for the newest API failure. */
export function ApiErrorNotification({
  error,
  onViewLogs,
}: ApiErrorNotificationProps): ReactElement | null {
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    try {
      void chrome.storage.session
        .get(DISMISSED_ERROR_ID_KEY)
        .then((data) => {
          const storedId = data[DISMISSED_ERROR_ID_KEY];
          if (isMounted && typeof storedId === 'string') {
            setDismissedId(storedId);
          }
        })
        .catch(() => undefined);
    } catch {
      // In-memory dismissal remains available if session storage is blocked.
    }

    return () => {
      isMounted = false;
    };
  }, []);

  if (!error || error.id === dismissedId) {
    return null;
  }

  const dismissAndOpenLogs = (): void => {
    setDismissedId(error.id);
    try {
      void chrome.storage.session
        .set({ [DISMISSED_ERROR_ID_KEY]: error.id })
        .catch(() => undefined);
    } catch {
      // The in-memory state still dismisses the notification for this popup.
    }
    onViewLogs();
  };

  return (
    <div
      role="alert"
      className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">A request failed</p>
          <p className="mt-0.5 text-xs text-red-800">
            {error.operationName} failed. Open API Logs for details.
          </p>
        </div>
        <button
          type="button"
          onClick={dismissAndOpenLogs}
          className="shrink-0 rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
        >
          View logs
        </button>
      </div>
      <ErrorReportActions
        category="operation_failed"
        context={{ operation: classifyOperationName(error.operationName) }}
        buttonClassName="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
      />
    </div>
  );
}
