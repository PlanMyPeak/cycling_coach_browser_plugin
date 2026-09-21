# PlanMyPeak Integration Guide

This document explains how to export TrainingPeaks workouts to PlanMyPeak format using the export adapter.

## Overview

The PlanMyPeak export adapter transforms TrainingPeaks workout data into the PlanMyPeak JSON format, enabling seamless migration of workout libraries between platforms.

### Key Features

- ✅ **Automatic transformation** of TrainingPeaks structured workouts
- ✅ **Type-safe** with TypeScript and Zod validation
- ✅ **Configurable** workout types, intensity, and training phases
- ✅ **Validation** with detailed error and warning messages
- ✅ **Export** to JSON files for manual upload
- ✅ **Mock API** for testing (real API integration ready)

---

## Data Structure Mapping

### TrainingPeaks → PlanMyPeak

| TrainingPeaks Field     | PlanMyPeak Field       | Transformation                           |
| ----------------------- | ---------------------- | ---------------------------------------- |
| `exerciseLibraryItemId` | `id`                   | Converted to base-36 string              |
| `itemName`              | `name`                 | Direct copy                              |
| `description`           | `detailed_description` | Merged with `coachComments` when present |
| `tssPlanned`            | `base_tss`             | Direct copy                              |
| `totalTimePlanned`      | `base_duration_min`    | Converted from hours to minutes          |
| `ifPlanned`             | `type`, `intensity`    | Inferred from IF value                   |
| `structure`             | `structure`            | Transformed (see below)                  |

### Structure Transformation

**Removed from TrainingPeaks:**

- `polyline` array (visualization data)
- `begin` and `end` timestamps on structure blocks

**Added to PlanMyPeak:**

- `type` field on targets (`"power"`)
- `unit` field on targets (`"percentOfFtp"`)
- Top-level metadata: `suitable_phases`, `signature`, `source_file`

**Example:**

```typescript
// TrainingPeaks target
{
  "minValue": 40,
  "maxValue": 50
}

// PlanMyPeak target
{
  "type": "power",
  "minValue": 40,
  "maxValue": 50,
  "unit": "percentOfFtp"
}
```

---

## Usage

### Basic Export

```typescript
import { planMyPeakAdapter } from '@/export/adapters/planMyPeak';
import type { LibraryItem } from '@/types';

async function exportWorkouts(tpWorkouts: LibraryItem[]) {
  // 1. Transform
  const pmpWorkouts = await planMyPeakAdapter.transform(tpWorkouts, {});

  // 2. Validate
  const validation = await planMyPeakAdapter.validate(pmpWorkouts);
  if (!validation.isValid) {
    console.error('Validation errors:', validation.errors);
    return;
  }

  // 3. Export to JSON file
  const result = await planMyPeakAdapter.export(pmpWorkouts, {
    fileName: 'my_workouts',
  });

  // 4. Download
  if (result.success && result.fileUrl) {
    const link = document.createElement('a');
    link.href = result.fileUrl;
    link.download = result.fileName;
    link.click();
  }
}
```

### With Configuration

```typescript
const pmpWorkouts = await planMyPeakAdapter.transform(tpWorkouts, {
  // Custom defaults for workout classification
  defaultWorkoutType: 'tempo',
  defaultIntensity: 'moderate',
  defaultSuitablePhases: ['Base', 'Build'],

  // Export options
  fileName: 'my_custom_export',
  includeMetadata: true,
});
```

---

## Configuration Options

### `PlanMyPeakExportConfig`

```typescript
interface PlanMyPeakExportConfig {
  /** Output file name (without extension) */
  fileName?: string;

  /** Whether to include metadata in export */
  includeMetadata?: boolean;

  /** Default workout type if not specified */
  defaultWorkoutType?: WorkoutType;

  /** Default intensity if not specified */
  defaultIntensity?: IntensityLevel;

  /** Default suitable phases */
  defaultSuitablePhases?: TrainingPhase[];
}
```

### Workout Type Inference

If not specified in config, workout types are inferred from Intensity Factor (IF):

| IF Range | Workout Type |
| -------- | ------------ |
| ≥ 1.05   | `vo2max`     |
| ≥ 0.95   | `threshold`  |
| ≥ 0.85   | `tempo`      |
| ≥ 0.70   | `endurance`  |
| < 0.70   | `recovery`   |

### Intensity Level Inference

