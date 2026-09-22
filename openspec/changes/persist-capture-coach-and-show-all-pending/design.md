## Context and evidence

The TP interceptor observes a successful page-owned save and forwards its bodies; it does not use the extension's TP credential. The background handler currently awaits `resolveCaptureContext()` before `storeCapture()`. `planMyPeakIdentityService.ts` caches only `{ token, coachId }` in memory, so expiry or worker restart can make that resolution unavailable. `isImportCandidateFor()` then requires `isOwnedBy()`, excluding those records from page reconciliation/import. The popup lists local records but its parent TP-auth gate can hide the entire New Workouts surface. A manual claim banner is the current recovery path.

The user has explicitly selected a personal-computer model: show and allow import of all pending records regardless of ownership, including records with no coach attached. The later clarification makes attached coach metadata optional for the entire workflow. Durable caching and opportunistic enrichment remain useful metadata improvements, but removing ownership from eligibility is the actual fix; neither cache initialization nor backfill may become an import dependency.

## Scope and precedence

This change supersedes the current rule that historical capture ownership controls availability, and the rule that missing ownership must be repaired explicitly in the popup. Update corresponding `CLAUDE.md`, schema comments, integration documentation and tests during implementation. Do not reintroduce source-coach matching, shared-profile isolation or mixed-environment rejection as prerequisites for displaying or selecting captures.

It does not change authentication of the destination upload: the current credential, page-origin checks, operation destination and existing confirmed TP/PlanMyPeak account-mismatch rule continue to apply to sending. Those checks never hide local pending records. Keep raw captures and credentials out of page messages; the PlanMyPeak page receives counts and operation handles as today.

This plan is independent of TP token renewal. Integrate with the evolving `fix-planmypeak-auth-recovery` and `extend-planmypeak-auth-recovery-to-imports` work at the verified coach response and import-context seams; do not duplicate their credential resolver. Capture and visibility must work even before active recovery succeeds.

## 1. Two different identity purposes

Add a background-owned, versioned `capture_coach_cache` record in `chrome.storage.local`:

```ts
type CaptureCoachCache = {
  version: 1;
  coachId: string;
  destination: string;
  verifiedAt: number;
};
```

This is the last successfully API-verified coach context on this personal profile. It contains no credential, email or name. Its destination records where the identity was verified, not where a later workout must be imported. It has no token-age expiry and survives token clearing, logout, network failure, API rejection and worker/browser restarts. Clearing extension data removes it; ordinary credential recovery does not.

Keep the existing current-session identity resolver distinct. Cached capture metadata MUST NOT populate an authenticated `PING.coachId`, authorize writes or satisfy an operation-context check when the current credential has not been verified. A later successful profile lookup replaces the capture cache. Existing attributed records retain their historical annotation; all remain visible. A destination switch does not erase the last known annotation or block capture, and imports still target the currently verified destination.

## 2. Refresh opportunities without the popup

Centralize cache publication in a dependency-light background service, avoiding an API-client/identity-service import cycle.

1. Every successful schema-validated `fetchPlanMyPeakCoach()` response publishes the coach context and refreshes `verifiedAt`, including calls originating from page operations, validation, mismatch checks and recovery.
2. An accepted observed PlanMyPeak user token schedules a bounded `/api/backend/coaches/me` lookup. This initializes the cache when the coach uses PlanMyPeak normally, without opening the extension.
3. A capture saves first, then may perform the same bounded lookup if a usable PlanMyPeak credential exists and a lookup is due. Worker startup may also attempt it when due, and always resumes pending local backfill.

Use one in-flight lookup per current credential/destination, a 1200 ms request budget, and a persisted 60-second minimum interval for additional opportunistic lookups on an unchanged credential/destination. A newly accepted credential or explicit authentication recovery can make one immediate attempt; concurrent callers join it. Existing successful profile responses are always consumed and never incur a second request. These bounds are implementation policy constants, not claims about token lifetime.

Associate a response with the credential/destination actually used by the final request, including a recovery retry. Before publishing, verify that request context is still current. Discard late responses from a superseded credential or destination; do not relabel them with whichever token is now stored. The latest accepted response wins through the background mutation queue. Parse failures, timeouts, 401s and offline errors preserve the durable cache.

Opportunistic refresh never opens, reloads or focuses tabs, refreshes credentials interactively, or blocks capture persistence. Await bounded follow-up work within a background event lifetime rather than depending on an untracked promise after an event ends. Missing a refresh opportunity is harmless: the durable annotation remains and the next opportunity retries.

## 3. Capture first, enrich locally

After sender and payload validation, persist the workout using the durable cached coach immediately, before any network lookup. With a valid cache, every newly stored capture has `owner` even when both tokens are expired. Update the badge from local state.

With no cache, retain the current optional `owner` representation, save the complete normalized workout as pending and show/count it immediately. An absent owner is a normal supported record, not an error or a state that must be repaired before importing. No fabricated id, dropped workout or separate invisible holding queue.

