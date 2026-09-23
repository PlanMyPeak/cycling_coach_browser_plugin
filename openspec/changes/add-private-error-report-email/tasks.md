## 1. Specification and shared contract

- [ ] 1.1 Add the `add-private-error-report-email` capability spec and confirm it passes strict OpenSpec validation.
- [ ] 1.2 Define the finite error-category allowlist, reference-ID format, report shape, and privacy copy in shared types/strings.
- [ ] 1.3 Define a single report builder that emits only allowlisted metadata and caps the generated email body.

## 2. Private email flow

- [ ] 2.1 Build a URL-encoded `mailto:support@planmypeak.com` draft with a safe subject and minimal report body.
- [ ] 2.2 Add the review/privacy notice and ensure no automatic send or network upload occurs.
- [ ] 2.3 Add clipboard/manual-copy fallback when opening the mail draft or copying the report fails.
- [ ] 2.4 Add success and failure states that do not disclose raw exception details.

## 3. Error surfaces

- [ ] 3.1 Add `Send error report` beside the ErrorBoundary `Try again` action.
- [ ] 3.2 Add the action to the selected high-value popup operation errors without duplicating report-building logic.
- [ ] 3.3 Keep retry, sign-in, and existing recovery actions unchanged.
- [ ] 3.4 Keep the Settings API Logs export separate and explicitly user initiated.

## 4. Verification

- [ ] 4.1 Unit-test allowlisted fields, stable category mapping, reference IDs, length caps, and URL encoding.
- [ ] 4.2 Unit-test that tokens, cookies, API keys, raw exception text, URLs, workout titles, and athlete identifiers cannot enter the default report.
- [ ] 4.3 Component-test the action, privacy notice, mailto fallback, clipboard fallback, and retry coexistence.
- [ ] 4.4 Run type-check, lint, unit/component tests, build, strict OpenSpec validation, and `git diff --check`.
- [ ] 4.5 Manually verify the draft is addressed to `support@planmypeak.com`, contains no sensitive default data, and remains unsent until the user confirms in their email client.