| IF Range | Intensity Level |
| -------- | --------------- |
| ≥ 1.05   | `very_hard`     |
| ≥ 0.95   | `hard`          |
| ≥ 0.85   | `moderate`      |
| ≥ 0.70   | `easy`          |
| < 0.70   | `very_easy`     |

### Training Phases

Suitable training phases are inferred from workout type:

| Workout Type          | Suitable Phases |
| --------------------- | --------------- |
| `vo2max`, `anaerobic` | Build, Peak     |
| `threshold`           | Build, Peak     |
| `tempo`               | Base, Build     |
| `endurance`           | Base, Build     |
| `recovery`            | Recovery        |

---

## Validation

The adapter performs comprehensive validation:

### Required Fields

- `name` - Must not be empty
- `structure` - Must contain at least one block
- `base_duration_min` - Should be > 0
- `base_tss` - Should be ≥ 0

### Schema Validation

All fields are validated against Zod schemas to ensure type safety:

```typescript
const validation = await planMyPeakAdapter.validate(workouts);

if (!validation.isValid) {
  console.error('Errors:', validation.errors);
  // [{
  //   field: 'workouts[0].name',
  //   message: 'Workout name is required',
  //   severity: 'error'
  // }]
}

if (validation.warnings.length > 0) {
  console.warn('Warnings:', validation.warnings);
  // [{
  //   field: 'workouts[0].base_tss',
  //   message: 'TSS should not be negative',
  //   severity: 'warning'
  // }]
}
```

---

## Current Integration Surface

The active PlanMyPeak integration now lives in the background API client:

- `src/background/api/planMyPeak.ts`
- `tests/unit/background/api/planMyPeak.test.ts`

That code path is what the popup and export flows actually use.

---

## Site-Control Channel (PlanMyPeak → Extension)

The PlanMyPeak web app can drive the extension directly: detect that it is
installed, read the coach's TrainingPeaks libraries, workouts and training
plans through it, and open the import overlay on the page.

### Transport

The page posts a message on its own window; a content script
(`src/content/siteControlBridge.ts`), injected only on PlanMyPeak origins,
validates it and relays it to the background worker. Responses come back the
same way. The web app needs no knowledge of the extension ID.

### Rules the channel enforces

- **Origin.** Only origins in `PLANMYPEAK_CONTROL_ORIGINS` are served — the
  two first-party deployments, `https://portal.planmypeak.com` and
  `https://staging.app.planmypeak.com`, plus the local dev origins in
  local-target builds. Both first-party origins are served by every build
  regardless of the environment selected in Settings. Checked in the content
  script _and_ re-checked in the background against `sender.origin`, which the
  page cannot forge.
- **Silence for everyone else.** A non-allowlisted origin gets _no response at
  all_, not an error. Treat "no response within your timeout" as "extension not
  available" — this is the supported way to feature-detect.
- **Top-level only.** An allowlisted portal embedded as a frame inside another
  site is not treated as a control surface.
- **Closed request list.** The page names _site-control_ request types, never
  internal `RuntimeMessage` types. Anything outside the list below is refused.
- **No credentials, ever.** No response, notification, or error message
  contains a TrainingPeaks token, PlanMyPeak token, Supabase key, or
  Intervals.icu API key.

### Envelope

Page → extension:

```ts
{
  source: 'planmypeak-site-control',
  version: 1,               // PLANMYPEAK_SITE_CONTROL_VERSION
  requestId: string,        // your id, echoed back verbatim
  type: SiteControlRequestType,
  payload: object,          // may be omitted for no-argument requests
}
```

Extension → page:

```ts
{ source: 'planmypeak-extension', version: 1, requestId, ok: true,  data }
{ source: 'planmypeak-extension', version: 1, requestId, ok: false, error: { code, message } }
```

Error codes: `INVALID_REQUEST`, `UNSUPPORTED_REQUEST_TYPE`,
`UNSUPPORTED_VERSION`, `AUTH_REQUIRED`, `API_ERROR`, `INTERNAL_ERROR`.
`AUTH_REQUIRED` means the coach is not signed in to TrainingPeaks — prompt them
rather than retrying.

### Request types

