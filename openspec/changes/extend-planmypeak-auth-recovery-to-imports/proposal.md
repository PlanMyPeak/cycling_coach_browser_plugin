## Why

`fix-planmypeak-auth-recovery` restores the popup export path: an expired PlanMyPeak credential is recovered and the export completes. It deliberately leaves the captured-workout send and page-initiated captured-workout imports passive, so those still fail outright when the credential lapses, exactly as they do today.

They were left out because turning recovery on for them is not a matter of calling the same function. Recovery replaces the credential mid-flight, and the account identity lookup deliberately discards its own result when the stored credential changes while it is in flight. That check is correct and protects against attributing one coach's profile to another's credential, so it cannot simply be removed. Until the lookup can tolerate a legitimate replacement, enabling recovery on the import path would stop running imports with a misleading "the account changed" message.

This change does that work and then enables recovery on both remaining surfaces.

## Depends On

`fix-planmypeak-auth-recovery` must land first. This change assumes the resolver, the run handle, the terminal latch, and the credential removal owner already exist.

## What Changes

- Make the account identity lookup restart once, with the current credential, when it detects that the credential changed in flight, applying the same attribution check on the retry and reporting an unknown account on a second change.
- Run recovery before the captured-import guard evaluates whether the coach is signed in and before it resolves the acting account, so an expired credential is replaced rather than reported as signed out.
- Revalidate the operation's original coach and destination before replaying a write after recovery, so a replacement credential that belongs to a different coach cannot carry a write the run started for someone else.
- Create a recovery run at the captured-workout send and at the import runner, the runner using its operation id so the run survives a service-worker restart.
- Switch the captured-workout send and page-initiated imports from passive resolution to active recovery.
- Accept that a page-initiated import can now cause a background tab to open, on the same allowlisted origin the coach is already on.

Not changing: the page-reachable request list, `PING.supports`, and the handshake's reported fields. The handshake, the import summary, and the import status request stay passive and still cannot open a tab.

## Capabilities

### Modified Capabilities

- `planmypeak-auth-recovery`: active recovery extends from the popup export to the captured-workout send and page-initiated imports; account identity gains a bounded restart; writes replayed after recovery are revalidated against the run's original account.

## Impact

**Affected code**

- `src/services/planMyPeakIdentityService.ts` — bounded restart in the account lookup
- `src/background/capturedImports/contextGuard.ts` — recover before evaluating auth and resolving identity
- `src/background/capturedImports/importRunner.ts` — run handle from the operation id, revalidation before replaying a write
- `src/services/capturedWorkoutSender.ts` — run handle, active recovery
- `src/background/capturedImports/siteControlHandlers.ts` — the import start path becomes active while summary and status stay passive

**Resolved limitation**

Removes the limitation accepted in `fix-planmypeak-auth-recovery`, where a concurrent account lookup could resolve to unknown while an export was recovering.

**Dependencies**: none added.
