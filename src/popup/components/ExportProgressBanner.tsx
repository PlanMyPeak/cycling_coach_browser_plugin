/**
 * Export Progress Banner
 *
 * Displays current export progress or recent export results.
 * Shows when popup is opened during or after an export.
 */

import type { ReactElement } from 'react';
import { X as CloseIcon, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useExportProgress } from '@/hooks/useExportProgress';
import { ErrorReportActions } from '@/components/ErrorReportActions';
import { classifyErrorMessage } from '@/utils/errorReport';

export function ExportProgressBanner(): ReactElement | null {
  const { progress, isExporting, isComplete, isFailed, percentage, dismiss } =
    useExportProgress();

  if (!progress) {
    return null;
  }

  const destinationLabel =
    progress.destination === 'planmypeak' ? 'PlanMyPeak' : 'Intervals.icu';

  if (isExporting) {
    return (
      <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <div>
              <p className="text-sm font-medium text-blue-900">
                Exporting to {destinationLabel}
              </p>
              <p className="text-xs text-blue-700">
                {progress.completedItems} of {progress.totalItems} workouts
              </p>
            </div>
          </div>
        </div>
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
        <p className="mt-1.5 text-[10px] text-blue-600">
          Export continues even if you close this popup
        </p>
      </div>
    );
  }

  if (isComplete) {
    const duration = progress.completedAt
      ? Math.round((progress.completedAt - progress.startedAt) / 1000)
      : 0;

    return (
      <div className="mb-3 rounded-lg border border-green-200 bg-green-50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <div>
              <p className="text-sm font-medium text-green-900">
                Export Complete
              </p>
              <p className="text-xs text-green-700">
                {progress.successCount} workouts exported to {destinationLabel}{' '}
                in {duration}s
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void dismiss()}
            className="rounded p-0.5 text-green-600 hover:bg-green-100"
            aria-label="Dismiss"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (isFailed) {
    return (
      <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-600" />
            <div>
              <p className="text-sm font-medium text-red-900">Export Failed</p>
              <p className="text-xs text-red-700">
                {progress.error || `Failed to export to ${destinationLabel}`}
              </p>
              {progress.successCount > 0 && (
                <p className="text-xs text-red-600">
                  {progress.successCount} of {progress.totalItems} workouts were
                  exported before the error
                </p>
              )}
              <ErrorReportActions
                category="operation_failed"
                context={{
                  operation: 'export',
                  failureCode: classifyErrorMessage(progress.error),
                }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void dismiss()}
            className="rounded p-0.5 text-red-600 hover:bg-red-100"
            aria-label="Dismiss"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