| Type                                 | Payload                                  | `data` on success                                                                                                                                              |
| ------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PING`                               | —                                        | `{ protocolVersion, extensionVersion, supports, trainingPeaks: { authenticated }, planMyPeak: { authenticated, coachId } }`                                    |
| `GET_LIBRARIES`                      | —                                        | `Library[]`                                                                                                                                                    |
| `GET_LIBRARY_ITEMS`                  | `{ libraryId: number }`                  | `LibraryItem[]`                                                                                                                                                |
| `GET_TRAINING_PLANS`                 | —                                        | `TrainingPlan[]`                                                                                                                                               |
| `GET_TRAINING_PLAN_LIBRARIES`        | —                                        | `{ id, name, planIds }[]`                                                                                                                                      |
| `GET_PLAN_CONTENTS`                  | `{ planId: number }`                     | `{ planId, workouts, notes, events, rxWorkouts }`                                                                                                              |
| `GET_ATHLETE_GROUPS`                 | —                                        | `AthleteGroup[]`                                                                                                                                               |
| `OPEN_IMPORTER`                      | `{ libraryId?, planId?, groups?, tab? }` | `{ opened: boolean, focused: boolean }`                                                                                                                        |
| `GET_CAPTURED_WORKOUT_SUMMARY`       | —                                        | `{ contextId, coachId, revision, state, missingCount, unlinkedCount, blockedReason?, activeOperation, latestOperation }`                                       |
| `IMPORT_MISSING_WORKOUTS`            | `{ contextId, operationId }` (strict)    | `{ operationId, state, blockedReason? }`                                                                                                                       |
| `GET_CAPTURED_WORKOUT_IMPORT_STATUS` | `{ contextId, operationId }` (strict)    | `{ operationId, contextId, state, totalCount, processedCount, importedCount, alreadyPresentCount, failedCount, blockedReason?, errors, startedAt, updatedAt }` |

`GET_TRAINING_PLANS` is validated row by row: a plan whose shape the extension
cannot read is left out of the array rather than failing the whole request, so
the list is best-effort and can be one plan short of TrainingPeaks. A plan's
`startDate` and `endDate` are `null` when it was never placed on a calendar (an
unscheduled template, an off-the-shelf plan), so render the range as optional —
such a plan is still importable, its weeks coming from its own sessions.

`GET_PLAN_CONTENTS` fetches all four legs of a plan in one round trip and fails
as a whole if any leg fails, so a partially-loaded plan never renders as a
complete one. `OPEN_IMPORTER` focuses an already-open overlay rather than
mounting a second one (`focused: true`); `opened` is `true` in both cases, so
read success from `ok` and treat `focused` as informational.
`OPEN_IMPORTER` with `groups: true` opens the overlay on its athlete-groups tab.

`tab` (`'libraries' | 'plans' | 'groups'`) says which tab to open on **when
nothing is pre-selected**. It is a hint, not an instruction: a pre-selected
library, plan or group already names what the coach is here for and always
wins over it. Use it when the page knows the context but has nothing specific
to pre-select — an "Import from TrainingPeaks" button on a plans page — so the
coach does not land on Workout Libraries regardless of where they pressed.

Precedence: `groups` → `planId` → `libraryId` → `tab` → Workout Libraries.

Unrecognised payload keys are **ignored, never rejected**, so sending `tab` to
a build that predates it degrades to the default tab rather than failing the
request. That holds for any additive payload field, with one deliberate
exception: `IMPORT_MISSING_WORKOUTS` and `GET_CAPTURED_WORKOUT_IMPORT_STATUS`
are strict and answer `INVALID_REQUEST` to any extra key, because the only
keys a page could usefully add there (`coachId`, `libraryId`, `destination`)
are exactly the ones it must never be able to choose.

`GET_ATHLETE_GROUPS` takes no arguments on purpose: the coach whose groups are
returned is resolved in the background from the captured TrainingPeaks session,
never from a page-supplied id, so an allowlisted page cannot read another
coach's groups by guessing one.

### Reading the auth answers

`trainingPeaks.authenticated` and `planMyPeak.authenticated` are **asymmetric**,
and the page must treat them that way:

- `false` is reliable — no usable credential is stored, so nothing can be
  written. Do not offer the import.
- `true` is weak — it means a token exists, not that it is valid. It is
  consistent with an expired token, a revoked token, or a token belonging to a
  different coach. Never read it as a guarantee that a write will land, or that
  it will land in the expected account. Judge the outcome from
  `IMPORT_COMPLETED`'s counts, never from the probe.

`planMyPeak.coachId` is the opaque id of the PlanMyPeak coach the extension is
acting as, or `null` when it could not be resolved.

**Why it exists.** The extension's PlanMyPeak session and the page's are
independent and can belong to different coaches — a real case on shared or
agency machines. Every write lands in the account the extension's token
belongs to, so an import in that state does not fail: it succeeds
into the wrong account, and the coach who clicked sees nothing change on their
own page. Comparing this id against the page's signed-in coach is the only way
to catch it.

**Gate fail-closed.** `null` means unknown, never "matches":

```js
const coachId = ping?.data?.planMyPeak?.coachId ?? null;
const sameCoach = coachId !== null && coachId === currentCoachId;
if (!sameCoach) {
  // Refuse, and say the importer is signed in to a different PlanMyPeak
  // account — do not start an import that would land somewhere else.
}
```

No credential is exposed here. An account id identifies whose data is in play
and cannot be used to authenticate; the coach's email and name are not sent.

The lookup is bounded and cached per token, so `PING` stays fast enough for
detection: if the profile call is slow or unreachable, `coachId` comes back
`null` rather than delaying the reply.

### Grouping plans into their libraries

`GET_TRAINING_PLAN_LIBRARIES` returns the coach's plan libraries in
TrainingPeaks' own shape. Membership lives on the **library** as `planIds`, not
on the plan, so `TrainingPlan` carries no library reference — that field would
have to be synthesised, and `GET_TRAINING_PLANS` stays the verbatim
TrainingPeaks response.

Group with the same rule the extension uses, or the two surfaces will show the
same plans differently:

1. Take libraries in the order returned.
2. Skip a plan already claimed by an earlier library, so it appears exactly
   once even if the API reports it in two.
3. Put plans in no library into an "Ungrouped" bucket rather than hiding them —
   a plan that belongs to nothing must still be reachable.

A library with an empty `planIds` is a real thing a coach made, so show it —
and say it is empty, rather than rendering a blank section that reads as a
failure to load.

A library naming a plan id that no plan in `GET_TRAINING_PLANS` matches — one
deleted upstream, or filtered out — contributes nothing: filter the plans, not
the ids. A library can therefore come back empty for that reason too, and is
still kept.

The popup and the import overlay both group through one shared helper
(`groupPlansByFolder`), which is the rule above.

### Feature detection

`PING`'s `supports` lists the request types this build actually serves. It is
additive within a protocol version, so the page should feature-detect rather
than compare versions:

```js
const canImportGroups =
  ping?.data?.supports?.includes('GET_ATHLETE_GROUPS') ?? false;