On the first accepted coach context, automatically fill absent owners on retained valid records, including legacy captures, as best-effort metadata enrichment. Never overwrite an existing owner or alter status, capture time, workout fields, errors, destination acknowledgements or completed-send metadata. Existing unowned records are importable even before this enrichment, using the verified current destination at send time. A failed cache write or backfill does not fail an otherwise valid import; record the metadata failure separately and retry enrichment at a later opportunity.

Coordinate cache publication, capture writes and backfill through the existing background-only serialization boundary. A capture racing cache initialization either receives the cache immediately or is found by backfill; neither update is lost. Backfill is idempotent and resumes on worker start so a stop between cache persistence and record enrichment cannot strand records. Keep storage writes out of the popup. Increment the capture revision when records change.

## 4. One personal capture collection

Local pending means `status === 'pending'` over every valid captured record, without owner, destination, source-environment or authentication filters. Badge and popup tab use that definition. Preserve export badge priority, `99+` display and dismissal behavior.

Make New Workouts and its list reachable even when TP authentication is absent or stale. Auth gates continue to protect remote library browsing and sends, not local capture display. Remove the manual-link banner and prerequisite. Keep the internal claim message temporarily compatible/idempotent if older surfaces call it, but no normal workflow depends on it.

For page import/reconciliation, replace the shared predicate with:

```ts
record.status !== 'dismissed' &&
  acknowledgementFor(record, currentVerifiedDestinationContext) === undefined;
```

Historical `owner` is not consulted. This also preserves the existing rule that a globally `sent` record acknowledged in another destination may still need reconciliation here. Apply the predicate consistently in summary, import-start snapshot and runner rechecks. Preserve exact provider ids (`cal:` / `cal-sandbox:`), duplicate reconciliation, background-owned per-item outcomes, explicit user-triggered sends and acknowledgements for the actual destination account. Do not retroactively mark a workout imported just because its coach annotation was filled.

## 5. Pending visibility versus destination readiness

Add required nonnegative `pendingCount` to new extension summary responses. It is the global local count, available before credential resolution, and is included on `ready`, `checking` and `blocked` results. It is deliberately distinct from `missingCount`, which remains null until a complete successful destination scan. An authenticated scan uses the broader owner-independent candidate set.

For an allowlisted page at the configured destination, return the local count even when the connection is disabled, credentials are expired or the current coach cannot be verified. The page may display availability but may not import until its existing destination authorization checks pass. Validate the configured origin before exposing even this count; non-allowlisted origins remain silent and wrong-destination origins receive an error refusal rather than a successful summary, with no local count.

A reconciliation error must not erase known local availability. Return a summary with `state: 'blocked'`, `blockedReason: 'lookup_failed'`, `missingCount: null` and the local `pendingCount`; add the reason to types/schemas and use a bounded generic message in the page. Do not turn an incomplete scan into zero missing.

Keep `unlinkedCount` temporarily as a deprecated metadata count for wire compatibility; it no longer controls eligibility or requests manual linking. Keep all existing request types and `PING.supports` unchanged. Document the additive summary field/reason and update the companion page schema to accept them.

The PlanMyPeak page must continue polling summary while a stored token is stale or `PING.coachId` is null; those states no longer suppress local availability discovery. Show the Workout Library navigation dot and page notice when `pendingCount > 0` or a verified `missingCount > 0`. If only the local count is known, say workouts are captured/pending and display the connection or lookup state, rather than claiming they are all missing from the library. The verified import action still uses the existing context/coach checks and remains explicit. A current-account mismatch affects the action, not the local pending indicator.

New page code feature-detects `pendingCount`; older extensions keep their existing missing-count behavior. Deploy the tolerant page contract before or together with the extension update. Older pages may continue hiding captures while signed out or displaying obsolete linking instructions; do not claim the full no-popup experience until the companion change is delivered. No raw-workout listing API is added to the page.

## Validation and limits

The decisive browser acceptance scenario starts with a verified coach cache, closes the popup, expires/removes both access tokens and restarts the worker. Creating a supported custom workout in TP must immediately persist it with cached coach metadata and update the badge. The PlanMyPeak page must show pending availability before credential recovery, then let the coach explicitly import once its current destination session is usable. Repeat from a clean install with no coach cache. With enrichment deliberately delayed or failed, the record must still import successfully under a valid destination session while its owner remains absent. Verify automatic attribution separately after normal PlanMyPeak use, without opening the popup or clicking Link.

Token expiry alone must never cause missing metadata after initialization or hide pending captures. This change does not promise automatic uploads, endless authenticated sessions, capture while the extension is disabled, or capture of TP endpoints that the interceptor does not support. It does not add a durable content-script delivery queue; delivery/storage failures remain distinct from identity-cache behavior.
