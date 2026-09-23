import type { ReactElement } from 'react';
import { useState } from 'react';
import {
  copyErrorReport,
  createErrorReport,
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
  const [report] = useState(() => createErrorReport(category, context));
  const [message, setMessage] = useState<string | null>(null);

  const handleCopy = async (): Promise<void> => {
    const copied = await copyErrorReport(report);
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
    </div>
  );
}
