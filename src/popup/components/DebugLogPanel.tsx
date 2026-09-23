/**
 * Debug Log Panel component
 *
 * Displays TrainingPeaks API call history for troubleshooting.
 * Collapsible panel with refresh, export, and clear functionality.
 */

import type { ReactElement } from 'react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useDebugLogs } from '@/hooks/useDebugLogs';
import type { ApiLogEntry, ApiLogsExport } from '@/types/debugLog.types';

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Props for single log entry component
 */
interface LogEntryRowProps {
  log: ApiLogEntry;
}

/**
 * Single log entry row
 */
function LogEntryRow({ log }: LogEntryRowProps): ReactElement {
  const baseClasses = 'rounded border p-2 text-xs';
  const colorClasses = log.success
    ? 'bg-green-50 border-green-200 text-green-800'
    : 'bg-red-50 border-red-200 text-red-800';

  return (
    <div className={`${baseClasses} ${colorClasses}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {/* Status icon */}
          <span className="text-sm" aria-hidden="true">
            {log.success ? '\u2713' : '\u2717'}
          </span>
          {/* Operation name and endpoint */}
          <div>
            <span className="font-medium">{log.operationName}</span>
            <span className="ml-1 text-[10px] opacity-70">{log.endpoint}</span>
          </div>
        </div>
        {/* Timestamp */}
        <span className="shrink-0 text-[10px] opacity-70">
          {formatTimestamp(log.timestamp)}
        </span>
      </div>

      {/* Details row */}
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
        <span>{formatDuration(log.durationMs)}</span>
        {log.status !== null && <span>HTTP {log.status}</span>}
        {log.errorCode && (
          <span className="rounded bg-red-100 px-1 py-0.5 font-mono">
            {log.errorCode}
          </span>
        )}
      </div>

      {/* Error message if present */}
      {log.errorMessage && !log.success && (
        <div className="mt-1 text-[10px] italic opacity-80">
          {log.errorMessage}
        </div>
      )}

      {log.validationPath && !log.success && (
        <div className="mt-1 text-[10px]">
          Path: <span className="font-mono">{log.validationPath}</span>
        </div>
      )}

      {log.validationInput && !log.success && (
        <div className="mt-1 text-[10px] break-all">
          Input: <span className="font-mono">{log.validationInput}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Download helper for JSON export
 */
function downloadJson(data: ApiLogsExport, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Debug Log Panel component
 *
 * Collapsible panel showing API call history with controls
 * for refreshing, exporting, and clearing logs.
 */
export function DebugLogPanel({
  initialExpanded = false,
}: {
  initialExpanded?: boolean;
}): ReactElement {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialExpanded) {
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [initialExpanded]);
  const { logs, isLoading, refetch, clearLogs, isClearingLogs } =
    useDebugLogs();

  const handleExport = useCallback(() => {
    // Get extension version from manifest
    let extensionVersion = 'unknown';
    try {
      const manifest = chrome.runtime.getManifest();
      extensionVersion = manifest.version;
    } catch {
      // Fallback if manifest unavailable
    }

    const exportData: ApiLogsExport = {
      exportedAt: new Date().toISOString(),
      extensionVersion,
      logCount: logs.length,
      logs,
    };

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    downloadJson(exportData, `trainingpeaks-api-logs-${timestamp}.json`);
  }, [logs]);

  const handleClear = useCallback(() => {
    if (logs.length === 0) return;
    clearLogs();
  }, [logs.length, clearLogs]);

  const logCount = logs.length;

  return (
    <div
      ref={panelRef}
      id="api-logs-panel"
      className="rounded-lg border border-gray-200 bg-white"
    >
      {/* Header - always visible */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between p-3 text-left hover:bg-gray-50"
        aria-expanded={isExpanded}
        aria-controls="debug-log-content"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">API Logs</span>
          {logCount > 0 && (
            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-700">
              {logCount}
            </span>
          )}
        </div>
        {/* Chevron */}
        <svg
          className={`h-4 w-4 text-gray-500 transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div id="debug-log-content" className="border-t border-gray-200 p-3">
          {/* Control buttons */}
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isLoading}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? 'Loading...' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={logCount === 0}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Export JSON
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={isClearingLogs || logCount === 0}
              className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isClearingLogs ? 'Clearing...' : 'Clear'}
            </button>
          </div>

          {/* Log list */}
          {logCount === 0 ? (
            <p className="py-4 text-center text-xs text-gray-500">
              No API calls logged yet. Logs will appear here after data is
              loaded.
            </p>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {logs.map((log) => (
                <LogEntryRow key={log.id} log={log} />
              ))}
            </div>
          )}

          {/* Help text */}
          <p className="mt-2 text-[10px] text-gray-500">
            Logs show TrainingPeaks API calls. Exported logs automatically
            redact detected credentials and tokens before sharing.
          </p>
        </div>
      )}
    </div>
  );
}