```

Builds older than this field omit it entirely, which the `?? false` reads as
"not supported" — the correct answer for every type added after them.

### Captured-workout imports

The extension keeps a local copy of workouts a coach creates on a TrainingPeaks
athlete calendar. Three requests let the page tell the coach that some of those
are missing from their PlanMyPeak library and import them, without the page
ever seeing a capture.

What the page gets is **counts, opaque handles and progress**. It never gets a
workout id, an athlete id, a workout body, or a storage key, and it cannot
submit, edit, dismiss, delete or link a capture: those remain extension-internal
messages that the channel answers with `UNSUPPORTED_REQUEST_TYPE`.

Feature-detect all three before showing any of this UI:

```js
const supports = ping?.data?.supports ?? [];
const canImportCaptures = [
  'GET_CAPTURED_WORKOUT_SUMMARY',
  'IMPORT_MISSING_WORKOUTS',
  'GET_CAPTURED_WORKOUT_IMPORT_STATUS',
].every((type) => supports.includes(type));
```

The exact wire shapes are pinned in
`tests/fixtures/siteControl/captured-imports.json`, mirrored verbatim in the
PlanMyPeak app. A change to that file is a protocol change and must land in
both repositories.

#### `GET_CAPTURED_WORKOUT_SUMMARY`

Takes no payload. The account is resolved from the extension's stored
PlanMyPeak session and the page's verified origin.

| Field                                 | Meaning                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`                               | `ready`, `checking` or `blocked`                                                                                                                        |
| `missingCount`                        | A number only when `ready`; otherwise `null`. **`null` is not zero.**                                                                                   |
| `unlinkedCount`                       | Pending captures no PlanMyPeak account owns yet. They are not in `missingCount`; the coach links them from the extension popup (New Workouts tab).      |
| `contextId`                           | Opaque handle for (this PlanMyPeak site, this coach). Hand it back unchanged. `null` when `blocked`.                                                    |
| `coachId`                             | The coach the extension is acting as, the same value `PING` reports.                                                                                    |
| `revision`                            | Counter that increases whenever captures or import operations change. Compare two polls to know whether to refetch; it says nothing about what changed. |
| `activeOperation` / `latestOperation` | `{ operationId, state }` or `null`, so a second tab can attach to a running import and a reloaded page can show the last result.                        |
| `blockedReason`                       | Present when `blocked`; see below.                                                                                                                      |

