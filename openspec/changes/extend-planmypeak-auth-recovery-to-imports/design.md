## Context

`fix-planmypeak-auth-recovery` introduced a credential resolver with two modes. Passive resolution answers from stored state and never opens a browser tab; active recovery may refresh, bounded by a run handle and a terminal latch. Only the popup export uses active recovery today.

The captured-workout send and page-initiated captured-workout imports were left passive on purpose. Both call the same API client, so flipping them to active is a one-line change, and that is exactly the trap. Recovery replaces the stored credential mid-flight, and `resolvePlanMyPeakCoachId` discards its own result when the credential changed while its request was in flight (`planMyPeakIdentityService.ts:104-118`). That check exists so a profile fetched as one coach is never attributed to a credential that now belongs to another, and it is the only thing standing between a wrong-account write and silence.

Two consequences follow, and they are why this is a separate change:

1. A legitimate replacement, a new credential for the same coach, is indistinguishable from a session switch as far as that check is concerned. The lookup returns unknown.
2. `verifyOperationContext` runs before every upload in a running import (`importRunner.ts:158-167`) and converts any failure into `account_changed`, stopping the run. So an unknown account mid-run does not degrade quietly; it aborts the import with a message that misdescribes what happened.

Waiting for recovery to be idle before reading the credential does not fix this. Recovery can start after that read, including as a direct consequence of the lookup's own rejection.

## Goals / Non-Goals

**Goals:**

- A captured-workout send and a page-initiated import survive an expired credential the same way an export does.
- A legitimate credential replacement does not abort a running import or misreport it as an account change.
- A replacement belonging to a different coach still stops the run, with no write carried across.
- Recovery state for an import survives a service-worker restart, as the operation already does.

**Non-Goals:**

- Relaxing or removing the attribution check. It stays, and applies to every attempt.
- Changing the page-reachable request list, `PING.supports`, or the handshake's reported fields.
- Making the handshake, the summary, or the status request active. They stay passive and still cannot open a tab.

## Decisions

### The account lookup restarts once instead of voiding itself

On detecting that the credential changed in flight, the lookup retries once using the current credential and applies the same attribution check to that attempt. A second change returns unknown rather than a guess.

One restart, not a loop: a credential flapping between two values would otherwise spin. Unknown is already a value every caller handles, and it already fails closed for imports, so the capped case degrades to today's behaviour rather than to something new.

The alternative considered was keying the cache by coach rather than by credential, so a replacement would not invalidate it. Rejected: the cache key is what ties a profile to the credential it was fetched under, which is the property the check depends on.

### Recovery precedes the guard's own auth check

`resolveRequestContext` evaluates whether the coach is signed in before anything reaches the API client (`contextGuard.ts:52`). For active callers it now runs recovery first, so an expired credential is replaced rather than reported as `signed_out` and then surfaced as `account_changed`.

The guard keeps its existing ordering of refusals otherwise, so the coach is still told the first thing to fix.

### A replayed write is revalidated against the run's original account

Recovery mid-run means the credential carrying the next write is not the one the run started under. Before replaying a write, the runner confirms the acting coach and destination still match the operation's originals, which is the comparison `verifyOperationContext` already makes. A mismatch stops the run and reports the account change, which is now accurate rather than misleading.

This is the fail-closed half of the change and pairs with the restart above: the restart stops a legitimate replacement being treated as a switch, and the revalidation stops a genuine switch being treated as legitimate.

### An import's run is its operation

The import runner uses the operation id as the recovery run id. Operations already persist and are recovered after a service-worker restart, so the run and its terminal latch survive with them. A resumed operation continues under the same run rather than getting a fresh recovery budget, which is what stops a repeatedly interrupted import from opening a tab per resumption.

The captured-workout send creates an ordinary run for the duration of the send.

### A page-initiated import may now open a tab

This follows from making the import path active. It is accepted: `REFRESH_PROVIDER_AUTH` is already allowed from that same allowlisted origin by explicit design (`messageHandler.ts:386-408`), and the tab opens on the origin the coach is already on. The runner can outlive the page, so the tab may appear after it closes; it is self-closing, and the import completing is the better outcome.

The distinction that matters is preserved: work the coach started may open a tab, while merely detecting the extension or polling status may not.

## Risks / Trade-offs

- **The restart could mask a genuine account switch** → Mitigation: the attribution check runs on every attempt, the restart is capped at one, a second change yields unknown, and the write revalidation independently confirms the account before anything is written.
- **Two mechanisms now guard the same property** → The restart and the revalidation could drift apart. Mitigation: the revalidation reuses `verifyOperationContext` rather than reimplementing the comparison.
- **A tab can appear after the page that asked for the import is gone** → Mitigation: it is a background tab that closes itself, and the run latch bounds it to one per run.
- **Persisting run state alongside operations adds a field to recover** → Mitigation: an absent field means a fresh run, which is the safe default.

## Migration Plan

No data migration. Operations persisted without a recovery run id resume as fresh runs. Rollback is a straight revert, which returns the import and send paths to passive resolution; the resolver and run handle introduced by the previous change remain in use by the export path.

## Open Questions

- Should a resumed import that has already exhausted its recovery run be retried automatically once the coach signs in again, or wait for the page to ask? Current assumption is to wait for the page.
