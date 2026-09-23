## 1. Durable coach metadata

- [ ] 1.1 Add a versioned validated `capture_coach_cache` record and background-only read/publication service; keep credentials and current-session authorization separate.
- [ ] 1.2 Publish all successful coach-profile responses with the actual request credential/destination context, checking that context before acceptance; integrate with any recovery retry already implemented.
- [ ] 1.3 Trigger bounded, single-flight, throttled opportunistic lookup from accepted PlanMyPeak auth observations, post-persistence capture handling and eligible worker starts. No popup dependency or tab effects.
- [ ] 1.4 Keep last-known metadata on expiry/removal/logout and API errors; cover cache corruption as a cold-start state without losing captures.

## 2. Immediate capture and automatic enrichment

- [ ] 2.1 Replace the pre-storage network identity lookup in `handleWorkoutCaptured` with durable cached metadata, and save/update the badge before attempting refresh.
- [ ] 2.2 Preserve immediate first-install capture without a coach; automatically backfill absent owners after the first verified coach and on startup.
- [ ] 2.3 Serialize cache publication/backfill with capture-map mutations, preserve lifecycle/outcomes and increment revisions. Make interruption recovery idempotent.
- [ ] 2.4 Remove manual claiming as a normal workflow dependency; retain compatibility for the internal claim message until its callers are removed.

## 3. Owner-independent visibility and candidate selection

- [ ] 3.1 Remove historical owner matching from the shared destination-candidate predicate and update summary, operation snapshots and runner rechecks together.
- [ ] 3.1a Prove import works with no owner and no capture-coach cache before enrichment; isolate metadata-publication failures from otherwise successful API/import responses.
- [ ] 3.2 Keep destination acknowledgements, dismissal, provider-id namespaces, duplicate handling and currently authenticated write guards intact. Do not add source-coach or mixed-environment restrictions.
- [ ] 3.3 Make New Workouts reachable outside the popup's TP-auth gate; display all pending records while gating only network/send actions.
- [ ] 3.4 Remove the unlinked-record warning/Link prerequisite, keeping legacy records visible immediately; preserve badge priority and local pending counts.

## 4. Page contract and companion integration

- [ ] 4.1 Add `pendingCount` to summary types/schema/builders for every authorized ready/checking/blocked response; check page origin before exposing the count.
- [ ] 4.2 Preserve null missing-count semantics on unavailable scans; add `lookup_failed` blocked state so a library lookup error cannot hide known local pending availability.
- [ ] 4.3 Deprecate `unlinkedCount` as an informational compatibility field. Do not expose raw captures or add internal runtime types to the page channel.
- [ ] 4.4 Update `PLANMYPEAK_INTEGRATION.md` with pending versus missing semantics, stale/unknown-session polling, compatible field detection and destination-only send authorization.
- [ ] 4.5 Coordinate the companion PlanMyPeak page change: accept the additive field/reason, retain the Workout Library dot and explicit action with stale tokens, remove Link instructions, and use old behavior when the field is absent. Deploy the tolerant page contract first or together; this is required for the full no-popup outcome.
- [ ] 4.6 Update `CLAUDE.md` and affected source comments to replace obsolete immutable-owner visibility/manual-claim rules with the explicit personal-computer policy.

## 5. Verification

- [ ] 5.1 Test expired/missing TP and PlanMyPeak tokens with a durable coach, worker restart and no popup: valid captures persist with owner and update the badge before any lookup finishes.
- [ ] 5.2 Test clean installation and legacy unowned records: immediate visibility, first successful API attribution without manual linking, concurrent capture/backfill and restart during enrichment.
- [ ] 5.2a Test successful import of an unowned record with enrichment delayed or failed and no cache, while destination authentication is valid; attribution must not be awaited or required.
- [ ] 5.3 Test successful profile publication, token/destination races including recovered requests, failed lookups retaining cache, throttling across restarts and one refresh for concurrent opportunities.
- [ ] 5.4 Test mixed/missing historical owners and source environments across popup listing, badge, summary, import snapshot and runner; dismissal and acknowledgements still select the correct records.
- [ ] 5.5 Test summary with expired auth, disabled connection, unknown identity and slow/failed scans: local count remains, missing count stays unknown, wrong origins see no count, stale cache cannot authorize writes.
- [ ] 5.6 Test popup New Workouts with no TP token and companion page contract compatibility, navigation indicator, explicit action and removed linking workflow.
- [ ] 5.7 Run the applicable unit/component suites, type checking, lint and production build after implementation, resolving conflicts with concurrent PlanMyPeak auth-recovery work without overwriting it.
- [ ] 5.8 Browser acceptance: initialize coach through ordinary PlanMyPeak traffic with the popup closed; expire both extension tokens, restart the worker, create a TP workout, verify stamped local capture and page availability, then explicitly import after destination authentication recovers. Repeat with a clean cache and automatic first-coach backfill. Record real-browser evidence; mocks alone do not complete this task.
- [x] 5.9 Validate this OpenSpec with `openspec validate persist-capture-coach-and-show-all-pending --strict --no-interactive` and review the planning artifacts for private data and unrelated edits. Implementation and browser acceptance remain unchecked above.
