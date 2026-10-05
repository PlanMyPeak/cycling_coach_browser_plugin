/**
 * Import outcome.
 *
 * A partial failure is reported as a partial failure: the successful count is
 * shown alongside every failed item and its reason.
 */

import type { ReactElement } from 'react';
import type { OverlayImportOutcome } from '../useOverlayImport';

export interface ImportResultProps {
  outcome: OverlayImportOutcome;
  onDone: () => void;
  onBackToSelection: () => void;
}

export function ImportResult({
  outcome,
  onDone,
  onBackToSelection,
}: ImportResultProps): ReactElement {
  const failed = outcome.items.filter((item) => !item.ok);
  const withNotes = outcome.items.filter(
    (item) => item.ok && item.notes && item.notes.length > 0
  );

  return (
    <div className="space-y-3">
      <div
        role="status"
        className={
          outcome.ok
            ? 'rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900'
            : 'rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900'
        }
      >
        <p className="font-medium">
          {outcome.ok
            ? 'Import complete'
            : failed.length === outcome.items.length
              ? 'Import failed'
              : 'Import partially complete'}
        </p>
        <p className="mt-1 text-xs">
          {outcome.importedCount} workout
          {outcome.importedCount === 1 ? '' : 's'} imported
          {outcome.destinations.length > 0
            ? ` into ${outcome.destinations.join(', ')}`
            : ''}
          {failed.length > 0 ? `; ${failed.length} failed` : ''}.
        </p>
      </div>

      {withNotes.length > 0 ? (
        <div className="space-y-2 text-xs text-amber-900">
          {withNotes.map((item) => (
            <div key={item.name}>
              <p className="font-medium">{item.name}: needs attention</p>
              <ul className="mt-1 space-y-0.5 pl-3">
                {(item.notes ?? []).map((note, index) => (
                  <li key={index}>• {note}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {failed.length > 0 ? (
        <ul className="space-y-1 text-xs text-red-800">
          {failed.map((item) => (
            <li key={item.name}>
              <span className="font-medium">{item.name}</span>:{' '}
              {item.message ?? 'Unknown error'}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex justify-end gap-2">
        {failed.length > 0 ? (
          <button
            type="button"
            onClick={onBackToSelection}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Back to selection
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDone}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Done
        </button>
      </div>
    </div>
  );
}
