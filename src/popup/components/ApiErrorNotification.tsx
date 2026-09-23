import type { ReactElement } from 'react';
import { useState } from 'react';
import type { ApiLogEntry } from '@/types/debugLog.types';
import { ErrorReportActions } from '@/components/ErrorReportActions';
import { classifyOperationName } from '@/utils/errorReport';

interface ApiErrorNotificationProps {
  error: ApiLogEntry | null;
  onViewLogs: () => void;
}

/** Top-level notification for the newest API failure. */
export function ApiErrorNotification({
  error,
  onViewLogs,
}: ApiErrorNotificationProps): ReactElement | null {
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  if (!error || error.id === dismissedId) {
    return null;
  }

  const dismissAndOpenLogs = (): void => {
    setDismissedId(error.id);
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
            {classifyOperationName(error.operationName)} failed. Open API Logs
            for details.
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
