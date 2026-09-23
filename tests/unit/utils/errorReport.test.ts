import { describe, expect, it, vi } from 'vitest';
import {
  classifyErrorMessage,
  classifyOperationName,
  createErrorReport,
  formatErrorReport,
} from '@/utils/errorReport';

describe('error report', () => {
  it('creates a minimal report without accepting raw error text', () => {
    vi.stubGlobal('chrome', {
      runtime: {
        getManifest: () => ({ version: '1.2.3' }),
      },
    });

    const report = createErrorReport('operation_failed');
    const text = formatErrorReport(report);

    expect(report.extensionVersion).toBe('1.2.3');
    expect(report.category).toBe('operation_failed');
    expect(report.operation).toBe('unknown_operation');
    expect(report.referenceId).toMatch(/^[A-Z0-9]+$/);
    expect(text).toContain('What happened? (Please describe the problem here)');
    expect(text).toContain('Failure code: unexpected_error');
    expect(text).not.toContain('error.message');
    expect(text).not.toContain('Authorization');
  });

  it('maps visible failures to safe diagnostic codes', () => {
    expect(classifyErrorMessage('Failed to fetch')).toBe(
      'network_request_failed'
    );
    expect(classifyErrorMessage('HTTP 401 Unauthorized')).toBe(
      'authentication_required'
    );
    expect(classifyErrorMessage('NO_TOKEN')).toBe('authentication_required');
    expect(classifyErrorMessage('HTTP 403 Forbidden')).toBe(
      'permission_denied'
    );
    expect(classifyErrorMessage('VALIDATION_ERROR')).toBe('validation_failed');
    expect(classifyErrorMessage('Workout title and URL')).toBe(
      'operation_failed'
    );
  });

  it('maps dynamic operation names to safe operation codes', () => {
    expect(classifyOperationName('coach 1234567 athlete groups')).toBe(
      'trainingpeaks_athlete_groups'
    );
    expect(classifyOperationName('library 456 items')).toBe(
      'trainingpeaks_library_items'
    );
  });

  it('formats safe report context without dynamic identifiers', () => {
    const report = {
      category: 'ui_error' as const,
      operation: 'trainingpeaks_library_items' as const,
      failureCode: 'network_request_failed' as const,
      referenceId: 'ABC123',
      extensionVersion: '1.2.3',
      browser: 'Test Browser',
      platform: 'Test OS',
      timestamp: '2026-09-23T00:00:00.000Z',
    };

    const text = formatErrorReport(report);

    expect(text).toContain('Operation: trainingpeaks_library_items');
    expect(text).toContain('Browser: Test Browser');
    expect(text).not.toContain('456');
  });
});
