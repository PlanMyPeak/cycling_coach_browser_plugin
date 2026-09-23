## ADDED Requirements

### Requirement: Default reports contain minimal diagnostic metadata

The extension SHALL build the default error report from an allowlisted error category, operation label, failure code, and non-sensitive diagnostic metadata only. The report SHALL include a reference ID, extension version, available browser/platform metadata, and timestamp.

The default report SHALL NOT include raw exception messages or stacks, request URLs, request or response bodies, API logs, workout titles, athlete identifiers, account names, tokens, cookies, API keys, or credentials.

#### Scenario: A user creates a report after an operation fails

- **WHEN** the user selects the error-report action
- **THEN** the generated report contains only the allowlisted category and diagnostic metadata
- **AND** it contains a reference ID that support can quote back to the user
- **AND** it contains no raw operation data

#### Scenario: A failure contains sensitive diagnostic text

- **WHEN** an exception includes a token, URL, workout title, athlete identifier, or account data
- **THEN** the default report excludes that exception text and includes only the mapped safe error category

#### Scenario: A network export fails

- **WHEN** an export displays `Failed to fetch`
- **THEN** the report includes `Operation: export`
- **AND** it includes `Failure code: network_request_failed`
- **AND** it excludes the raw error text and request details

### Requirement: The report is prepared for reviewable private email

The extension SHALL copy a reviewable report and show `support@planmypeak.com` as the destination. The report SHALL identify the product, safe error category, and reference ID.

The extension SHALL not send email, open a `mailto:` navigation, call an email provider API, upload the report, or contact a remote service as part of this flow.

#### Scenario: The user prepares a private support email

- **WHEN** the user selects `Send error report`
- **THEN** the minimal report is copied to the clipboard
- **AND** the UI shows `support@planmypeak.com` as the destination
- **AND** the user can review or edit it in their email client before sending

#### Scenario: Clipboard access is unavailable

- **WHEN** the browser cannot write to the clipboard
- **THEN** the extension offers the report for manual copying
- **AND** it displays `support@planmypeak.com`
- **AND** it does not discard the report silently

### Requirement: Users are warned to review privacy before sending

The email draft or immediately preceding UI SHALL tell the user that the report is private to the support mailbox but that they should review the content and remove personal, account, or training information before sending.

#### Scenario: The user opens the report flow

- **WHEN** the report action is shown or activated
- **THEN** the user can see that the report is sent to private support email
- **AND** the user is told to review the draft before sending

### Requirement: Error reporting does not replace recovery actions

The report action SHALL coexist with the existing retry, sign-in, and recovery actions. Selecting it SHALL not retry the failed operation, clear credentials, or alter captured data.

#### Scenario: The user reports and retries

- **WHEN** the user copies an error report and then selects `Try again`
- **THEN** the report flow has no effect on the retry
- **AND** the existing retry behavior remains unchanged

### Requirement: Detailed logs remain explicit and separate

The extension SHALL NOT attach or include the existing API debug-log export in the default error report. Detailed logs SHALL remain available only through the existing explicit Settings export action.

#### Scenario: A user creates a report while debug logs exist

- **WHEN** API logs are stored locally and the user selects `Send error report`
- **THEN** the copied report excludes those logs
- **AND** the user must separately choose the debug-log export if support requests it

### Requirement: The support address is treated as public contact information

The extension MAY include `support@planmypeak.com` in source and UI strings. It SHALL NOT store or handle that address as a secret or credential.

#### Scenario: The source repository contains the support address

- **WHEN** the implementation is committed to the repository
- **THEN** the address is treated as public contact information
- **AND** no secret-management or credential-redaction mechanism is required for the address
