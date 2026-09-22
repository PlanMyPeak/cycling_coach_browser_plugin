## MODIFIED Requirements

### Requirement: Passive credential checks never refresh and never open a tab

The resolver SHALL offer a passive mode that answers from stored state only. Passive resolution SHALL NOT attempt recovery, SHALL NOT open a browser tab, and SHALL answer within the existing account lookup budget, degrading to an unknown or unusable answer rather than waiting.

The site-control handshake, the captured-import summary request, and the captured-import status request SHALL use passive resolution. Work the coach explicitly started — the popup export, the captured-workout send, and a page-initiated import — SHALL use active recovery.

#### Scenario: Handshake answers promptly while a refresh is in flight

- **WHEN** a page sends the handshake request while a credential recovery is in progress
- **THEN** the handshake answers within its existing lookup budget rather than waiting for the recovery to finish

#### Scenario: Extension detection opens no tab

- **WHEN** a page sends the handshake request and the stored credential is unusable
- **THEN** no browser tab is opened and no recovery is attempted

#### Scenario: Summary and status requests stay passive

- **WHEN** a page requests the captured-import summary or the status of a running import
- **THEN** the answer is produced without attempting recovery

#### Scenario: Popup export recovers

- **WHEN** the coach starts a popup export and the stored credential is unusable
- **THEN** recovery is attempted

#### Scenario: Captured-workout send recovers

- **WHEN** a captured-workout send runs with an unusable credential
- **THEN** recovery is attempted rather than the send failing outright

#### Scenario: Page-initiated import recovers

- **WHEN** a page-initiated import runs with an unusable credential
- **THEN** recovery is attempted, and a browser tab may be opened on the origin the coach is already on

## ADDED Requirements

### Requirement: Recovery runs before account identity is evaluated

For callers using active recovery, the extension SHALL complete recovery before evaluating whether the coach is signed in and before resolving the acting account. A surface SHALL NOT report the coach as signed out, or the account as changed, on the basis of a credential that recovery has not yet been given the opportunity to replace.

#### Scenario: Expired credential immediately before an import guard

- **WHEN** a captured-workout import request arrives and the stored credential has expired
- **THEN** recovery runs first, and the request proceeds if recovery succeeds, rather than being refused as signed out

#### Scenario: Replacement credential for the same coach continues a run

- **WHEN** a running import recovers a new credential that belongs to the same coach and destination the run started under
- **THEN** the run continues

#### Scenario: Credential for a different coach stops a run

- **WHEN** a running import resolves an account that differs from the coach or destination the run started under
- **THEN** the run stops and reports that the account changed

### Requirement: Account identity lookups restart once when the credential changes

The account identity lookup SHALL keep its check that a profile fetched under one credential is never attributed to a different credential. When that check detects a change, the lookup SHALL retry at most once using the current credential and SHALL apply the same check on the retry. A further change SHALL yield an unknown account rather than a guess.

Waiting for recovery to be idle before reading the credential SHALL NOT be relied upon, because recovery can begin after that read, including as a consequence of the lookup's own rejection.

#### Scenario: Credential replaced mid-lookup

- **WHEN** an account lookup is in flight and recovery replaces the credential before the lookup returns
- **THEN** the lookup retries once with the new credential and resolves, instead of discarding its result

#### Scenario: Credential replaced twice yields unknown

- **WHEN** the credential changes again during the retried lookup
- **THEN** the account is reported as unknown rather than attributed to either credential

#### Scenario: Attribution check still applies on the retry

- **WHEN** the retried lookup returns a profile fetched under a credential that is no longer stored
- **THEN** that profile is not attributed to the currently stored credential

### Requirement: A write is revalidated against the original account after recovery

When recovery replaces the credential during a running import, the extension SHALL revalidate that the acting coach and destination still match the ones the operation started under before replaying a write.

#### Scenario: Write replayed after recovery is revalidated

- **WHEN** an upload is retried after recovery replaced the credential mid-run
- **THEN** the acting coach and destination are confirmed to match the operation's original coach and destination before the write is sent

#### Scenario: Replacement belonging to another coach does not carry the write

- **WHEN** recovery mid-run yields a credential belonging to a different coach than the operation started for
- **THEN** the write is not sent and the run stops reporting that the account changed

### Requirement: Import runs are identified by their operation

A recovery run for a page-initiated import SHALL be identified by that import's operation id, so the run and its terminal state survive a service-worker restart along with the operation.

#### Scenario: Run survives a worker restart

- **WHEN** the service worker restarts while an import operation is in progress
- **THEN** the resumed operation continues under the same recovery run rather than starting a fresh one
