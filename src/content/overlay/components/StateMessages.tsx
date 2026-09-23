/**
 * Loading, empty, and error states shared by the overlay's browse views.
 *
 * Kept distinct from one another so an empty library never reads as a failure,
 * and a failure never renders as an empty panel.
 */

import type { ReactElement } from 'react';
import { ErrorReportActions } from '@/components/ErrorReportActions';
import { classifyErrorMessage } from '@/utils/errorReport';

export function LoadingState({ label }: { label: string }): ReactElement {
  return (
    <div
      role="status"
      className="flex items-center gap-2 px-3 py-6 text-sm text-gray-600"
    >
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
      {label}
    </div>
  );
}

export function EmptyState({ label }: { label: string }): ReactElement {
  return <p className="px-3 py-6 text-center text-sm text-gray-500">{label}</p>;
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): ReactElement {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      <p>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
      >
        Retry
      </button>
      <ErrorReportActions
        category="operation_failed"
        context={{
          operation: 'load_data',
          failureCode: classifyErrorMessage(message),
        }}
      />
    </div>
  );
}
