/**
 * Export Result Component
 *
 * Displays the result of an export operation with success/error messages
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import type { ExportResult as ExportResultType } from '@/export/adapters/base';
import { ErrorReportActions } from '@/components/ErrorReportActions';
import { classifyErrorMessage } from '@/utils/errorReport';
import { PlanMyPeakSignInPrompt } from './PlanMyPeakSignInPrompt';
import { PlanImportOutcomes } from './PlanImportOutcomes';

interface ExportResultProps {
  /** Export result data */
  result: ExportResultType;
  /** Callback when user closes the result */
  onClose: () => void;
}

export function ExportResult({
  result,
  onClose,
}: ExportResultProps): ReactElement {
  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const [showAllErrors, setShowAllErrors] = useState(false);

  const displayedWarnings = showAllWarnings
    ? result.warnings
    : result.warnings.slice(0, 3);
  const allErrors = result.errors ?? [];
  const displayedErrors = showAllErrors ? allErrors : allErrors.slice(0, 5);

  const handleDownload = (): void => {
    if (result.fileUrl) {
      const link = document.createElement('a');
      link.href = result.fileUrl;
      link.download = result.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/15 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            {result.success ? (
              <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            ) : (
              <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
            )}
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {result.success ? 'Export Successful' : 'Export Failed'}
              </h2>
              <p className="text-sm text-gray-600">
                {result.success
                  ? `${result.itemsExported} workout${result.itemsExported !== 1 ? 's' : ''} exported`
                  : 'An error occurred during export'}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-3">
          {result.authFailure && (
            <PlanMyPeakSignInPrompt authFailure={result.authFailure} />
          )}
          {result.planImport && (
            <PlanImportOutcomes report={result.planImport} />
          )}
          {result.success ? (
            <>
              {/* File info */}
              <div className="bg-gray-50 rounded-md p-3">
                <div className="flex items-center gap-2 text-sm">
                  <svg
                    className="w-5 h-5 text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                    />
                  </svg>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">
                      {result.fileName}
                    </p>
                    <p className="text-xs text-gray-500">
                      {result.format.toUpperCase()} format
                    </p>
                  </div>
                </div>
              </div>

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                  <div className="flex items-start gap-2">
                    <svg
                      className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-yellow-800 mb-1">
                        {result.warnings.length} Warning
                        {result.warnings.length !== 1 ? 's' : ''}
                      </p>
                      <div
                        className={
                          showAllWarnings ? 'max-h-56 overflow-y-auto pr-1' : ''
                        }
                      >
                        <ul className="text-xs text-yellow-700 space-y-1">
                          {displayedWarnings.map((warning, index) => (
                            <li key={index}>• {warning.message}</li>
                          ))}
                        </ul>
                      </div>
                      {result.warnings.length > 3 && (
                        <button
                          type="button"
                          onClick={() =>
                            setShowAllWarnings((previous) => !previous)
                          }
                          className="mt-2 text-xs font-medium text-yellow-800 hover:text-yellow-900 underline underline-offset-2"
                        >
                          {showAllWarnings
                            ? 'Show fewer warnings'
                            : `Show all ${result.warnings.length} warnings`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Download button */}
              {result.fileUrl && (
                <button
                  onClick={handleDownload}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  <span>Download File</span>
                </button>
              )}
            </>
          ) : (
            <>
              {/* Error messages */}
              {result.errors && result.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                  <div className="flex items-start gap-2">
                    <svg
                      className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-red-800 mb-1">
                        Export Errors
                      </p>
                      <div
                        className={
                          showAllErrors ? 'max-h-56 overflow-y-auto pr-1' : ''
                        }
                      >
                        <ul className="text-xs text-red-700 space-y-1">
                          {displayedErrors.map((error, index) => (
                            <li key={index}>• {error}</li>
                          ))}
                        </ul>
                      </div>
                      {allErrors.length > 5 && (
                        <button
                          type="button"
                          onClick={() =>
                            setShowAllErrors((previous) => !previous)
                          }
                          className="mt-2 text-xs font-medium text-red-800 hover:text-red-900 underline underline-offset-2"
                        >
                          {showAllErrors
                            ? 'Show fewer errors'
                            : `Show all ${allErrors.length} errors`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <ErrorReportActions
                category="operation_failed"
                context={{
                  operation: 'export',
                  failureCode: result.authFailure
                    ? 'authentication_required'
                    : classifyErrorMessage(result.errors?.[0]),
                }}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-md font-medium hover:bg-gray-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
