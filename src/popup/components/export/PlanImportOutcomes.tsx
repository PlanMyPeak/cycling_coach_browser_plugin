/**
 * The server's verdict on a raw training-plan import: counts per outcome
 * and every item that did not import cleanly.
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import type { PlanImportReport } from '@/types/planImport.types';
import {
  planImportIssueMessage,
  planImportOutcomeLabel,
} from '@/export/adapters/planMyPeak/planImportResult';

interface PlanImportOutcomesProps {
  report: PlanImportReport;
}

/** Outcomes in display order; zero counts are not shown. */
const OUTCOME_ORDER = [
  'created',
  'updated',
  'superseded',
  'imported_without_structure',
  'skipped',
  'failed',
  'not_supported',
] as const;

const OUTCOME_TONE: Record<string, string> = {
  created: 'bg-green-100 text-green-800',
  updated: 'bg-green-100 text-green-800',
  superseded: 'bg-gray-100 text-gray-700',
  imported_without_structure: 'bg-yellow-100 text-yellow-800',
  skipped: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
  not_supported: 'bg-gray-100 text-gray-700',
};

const ISSUE_PREVIEW = 5;

export function PlanImportOutcomes({
  report,
}: PlanImportOutcomesProps): ReactElement | null {
  const [showAll, setShowAll] = useState(false);

  const counts = OUTCOME_ORDER.map((outcome) => ({
    outcome,
    count: report.outcomes[outcome],
  })).filter((entry) => entry.count > 0);

  if (counts.length === 0 && report.issues.length === 0) {
    return null;
  }

  const issues = showAll
    ? report.issues
    : report.issues.slice(0, ISSUE_PREVIEW);

  return (
    <div
      className="bg-gray-50 border border-gray-200 rounded-md p-3 space-y-2"
      data-testid="plan-import-outcomes"
    >
      <p className="text-sm font-medium text-gray-900">
        PlanMyPeak import results
      </p>
      {counts.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {counts.map(({ outcome, count }) => (
            <li
              key={outcome}
              className={`text-xs px-2 py-0.5 rounded-full ${OUTCOME_TONE[outcome] ?? 'bg-gray-100 text-gray-700'}`}
            >
              {count} {planImportOutcomeLabel(outcome).toLowerCase()}
            </li>
          ))}
        </ul>
      )}
      {report.issues.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-700 mb-1">
            {report.issues.length} item{report.issues.length !== 1 ? 's' : ''}{' '}
            need attention
          </p>
          <div className={showAll ? 'max-h-56 overflow-y-auto pr-1' : ''}>
            <ul className="text-xs text-gray-700 space-y-1">
              {issues.map((issue, index) => (
                <li key={`${issue.kind}:${issue.trainingPeaksId ?? index}`}>
                  • {planImportIssueMessage(issue)}
                </li>
              ))}
            </ul>
          </div>
          {report.issues.length > ISSUE_PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAll((previous) => !previous)}
              className="mt-2 text-xs font-medium text-gray-800 hover:text-gray-900 underline underline-offset-2"
            >
              {showAll
                ? 'Show fewer items'
                : `Show all ${report.issues.length} items`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
