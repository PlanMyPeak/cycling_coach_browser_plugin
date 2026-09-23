import { describe, expect, it, vi } from 'vitest';
import {
  buildSupportMailto,
  classifyErrorMessage,
  createErrorReport,
  formatErrorReport,
  SUPPORT_EMAIL,
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
    expect(classifyErrorMessage('Workout title and URL')).toBe(
      'operation_failed'
    );
  });

  it('opens a URL-encoded draft to the private support address', () => {
    const report = {
      category: 'ui_error' as const,
      operation: 'export',
      failureCode: 'network_request_failed' as const,
      referenceId: 'ABC123',
      extensionVersion: '1.2.3',
      browser: 'Test Browser',
      platform: 'Test OS',
      timestamp: '2026-09-23T00:00:00.000Z',
    };

    const mailto = buildSupportMailto(report);

    expect(mailto.startsWith(`mailto:${SUPPORT_EMAIL}?`)).toBe(true);
    expect(mailto).toContain('ABC123');
    expect(mailto).toContain('PlanMyPeak%20extension%20error');
    expect(mailto).not.toContain('Test Browser');
  });
});
