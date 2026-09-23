## Context

The extension runs across a popup, content-script surfaces, and a background worker. Failures may occur in any of them, while the data involved can include private training information. The current `debugLogService` sanitizes credentials and tokens, but a sanitized API log can still contain operational details or user data. Therefore, the normal support flow must not reuse the full debug export.

The extension cannot rely on every user's device having a desktop email handler registered for `mailto:`. A copy-ready report is therefore the reliable private-delivery mechanism: it does not grant the extension access to the user's mailbox or send anything silently, and the user remains responsible for opening their email client, reviewing, and sending the message.

## Decisions

### Minimal report by default

The generated report SHALL contain only:

- product label and report type;
- stable, non-sensitive error category/code;
- safe operation label and allowlisted failure code;
- a random reference ID for support correlation;
- extension version;
- browser name/version when available;
- operating-system/platform label when available;
- ISO timestamp;
- an empty user-description section.

It SHALL NOT include exception stack traces, request URLs, request/response bodies, API logs, workout titles, athlete IDs, account names, tokens, cookies, API keys, or arbitrary error-message text. Operation labels and failure codes SHALL be selected from finite allowlists; raw exception text may be inspected only to select an allowlisted failure code.

### Review before delivery

The extension SHALL copy a report and show `support@planmypeak.com` as the destination. The report SHALL identify the product, safe error category, and reference ID, and the UI SHALL include a privacy notice telling the user to review and remove private information before sending.

The extension SHALL NOT send an email, open a `mailto:` navigation, call an email API, upload a report, or contact a remote service. If clipboard access fails, the report text SHALL be presented for manual copying, and the UI SHALL show the support address.

### Error-surface placement

The first implementation SHALL support the shared ErrorBoundary fallback and the highest-value popup operation error surfaces identified during implementation. The report action SHALL be available only when an error is actionable and SHALL not replace the existing retry action.

The Settings API Logs panel SHALL continue to offer its explicit JSON export. The private error-report action SHALL not silently include or attach that export.

### Privacy and security

The public support address is contact information, not a credential. It may be present in source code and extension UI. It SHALL not be treated as a secret or placed in secret storage.

The implementation SHALL cap the generated body length, avoid interpolating untrusted raw exception text, and handle clipboard failure without exposing diagnostic data in a new page or URL.

## Alternatives considered

- Public GitHub Issues: rejected as the default because repository issues inherit repository visibility and user reports may contain private training information.
- Automatic backend upload: deferred because it requires a privacy policy, retention controls, authentication/rate limiting, and a new data-processing path.
- Full sanitized debug-log attachment: rejected for the default flow because credential redaction does not guarantee removal of personal or training data.