A capture is **missing** when it belongs to this coach on this PlanMyPeak
site, was not dismissed, has not been acknowledged for this site, and its
exact provider identity (`cal:{workoutId}`, or `cal-sandbox:{workoutId}` for
the TrainingPeaks sandbox) is in none of the coach's libraries. Title matches
never count, and neither does a send to another PlanMyPeak site: a capture
imported into staging is still missing from production until it is found or
imported there. A capture found already present is acknowledged by the
extension and leaves the count for good.

`checking` means the scan did not finish inside the extension's 2.5 s budget.
It continues in the background; poll again and the next answer comes from its
cache. A lookup that fails produces an **error response** (`API_ERROR`), never
`missingCount: 0`.

#### `IMPORT_MISSING_WORKOUTS`

Payload `{ contextId, operationId }`. `contextId` comes from the summary;
`operationId` is minted by the page (any unique non-empty string) and makes the
request idempotent:

- The same `operationId` again names the same run and returns its current state.
- A different `operationId` while an import is running **attaches to the running
  one**: the response carries the running operation's id, which is the one to
  poll. Always poll the `operationId` in the response, not the one you sent.
- An `interrupted` run asked for again under its own id is retried. What had
  already landed is not uploaded twice.

The response is an acknowledgement, not a result: `running` (poll for
progress), `completed` (there was nothing to import) or `blocked`. The import
itself runs in the extension's background worker and survives the page
navigating away.

Workouts go to the coach's default library, through the same upload path as
every other import from the extension.

#### `GET_CAPTURED_WORKOUT_IMPORT_STATUS`

Payload `{ contextId, operationId }`. Counts always satisfy
`importedCount + alreadyPresentCount + failedCount === processedCount` and
`processedCount <= totalCount`.

| `state`       | Meaning                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `running`     | In progress; keep polling.                                                                                   |
| `completed`   | Finished. `failedCount` may still be above zero.                                                             |
| `blocked`     | Stopped before or during the run; `blockedReason` says why. Workouts imported before the stop stay imported. |
| `interrupted` | The extension's worker was restarted mid-run. Offer a retry with the same `operationId`.                     |

`errors` holds at most 20 `{ title, message }` entries: the workout title the
coach typed and a failure message capped at 300 characters. Treat both as plain
text.

An unknown operation, or a `contextId` that no longer matches the extension's
account, is an `INVALID_REQUEST` error. Only the running and the most recent
finished operation are kept per context.

#### Blocked reasons

| `blockedReason`        | What to tell the coach                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `connection_disabled`  | Turn the PlanMyPeak connection on in the extension settings.                                          |
| `signed_out`           | The extension has no PlanMyPeak session; refresh it from the popup.                                   |
| `account_unknown`      | The extension could not confirm which coach it is; try again.                                         |
| `destination_mismatch` | The extension is configured for a different PlanMyPeak environment than this page.                    |
| `account_mismatch`     | The TrainingPeaks account in the browser is linked to a different PlanMyPeak coach (production only). |
| `stale_context`        | The account or environment changed since the summary; fetch a new summary and discard the old state.  |
| `account_changed`      | The account or environment changed while the import was running; it stopped.                          |

Still compare `coachId` with the page session yourself, as for every other
import: the extension refuses what it can detect, and the page is the only side
that knows who is signed in to the page.

### Import completion notification

When an import started from an `OPEN_IMPORTER` request finishes, the extension
posts an unsolicited event carrying counts only:

```ts
{
  source: 'planmypeak-extension',
  version: 1,
  type: 'IMPORT_COMPLETED',
  requestId,                                  // the OPEN_IMPORTER request id
  payload: {
    ok: boolean,
    importedCount: number,          // total across kinds
    failedCount: number,            // failed containers across kinds
    byKind: {
      libraries: { imported: number, failed: number },  // imported = workouts
      plans:     { imported: number, failed: number },  // imported = workouts
      groups:    { imported: number, failed: number },  // imported = groups
    },
  },
}
```

