import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import {
  copyErrorReport,
  createErrorReport,
  formatErrorReport,
  type ErrorReportContext,
  type ErrorReportCategory,
} from '@/utils/errorReport';
import { ERROR_BOUNDARY_STRINGS } from '@/utils/uiStrings';

interface ErrorReportActionsProps {
  category: ErrorReportCategory;
  context?: ErrorReportContext;
  buttonClassName?: string;
}

/** User-initiated, minimal support-report actions. Logs are never included. */
export function ErrorReportActions({
  category,
  context,
  buttonClassName = 'rounded border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-800 hover:bg-red-50',
}: ErrorReportActionsProps): ReactElement {
  const operation = context?.operation;
  const failureCode = context?.failureCode;
  const report = useMemo(
    () => createErrorReport(category, { operation, failureCode }),
    [category, operation, failureCode]
  );
  const [message, setMessage] = useState<string | null>(null);
  const [manualReport, setManualReport] = useState<string | null>(null);

  const handleCopy = async (): Promise<void> => {
    const reportText = formatErrorReport(report);
    const copied = await copyErrorReport(report);
    setManualReport(copied ? null : reportText);
    setMessage(
      copied
        ? ERROR_BOUNDARY_STRINGS.REPORT_COPIED
        : ERROR_BOUNDARY_STRINGS.REPORT_COPY_FAILED
    );
  };

  return (
    <div>
      <p className="mt-2 text-[10px] text-red-700">
        {ERROR_BOUNDARY_STRINGS.PRIVACY_NOTICE}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className={buttonClassName}
        >
          {ERROR_BOUNDARY_STRINGS.SEND_REPORT}
        </button>
      </div>
      {message ? (
        <p className="mt-2 text-[10px] text-red-700" role="status">
          {message}
        </p>
      ) : null}
      {manualReport ? (
        <textarea
          aria-label="Error report for manual copying"
          readOnly
          value={manualReport}
          rows={7}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-2 w-full rounded border border-red-300 bg-white p-2 text-[10px] text-gray-800"
        />
      ) : null}
    </div>
  );
}
