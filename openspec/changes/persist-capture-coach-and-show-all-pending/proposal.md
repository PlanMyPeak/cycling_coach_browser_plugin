## Why

Custom TrainingPeaks workouts must be captured, discoverable and importable without opening the extension or attaching a coach to each workout. Today page-driven imports exclude records owned by another account or by no account. On the agreed personal-computer setup, that ownership filter is unnecessary and hides useful workouts when authentication expires.

## What Changes

- Make attached coach metadata optional throughout capture, display and import. A workout with no coach attached can be imported into the currently authenticated PlanMyPeak account immediately, without cache initialization, backfill or claiming.
- Persist the last API-verified PlanMyPeak coach and its destination independently of access-token lifetime. Stamp new captures from that cache without waiting for a network request.
- Refresh the cache from successful coach-profile API responses and bounded background lookups triggered by observed PlanMyPeak authentication. Neither capture nor refresh requires the popup.
- Retain the cache through token expiry, token removal and worker/browser restarts. Cached identity is capture metadata, not proof that an API request is authorized.
- On a first installation with no known coach, save immediately. Missing coach metadata may be filled automatically when known, but enrichment is never a prerequisite for importing the workout.
- Show all pending captures regardless of recorded coach, recorded destination, missing owner or current authentication. Remove manual linking as a prerequisite for visibility or import eligibility.
- Include all eligible captures in destination reconciliation and explicit imports, independent of historical ownership. Keep acknowledgements scoped to the actual import account/destination and preserve existing duplicate handling.
- Add a local `pendingCount` to the page summary so the app can display captured-workout availability even when library reconciliation or authentication is unavailable. Keep `missingCount` as a separate, verified destination result.
- Update the PlanMyPeak page integration to use this distinction while preserving both the navigation indicator and explicit import action.

## Capabilities

### New Capabilities

- `capture-coach-cache`: Durable last-known coach metadata, opportunistic refresh, immediate capture, automatic first-use and legacy backfill.
- `personal-capture-pending-visibility`: Owner-independent local visibility, summary counts, destination import eligibility and page compatibility.

### Modified Capabilities

None in the canonical spec directory, which does not yet exist. The new requirements amend the implemented behavior described in `tp-workout-capture-to-pmp` and `planmypeak-extension-control`; see the explicit precedence decisions in the design.

## Impact

- Identity and capture services, storage schemas, background message handling and the PlanMyPeak coach-profile API client.
- Popup navigation/auth gates, captured-workout list, shared candidate selection, summary handlers and background import runner.
- Site-control types/schemas, `PLANMYPEAK_INTEGRATION.md`, repository guidance and companion PlanMyPeak page integration.
- Existing unowned records become visible/importable without a claim action. Recorded owners become metadata rather than a source access filter. This is an intentional behavior change for a personal browser profile.
- No automatic upload, new permissions, new external dependencies, TP token-refresh implementation or shared-computer support. Existing PlanMyPeak auth-recovery changes remain responsible for recovering credentials needed by imports.
