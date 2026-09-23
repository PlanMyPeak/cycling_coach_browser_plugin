## Why

When an extension operation fails, users need an easy way to contact support without manually finding logs or posting potentially sensitive TrainingPeaks data to a public issue tracker. The extension already has user-visible error states and local diagnostic logging, but it does not provide a private, guided reporting path.

## Scope

Add a user-initiated, private email flow for extension errors. The flow copies a minimal diagnostic summary and gives the user the private support address `support@planmypeak.com` so they can paste it into their configured email client and review it before sending.

The existing API debug-log export remains a separate advanced troubleshooting tool in Settings. It is not attached to the email automatically.

## What Changes

- Add a reusable private error-report builder with a stable error category/reference, safe operation label and failure code, extension version, browser/platform metadata, timestamp, and user-editable description area.
- Add a `Send error report` action beside recoverable extension error UI, including the ErrorBoundary fallback and the main user-facing operation failures selected during implementation.
- Prepare a copy-ready email report rather than relying on a configured desktop `mailto:` handler.
- Show a clear privacy warning that the user should review the draft and remove personal or workout information before sending.
- Provide a manual-copy fallback when clipboard access is unavailable.
- Keep detailed API logs local and require an explicit, separate user action to export them.

## Non-goals

- Automatic error uploads or server-side collection.
- Attaching API logs, API responses, workout titles, athlete identifiers, URLs, tokens, cookies, or credentials by default.
- Adding a new host permission or email-sending service.
- Replacing the existing advanced API Logs panel.

## Impact

Affected areas include shared error-report utilities/types, popup and content-surface error components, user-facing strings, and unit/component tests. No backend, manifest permission, storage migration, or external dependency is required.
