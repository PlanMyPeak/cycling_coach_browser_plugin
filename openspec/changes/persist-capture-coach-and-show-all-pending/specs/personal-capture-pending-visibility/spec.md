## ADDED Requirements

### Requirement: Pending captures are visible independently of ownership and authentication

The personal browser profile SHALL expose all valid locally pending captures in the popup and local pending count without filtering by recorded owner, destination, TP environment, missing identity or current authentication. New Workouts SHALL remain reachable when TP authentication is missing. Authentication and existing confirmed account-mismatch checks MAY block sending but SHALL NOT hide the local records. Manual linking SHALL NOT be a visibility or eligibility prerequisite.

#### Scenario: Mixed historical owners and no owner

- **GIVEN** pending records annotated with coach A, coach B and no coach
- **WHEN** the local collection is read while signed in as coach B
- **THEN** all three are visible and counted

#### Scenario: Both tokens missing

- **WHEN** the popup is opened with pending captures and neither token present
- **THEN** New Workouts remains available and lists them, while remote actions display their connection requirements

#### Scenario: Badge reflects all pending records

- **WHEN** pending captures have different or missing owners
- **THEN** the badge and tab indicator count all of them using the existing export-priority and 99-plus rules

### Requirement: Destination eligibility does not depend on historical owner

Summary reconciliation, import-start selection and import-runner rechecks SHALL share the predicate that a capture is not dismissed and lacks an acknowledgement for the current verified destination account. They SHALL NOT require its stored owner to match. Imports SHALL remain explicit and use currently authenticated destination authorization, exact provider identities, duplicate reconciliation and per-destination acknowledgements. The capture-coach cache SHALL NOT supply authorization.

#### Scenario: Unowned or differently owned capture is importable

- **WHEN** a coach explicitly imports missing captures under a verified destination session
- **THEN** unowned and differently annotated eligible captures are considered without a claim step
- **AND** outcomes are acknowledged against that actual destination account

#### Scenario: No capture coach has ever been cached

- **GIVEN** a capture with no attached coach, no durable capture-coach cache, and a valid current PlanMyPeak destination session
- **WHEN** the coach imports that capture before enrichment runs
- **THEN** the import succeeds without creating or requiring an owner annotation first
- **AND** neither popup access nor a Link action is required

#### Scenario: Already handled here or dismissed

- **WHEN** a record is dismissed or acknowledged for the current destination account
- **THEN** it is not selected for automatic missing-workout import
- **AND** a sent record acknowledged only elsewhere remains eligible for reconciliation here

#### Scenario: Current destination account changes during import

- **WHEN** the authenticated destination account changes while an import is running
- **THEN** existing operation-context checks stop writes under the changed account
- **AND** the local pending records remain visible

### Requirement: Page summary separates local pending count from verified missing count

For an allowlisted page at the configured destination, every successful summary response SHALL include a nonnegative global local `pendingCount`, including `checking` and `blocked` responses. It SHALL remain available when credentials are stale, identity is unknown or the connection is disabled. `missingCount` SHALL remain null until destination reconciliation completes successfully. Lookup failure SHALL return `state: 'blocked'`, `blockedReason: 'lookup_failed'`, the local count and null missing count. Origin validation SHALL precede disclosure, and page messages SHALL NOT expose raw captures, athlete identifiers or credentials.

#### Scenario: Tokens expired but captures are pending

- **WHEN** the configured PlanMyPeak page asks for a summary with three pending captures and an unusable destination credential
- **THEN** it receives `pendingCount: 3`, a blocked connection state and `missingCount: null`
- **AND** it receives no false authenticated identity from the durable capture cache

#### Scenario: Lookup is slow or fails

- **WHEN** destination reconciliation exceeds its existing response budget or fails
- **THEN** the summary retains the local pending count with respectively checking or lookup-failed state
- **AND** it does not claim zero missing or clear local availability

#### Scenario: Different page origin

- **WHEN** a non-allowlisted page or a page at the wrong configured destination requests a summary
- **THEN** it receives no local pending count under the existing origin refusal rules

### Requirement: PlanMyPeak discovery works without opening the extension

The companion page integration SHALL discover pending availability through the existing summary channel even when the extension's current identity is unknown or tokens are stale. A navigation indicator and explicit page action SHALL remain available for known captures; unavailable authorization SHALL affect the action state rather than hide local availability. The page SHALL feature-detect `pendingCount`, distinguish pending from verified missing, tolerate `lookup_failed`, and cease requiring manual linking. Existing extensions without the new field SHALL retain their previous page behavior.

#### Scenario: Capture after idle period with popup closed

- **GIVEN** a cached coach, an idle/restarted worker and expired tokens
- **WHEN** the coach creates a supported workout in TP and then visits PlanMyPeak without opening the popup
- **THEN** the page displays pending availability, and after its destination session is usable the coach can explicitly import it without a Link action

#### Scenario: Pending and missing counts differ

- **WHEN** local pending count is known but destination reconciliation is unavailable
- **THEN** the page describes captured/pending workouts and does not describe that count as verified missing workouts

#### Scenario: Old extension compatibility

- **WHEN** a summary lacks `pendingCount`
- **THEN** the updated page uses its existing missing-count behavior instead of rejecting the response
