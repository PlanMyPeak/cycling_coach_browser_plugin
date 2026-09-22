## 1. Preconditions

- [ ] 1.1 Confirm `fix-planmypeak-auth-recovery` has landed and that the resolver, run handle, terminal latch and credential removal owner are in place
- [ ] 1.2 Confirm the captured-import and send paths are still passive, so this change is the only thing switching them

## 2. Account lookup restart

- [ ] 2.1 Change `resolvePlanMyPeakCoachId` in `src/services/planMyPeakIdentityService.ts` to retry once with the current credential when its attribution check detects a change
- [ ] 2.2 Apply the same attribution check on the retry, and return unknown on a second change
- [ ] 2.3 Keep the restart capped at one so a flapping credential cannot spin
- [ ] 2.4 Extend `tests/unit/services/planMyPeakIdentityService.test.ts`: a credential replaced mid-lookup resolves via one restart; a second replacement yields unknown; a profile fetched under a credential that is no longer stored is not attributed to the current one

## 3. Guard ordering

- [ ] 3.1 Make `resolveRequestContext` in `src/background/capturedImports/contextGuard.ts` run recovery before evaluating authentication and before resolving identity, for active callers only
- [ ] 3.2 Keep the existing order of refusal reasons so the coach is still told the first thing to fix
- [ ] 3.3 Extend `tests/unit/background/capturedImports/contextGuard.test.ts`: an expired credential immediately before an import guard recovers rather than reporting signed out or account changed
- [ ] 3.4 Assert the summary and status handlers still resolve passively and still cannot open a tab

## 4. Write revalidation

- [ ] 4.1 Revalidate the operation's original coach and destination before replaying a write after recovery in `src/background/capturedImports/importRunner.ts`, reusing `verifyOperationContext` rather than reimplementing the comparison
- [ ] 4.2 Stop the run and report the account change when the revalidation fails
- [ ] 4.3 Extend `tests/unit/background/capturedImports/importRunner.test.ts`: a refresh during a run does not stop it; a replayed write is revalidated; a replacement belonging to a different coach stops the run and sends no write

## 5. Run handles on the remaining surfaces

- [ ] 5.1 Use the operation id as the recovery run id in the import runner, and persist it with the operation
- [ ] 5.2 Resume an interrupted operation under the same run rather than granting a fresh recovery budget; treat an absent run id as a fresh run
- [ ] 5.3 Create an ordinary run for the duration of a captured-workout send in `src/services/capturedWorkoutSender.ts`
- [ ] 5.4 Add tests: a resumed operation continues under the same run; a repeatedly interrupted import does not open a tab per resumption

## 6. Switch the call sites to active

- [ ] 6.1 Switch the import start path in `src/background/capturedImports/siteControlHandlers.ts` to active recovery, leaving summary and status passive
- [ ] 6.2 Switch the captured-workout send to active recovery
- [ ] 6.3 Confirm no message claims a tab was opened when the run was latched or in cooldown
- [ ] 6.4 Confirm page-facing errors still map to the existing authentication error code, carry no credential, and add no site-control request type

## 7. Verification

- [ ] 7.1 Run `make check` and `make test-unit`
- [ ] 7.2 Run `make build`
- [ ] 7.3 Manual: start a page-initiated captured import and expire the credential mid-run; the run recovers and completes without reporting that the account changed
- [ ] 7.4 Manual: send captured workouts with an expired credential; the send recovers and completes
- [ ] 7.5 Manual: sign out entirely, then start a page-initiated import; it fails with one clear reason and at most one tab is opened
- [ ] 7.6 Manual: with an expired credential, confirm the page still detects the extension promptly and that polling status opens no tab
- [ ] 7.7 Manual: switch PlanMyPeak accounts mid-import and confirm the run stops with an accurate account-changed message and no write carried across