**The two totals are in different units.** `importedCount` counts workouts (and
groups, for groups), while `failedCount` counts failed _containers_ — a library
of fifty workouts that fails entirely is `failedCount: 1`, not 50. Never render
them as a comparable pair.

**Prefer `byKind` whenever the selection could span kinds.** The overlay's tabs
stay switchable and the selection accumulates across them, so a coach can reach
a mixed selection from any single-kind `OPEN_IMPORTER` — at which point
`importedCount` sums workouts and groups into a total in no unit at all.
`byKind` is additive, so fall back to the totals when it is absent.

Use it to refresh the portal's own view of the coach's libraries.

### The import overlay

`OPEN_IMPORTER` mounts a React overlay into a shadow root on the PlanMyPeak
page (`src/content/overlay/`). It is loaded with a dynamic `import()`, so pages
that never open it do not pay for React or the export machinery. Imports run
through the same PlanMyPeak adapter, duplicate preflight
(`Replace` / `Append` / `Ignore Upload`) and progress reporting as the popup, so
overlay imports and popup imports produce equivalent PlanMyPeak content.

---

## Real API Integration (Future)

When PlanMyPeak expands its API surface, extend `src/background/api/planMyPeak.ts`:

```typescript
// TODO: Replace with real API implementation
export async function uploadWorkout(
  workout: PlanMyPeakWorkout
): Promise<UploadWorkoutResponse> {
  const response = await fetch('https://api.planmypeak.com/workouts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(workout),
  });

  return await response.json();
}
```

---

## Testing

Comprehensive unit tests are provided:

```bash
# Run PlanMyPeak adapter tests
npm run test:unit tests/unit/export/adapters/planMyPeak

# Run with coverage
npm run coverage
```

### Test Coverage

- ✅ Transformation logic (workout types, intensity, phases)
- ✅ Structure transformation (remove polyline, add target types)
- ✅ Duration and TSS calculations
- ✅ Validation (schema, business rules)
- ✅ Export functionality (JSON file generation)
- ✅ End-to-end workflow (transform → validate → export)

---

## Example Workouts

See `workout_examples/` directory for sample workouts:

- `tp_30sx4m_interval_repeats.json` - TrainingPeaks format
- `workout_library_30sx4m_interval_repeats.json` - PlanMyPeak format

These examples show the exact data structure transformations.

---

## Architecture

### Adapter Pattern

The PlanMyPeak adapter implements the `ExportAdapter` interface:

```typescript
interface ExportAdapter<TConfig, TOutput> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly supportedFormats: string[];

  transform(items: LibraryItem[], config: TConfig): Promise<TOutput>;
  validate(output: TOutput): Promise<ValidationResult>;
  export(output: TOutput, config: TConfig): Promise<ExportResult>;
}
```

This allows for easy addition of new export destinations (Zwift, Garmin, TrainerRoad, etc.) without modifying core logic.

### Files

```
src/export/adapters/planMyPeak/
├── PlanMyPeakAdapter.ts    # Main adapter implementation
├── transformer.ts          # Transformation logic
├── example.ts              # Usage examples
└── index.ts                # Public exports
```

---

## Troubleshooting

### Validation Errors

**Problem**: "Workout name is required"
**Solution**: Ensure all workouts have non-empty `itemName` in TrainingPeaks data

**Problem**: "Workout must have at least one structure block"
**Solution**: Check that `structure.structure` array is not empty

### Type Errors

**Problem**: TypeScript errors when importing
**Solution**: Ensure `@/types/planMyPeak.types` is imported correctly

### Export Issues

**Problem**: File download not working
**Solution**: Ensure you're calling this in a browser context with DOM access

---

## Future Enhancements

- [ ] Direct upload to PlanMyPeak API (when available)
- [ ] Batch processing with progress tracking
- [ ] Custom mapping rules for workout types
- [ ] Support for additional metadata fields
- [ ] Export presets (save configurations)
- [ ] Export history tracking

---

## Related Documentation

- [Issue #51: Export Libraries & Workouts](https://github.com/PlanMyPeak/cycling_coach_browser_plugin/issues/51)
- [CLAUDE.md](./CLAUDE.md) - Project development guide
- [TESTING.md](./TESTING.md) - Testing guide

---

**Questions?** See `tests/unit/background/api/planMyPeak.test.ts`
