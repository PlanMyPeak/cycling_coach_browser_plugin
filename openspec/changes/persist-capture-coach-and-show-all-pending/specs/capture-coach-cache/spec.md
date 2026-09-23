## ADDED Requirements

### Requirement: Last verified capture coach is durable metadata

The background SHALL persist the most recently accepted API-verified PlanMyPeak coach id, destination and verification time independently of the access token. The cache SHALL survive credential expiry/removal, logout and worker/browser restart, SHALL have no token-age expiry, and SHALL NOT authorize API access or substitute for the current-session identity in page handshakes or import guards.

#### Scenario: Authentication expires after initialization

- **GIVEN** a coach was verified and cached
- **WHEN** both provider tokens expire or are removed and the worker restarts
- **THEN** the cached coach context remains available for capture annotation without a network call
- **AND** expired credentials do not become authorized because that context exists

#### Scenario: Another coach is verified later

- **WHEN** a current-context API response successfully verifies a different coach
- **THEN** subsequent captures use that coach and updated verification time
- **AND** existing attributed captures retain their metadata and remain visible

### Requirement: Successful API opportunities refresh the cache without the popup

Every successful validated coach-profile response SHALL refresh the durable cache if its actual request credential and destination remain current. Accepted observed PlanMyPeak authentication, capture handling after persistence, and worker startup SHALL offer bounded opportunistic profile refresh when a usable credential is available. Additional requests SHALL share one in-flight lookup per credential/destination, time out within 1200 ms and be throttled to once per 60 seconds for an unchanged credential/destination; new credentials or explicit recovery MAY trigger one immediate attempt. Refresh SHALL NOT require the popup or open, reload or focus a tab.

#### Scenario: Normal PlanMyPeak use initializes identity

- **GIVEN** the popup has never been opened
- **WHEN** the extension accepts authentication observed from PlanMyPeak traffic and its background coach lookup succeeds
- **THEN** the verified coach context is persisted and missing capture annotations are filled automatically

#### Scenario: Existing profile request succeeds

- **WHEN** any background coach-profile request succeeds under the current context
- **THEN** its response refreshes the cache without a duplicate lookup

#### Scenario: Failed refresh retains useful identity

- **WHEN** an opportunistic lookup times out, is offline, returns 401 or fails response validation
- **THEN** the previous durable cache remains intact and capture persistence remains successful

#### Scenario: Late response must not overwrite current identity

- **WHEN** the credential or destination changes while a coach lookup is in flight
- **THEN** its response is not published as the current capture coach
- **AND** a response after credential recovery is attributed to the actual credential used by the successful retry

#### Scenario: Many captures arrive together

- **WHEN** multiple captures arrive with the same unchanged credential/destination
- **THEN** all are saved and eligible refresh requests join one bounded lookup within the throttle policy

### Requirement: Capture persistence does not depend on live authentication

For every supported successful TP create with a valid payload, the background SHALL store the workout before attempting a network identity refresh and SHALL use the durable coach cache when present. Popup state and stored TP/PlanMyPeak credential validity SHALL NOT gate capture. Existing origin validation, normalized storage, duplicate-create handling and local lifecycle SHALL continue to apply.

#### Scenario: Cached coach and expired tokens

- **GIVEN** the cache contains a verified coach and both extension tokens are expired
- **WHEN** TP successfully saves a supported custom workout while the popup is closed
- **THEN** the capture is persisted with that coach context and its pending badge is updated without a network identity lookup blocking the write

#### Scenario: First installation has no known coach

- **GIVEN** no coach has ever been cached
- **WHEN** a supported workout is captured
- **THEN** it is saved immediately with absent coach metadata and included in pending visibility
- **AND** no fabricated coach, initial connection requirement or manual-link prerequisite is introduced

### Requirement: Missing coach annotations are filled automatically and safely

Publishing a verified cache SHALL initiate best-effort filling of missing owner annotations on retained valid captures. Background startup SHALL resume incomplete backfill using the durable cache. Capture and enrichment writes SHALL be serialized, idempotent and preserve existing owners, workout data, timestamps, lifecycle states, errors and acknowledgements. Enrichment SHALL advance the capture revision but SHALL NOT upload or mark records sent. A missing or failed enrichment SHALL NOT block display or import.

#### Scenario: Legacy unowned records

- **WHEN** a verified cache becomes available with existing unowned records
- **THEN** missing annotations are filled without opening the popup or requesting a claim
- **AND** pending, sent and dismissed states remain unchanged

#### Scenario: Capture races cache initialization

- **WHEN** a capture and the first verified cache update occur concurrently
- **THEN** the workout is retained and receives the coach annotation either at persistence or through backfill

#### Scenario: Worker stops during backfill

- **WHEN** the worker restarts after cache persistence but before all missing annotations were filled
- **THEN** backfill resumes idempotently without overwriting attributed records or send outcomes

#### Scenario: Metadata enrichment fails during a valid import

- **WHEN** coach-cache publication or backfill fails but the current destination session can import an unowned record
- **THEN** the import proceeds without requiring an attached coach
- **AND** the metadata failure is recorded independently and may be retried later
