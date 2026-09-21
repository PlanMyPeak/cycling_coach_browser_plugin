# Intervals.icu Mapping Specification (TrainingPeaks -> Intervals.icu)

Status: Draft for review (spec only, no code changes)

Date: 2026-02-24

Owner: Intervals.icu integration redesign (Issue #75)

## 1. Purpose

Define a strict, testable mapping from TrainingPeaks workout data to Intervals.icu workout library templates.

This spec covers:

- confirmed TrainingPeaks type ID table (project source-of-truth for TP type taxonomy)
- Intervals.icu target type table (exact API strings)
- field-by-field transformation rules
- structured-workout conversion decision tree (description text vs `zwo` vs `workout_doc` vs metadata fallback)

This spec is intentionally conservative:

- It prefers officially documented Intervals.icu API behavior
- It treats native textual workout syntax in `description` as the primary structured export path because Intervals.icu uses a text workout editor in the UI
- It treats opaque `workout_doc` JSON as an advanced mode

## 2. Sources of Truth

### 2.1 Intervals.icu API (authoritative)

- OpenAPI docs endpoint: `https://intervals.icu/api/v1/docs`
- `/api/v1/athlete/{id}/workouts` description explicitly states it accepts:
  - native Intervals.icu workout format in `description`
  - `zwo`, `mrc`, `erg`, `fit` via `file_contents` / `file_contents_base64`
- `WorkoutEx` is the POST schema for `/workouts`
- `WorkoutEx.workout_doc` is present but schema is opaque (`object`)
- `WorkoutEx.type` is a free string in the schema, so canonical values must come from the sport enum (`SportInfo.type`)

### 2.2 Intervals.icu forum guidance (supporting)

- API cookbook confirms `/athlete/0` is valid for current-athlete lookup and gives examples for workout creation
- Planned workouts thread and UI examples reinforce that Intervals.icu uses textual workout definitions in the editor
- Community examples (including `tp2intervals`) show practical TP structure -> Intervals text-script conversion in `description`

### 2.3 TrainingPeaks type IDs in this project (project source-of-truth)

Confirmed local mapping exists in `src/popup/components/CalendarDayCell.tsx` for TrainingPeaks `workoutTypeValueId`:

- `1=Swim`, `2=Bike`, `3=Run`, `9/29=Strength`, `11=XC-Ski`, `12=Rowing`, `13=Walk`, etc.

Important note:

- `LibraryItem.workoutTypeId` and `PlanWorkout.workoutTypeValueId` are assumed to share the same TP taxonomy for this spec.
- This must be validated once with real `LibraryItem` payload samples and then locked in tests.

## 3. Confirmed TrainingPeaks Type ID Table (Project TP Taxonomy)

Source: `src/popup/components/CalendarDayCell.tsx`

This table is the plugin's current TP type taxonomy reference and should be used as the source-of-truth for mapping logic unless real `LibraryItem` payloads prove otherwise.

| TP Type ID | TrainingPeaks Label (project) | Confirmation Source        |
| ---------- | ----------------------------- | -------------------------- |
| 1          | Swim                          | `CalendarDayCell` icon map |
| 2          | Bike                          | `CalendarDayCell` icon map |
| 3          | Run                           | `CalendarDayCell` icon map |
| 4          | Brick                         | `CalendarDayCell` icon map |
| 5          | Crosstrain                    | `CalendarDayCell` icon map |
| 6          | Race                          | `CalendarDayCell` icon map |
| 7          | Day Off                       | `CalendarDayCell` icon map |
| 8          | Mountain Bike                 | `CalendarDayCell` icon map |
| 9          | Strength                      | `CalendarDayCell` icon map |
| 10         | Custom                        | `CalendarDayCell` icon map |
| 11         | XC-Ski                        | `CalendarDayCell` icon map |
| 12         | Rowing                        | `CalendarDayCell` icon map |
| 13         | Walk                          | `CalendarDayCell` icon map |
| 29         | Strength (duplicate)          | `CalendarDayCell` icon map |
| 100        | Other                         | `CalendarDayCell` icon map |

Validation gate before code rollout:

- Capture and store redacted `LibraryItem` examples for at least bike/run/swim/strength/walk (or row/ski) and confirm `workoutTypeId` matches this table.

## 4. Intervals.icu Type Table (Canonical API Strings)

Source: OpenAPI `SportInfo.type` enum (`/api/v1/docs`)

The integration only needs a subset today, but mapping must use exact enum strings.

### 4.1 Core types used by this integration

| Intervals Type   | Use                                                          |
| ---------------- | ------------------------------------------------------------ |
| `Ride`           | Road/general cycling workouts                                |
| `Run`            | Running workouts                                             |
| `Swim`           | Pool/open-water workouts when generic swim mapping is needed |
| `WeightTraining` | Strength/weights templates                                   |
| `Walk`           | Walking workouts                                             |
| `Rowing`         | Rowing workouts                                              |
| `NordicSki`      | XC ski / nordic ski                                          |
| `Other`          | Safe fallback for unsupported/unknown TP types               |

### 4.2 Additional valid types (not required for MVP but valid)

Examples from enum include `MountainBikeRide`, `TrailRun`, `OpenWaterSwim`, `GravelRide`, `VirtualRide`, `VirtualRun`, `Workout`, etc.

Policy:

- Start with stable generic types above.
- Do not overfit TP IDs to specialized Intervals types without explicit user value and tests.

## 5. TP -> Intervals Sport Type Mapping (Strict Rules)

This mapping replaces the current incorrect hardcoded table in:

- `src/background/api/intervalsicu.ts`
- `src/utils/constants.ts`

### 5.1 Mapping table

| TP Type ID | TP Label       | Intervals Type   | Rule Type         | Notes                                                         |
| ---------- | -------------- | ---------------- | ----------------- | ------------------------------------------------------------- |
| 1          | Swim           | `Swim`           | direct            | Fixes current run/swim inversion                              |
| 2          | Bike           | `Ride`           | direct            | Generic cycling                                               |
| 3          | Run            | `Run`            | direct            | Fixes current run/swim inversion                              |
| 4          | Brick          | `Other`          | fallback-specific | Multi-sport brick not represented as one library workout type |
| 5          | Crosstrain     | `Other`          | fallback-specific | Generic crosstrain                                            |
| 6          | Race           | `Other`          | fallback-specific | Event concept, not template sport                             |
| 7          | Day Off        | `Other` or skip  | policy-based      | Prefer skip in batch exports if user enables "skip rest days" |
| 8          | Mountain Bike  | `Ride`           | normalized        | Could later upgrade to `MountainBikeRide`                     |
| 9          | Strength       | `WeightTraining` | direct            | Strength template                                             |
| 10         | Custom         | `Other`          | fallback-specific | Unknown custom                                                |
| 11         | XC-Ski         | `NordicSki`      | normalized        | Exact enum available                                          |
| 12         | Rowing         | `Rowing`         | direct            | Exact enum available                                          |
| 13         | Walk           | `Walk`           | direct            | Current code incorrectly maps 13 to strength                  |
| 29         | Strength (dup) | `WeightTraining` | direct            | Duplicate strength code                                       |
| 100        | Other          | `Other`          | direct            | Explicit other                                                |
| unknown    | Unknown        | `Other`          | default           | Never default to `Ride`                                       |

### 5.2 Non-negotiable mapping policies

- Unknown TP type IDs must map to `Other`, not `Ride`.
- `13` must map to `Walk`, not `WeightTraining`.
- Strength must include both `9` and `29`.
- Run/Swim must not be inverted.

## 6. Field-by-Field Transformation Rules (LibraryItem -> WorkoutEx)

Target endpoint: `POST /api/v1/athlete/{id}/workouts`

Target request schema: `WorkoutEx` (OpenAPI)

### 6.1 Required/primary output fields

| TrainingPeaks Source                    | Intervals Field | Rule                                                                                                                    |
| --------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `itemName`                              | `name`          | Trim whitespace; fallback to `"Untitled Workout {exerciseLibraryItemId}"` if empty                                      |
| `workoutTypeId`                         | `type`          | Use TP->Intervals mapping table in Section 5                                                                            |
| (constant)                              | `category`      | Not in current `WorkoutEx` OpenAPI schema, but safe to include if API accepts; otherwise omit for `/workouts` templates |
| export context (folder creation result) | `folder_id`     | Include only when folder creation succeeded and user selected folder organization                                       |

Note:

- `/workouts` OpenAPI schema does not require `category`; templates are already "workouts". Keep this optional in implementation to avoid schema mismatch risk.

### 6.2 Duration/load/intensity fields

| TrainingPeaks Source               | Intervals Field     | Transform                                     | Validation Rule                                   |
| ---------------------------------- | ------------------- | --------------------------------------------- | ------------------------------------------------- |
| `totalTimePlanned` (decimal hours) | `moving_time`       | `round(hours * 3600)`                         | Include only if > 0                               |
| `tssPlanned`                       | `icu_training_load` | direct numeric copy                           | Include only if > 0                               |
| `ifPlanned`                        | `icu_intensity`     | optional direct copy (future)                 | Only include when confirmed desired for templates |
| `distancePlanned`                  | `distance`          | defer native mapping unless unit is confirmed | Do not map natively yet (unit ambiguity)          |

Rationale:

- `moving_time` and `icu_training_load` are already high confidence.
- `distancePlanned` unit in TP data is not consistently documented in current code/tests, so native `distance` mapping is deferred until unit is confirmed.

### 6.3 Description and notes (text-first strategy)

Intervals.icu uses a textual workout editor in the UI. Therefore:

- The integration must always produce a readable textual workout body.
- Structured payload modes (`zwo` / `workout_doc`) do not eliminate the need for human-readable notes.

Define description content as:

1. Workout script (Intervals text syntax) when generated
2. Blank line
3. Notes section (TP description + coach comments)
4. Blank line
5. Metadata footer (IF, distance, elevation, calories, pace, TP IDs)

#### 6.3.1 Notes section assembly

| TrainingPeaks Source | Description Output Rule                          |
| -------------------- | ------------------------------------------------ |
| `description`        | Primary notes paragraph                          |
| `coachComments`      | Append under `Coach Notes:` heading if non-empty |

#### 6.3.2 Metadata footer (always safe, textual)

Include only non-null values:

- `TP Library Item ID: {exerciseLibraryItemId}`
- `TP Library ID: {exerciseLibraryId}`
- `IF: {ifPlanned.toFixed(2)}`
- `Duration: {moving_time}s` (optional if no script generated)
- `Distance (TP raw): {distancePlanned}`
- `Elevation Gain: {elevationGainPlanned} m`
- `Calories: {caloriesPlanned}`
- `Velocity/Pace (TP raw): {velocityPlanned}`
- `Energy (TP raw): {energyPlanned}`

Policy:

- Mark ambiguous unit fields as `TP raw` until units are confirmed.

### 6.4 Fields intentionally not mapped natively (current spec)

| TrainingPeaks Source                   | Status      | Reason                                                        |
| -------------------------------------- | ----------- | ------------------------------------------------------------- |
| `structure`                            | conditional | Mapped via decision tree (Section 7), not direct scalar field |
| `exerciseLibraryItemType`              | ignore      | No Intervals equivalent for template semantics                |
| `distancePlanned` -> `distance`        | deferred    | TP unit ambiguity                                             |
| `velocityPlanned` -> pace/speed fields | deferred    | Unit and sport semantics ambiguous                            |
| `energyPlanned` -> `joules`            | deferred    | Unit mismatch risk (kJ/calories ambiguity)                    |
| `caloriesPlanned` -> `joules`          | deferred    | Not equivalent                                                |
| `elevationGainPlanned` -> native field | deferred    | Workout template `WorkoutEx` is not activity result data      |

### 6.5 Fields available in WorkoutEx but not used by default

These should remain opt-in until product behavior is specified:

- `indoor`
- `color`
- `tags`
- `sub_type`
- `target` / `targets` (`AUTO`, `POWER`, `HR`, `PACE`)
- `carbs_per_hour`
- `hide_from_athlete`
- `time`

## 7. Structured Workout Conversion Decision Tree (description text vs `zwo` vs `workout_doc` vs metadata fallback)

This section defines how to choose the payload mode when TP workout structure is present.

### 7.1 Inputs to the decision

- sport type (`workoutTypeId` -> Intervals type)
- TP structure presence (`LibraryItem.structure`)
- TP structure complexity (repeats, nested blocks, target types)
- converter availability (Intervals text-script renderer, ZWO generator, `workout_doc` serializer)
- parser compatibility confidence

### 7.2 Decision tree (strict)

```text
START
  |
  |-- Is structured data present? (LibraryItem.structure for classic TP workout)
  |      |
  |      |-- NO --> Metadata+notes description mode (no structured script)
  |      |
  |      `-- YES
  |            |
  |            |-- Can render Intervals textual workout script in description?
  |            |      |
  |            |      |-- YES --> Description text mode (primary structured path)
  |            |      |
  |            |      `-- NO
  |            |            |
  |            |            |-- Sport maps to Ride or Run?
  |            |      |
  |            |            |      |-- YES
  |            |            |      |     |
  |            |            |      |     |-- Can convert TP structure to ZWO losslessly enough?
  |            |            |      |     |      |
  |            |            |      |     |      |-- YES --> ZWO mode (secondary structured path)
  |            |            |      |     |      |
  |            |            |      |     |      `-- NO
  |            |            |      |     |             |
  |            |            |      |     |             |-- Can serialize supported subset to workout_doc safely?
  |            |            |      |     |             |      |
  |            |            |      |     |             |      |-- YES --> workout_doc mode (advanced subset path)
  |            |            |      |     |             |      |
  |            |            |      |     |             |      `-- NO --> Metadata+notes description mode
  |            |            |      |
  |            |            |      `-- NO --> Metadata+notes description mode
  |
  `-- (Future) RxBuilder structured strength source available?
         |
         `-- Use description text mode first; add dedicated strength serializer only after format is confirmed
```

### 7.3 Mode definitions

#### Mode A: Description text mode (primary structured path)

Use when:

- TP structure is present and we can render an Intervals-readable textual script
- Any sport where we can preserve intent via text (ride/run/swim/strength/other)
- We want maximum editability in Intervals' native text editor UX

Payload strategy:

- `name`
- `type`
- `folder_id` (optional)
- `description` containing:
  - Intervals textual workout script rendered from TP structure
  - notes / coach comments
  - metadata summary block
- `moving_time` (if available)
- `icu_training_load` (if available)

Why primary:

- Intervals explicitly supports native workout format in `description`
- Aligns with the Intervals text workout editor shown in the UI
- Keeps workouts human-readable and easy to edit after import
- Avoids parser format loss/quirks and avoids opaque `workout_doc` coupling

#### Mode B: ZWO mode (secondary structured path)

Use when:

- Sport is `Ride` or `Run` (if run support is verified for the chosen parser path)
- Text-script rendering is unavailable or lower fidelity than parser conversion for the specific workout
- TP structure uses constructs we can convert reliably to ZWO

Payload strategy:

- `name`
- `type`
- `folder_id` (optional)
- `filename` (e.g., `tp_{exerciseLibraryItemId}.zwo`)
- `file_contents_base64`
- `description` (notes + metadata, and optionally a script preview)

Why secondary:

- Intervals officially documents file parsing support
- Useful when parser fidelity beats our text renderer for a specific workout
- Still avoids relying on opaque `workout_doc` schema

#### Mode C: `workout_doc` mode (advanced, subset-only)

Use when:

- Description text rendering is unavailable/inadequate for a specific structured subset
- ZWO conversion is unavailable/inadequate
- The workout uses a simple subset we can serialize and test
- We have fixture-backed tests proving Intervals accepts the generated `workout_doc`

Payload strategy:

- `name`
- `type`
- `folder_id` (optional)
- `workout_doc` (subset serializer output)
- `description` (notes + metadata)

Restrictions:

- Do not use `workout_doc` as default for all workouts
- Do not emit undocumented fields without fixture-based validation
- Treat `workout_doc` as opaque; only generate fields we explicitly own in tests

#### Mode D: Metadata+notes description mode (fallback, always available)

Use when:

- No TP structure exists
- Structured conversion fails
- We cannot safely render text script, ZWO, or `workout_doc`

Payload strategy:

- `name`
- `type`
- `folder_id` (optional)
- `description` containing notes + metadata (no generated structured script)
- `moving_time`
- `icu_training_load`

Important:

- This is the true fallback path.
- It is lower fidelity than Mode A, but still preserves coach notes and key metadata.

## 8. Classic TP Structure Conversion Rules (for future serializer/converters)

Observed TP classic structure shape (from project tests and transformer code):

- blocks contain `type`, `length`, `steps`
- step entries contain `name`, `intensityClass`, `length`, `targets`
- nested repetition blocks are possible

### 8.1 Convertible subset (MVP for structured conversion)

- step durations in seconds
- repetition counts
- power targets with min/max percentages (`percentOfFtp`)
- warmup / active / rest / cooldown step classes

### 8.2 Non-MVP / fallback triggers

Trigger Mode A (description text mode) when any of the following is present and unsupported by parser/serializer paths:

- unsupported target types (HR/pace combinations not implemented)
- unsupported length units
- deeply nested/complex structures not covered by converter tests
- swim-specific constructs we cannot map safely

## 9. RxBuilder Strength Mapping Rules (spec-first)

Issue #75 requires strength support. Current Intervals export path uses `LibraryItem[]`, while RxBuilder uses a different schema (`RxBuilderWorkout`).

### 9.1 Strength target type

- Intervals type: `WeightTraining`

### 9.2 Initial strength transformation (required baseline)

When exporting RxBuilder workouts (future path):

- `name` <- `title`
- `type` <- `WeightTraining`
- `moving_time` <- `prescribedDurationInSeconds` (if present)
- `description` <- assembled text containing:
  - instructions
  - sequence summary (order + exercise names)
  - total blocks / sets / prescriptions
  - compliance metrics if relevant

### 9.3 Strength structure serialization policy

- Do not emit `workout_doc` for RxBuilder until a tested Intervals-compatible strength structure format is confirmed.
- Use Mode A (description text mode) as the default.

## 10. Required Tests Before Implementation Is Accepted

### 10.1 Sport mapping unit tests

Cover all TP IDs in Section 5.1, especially:

- `1 -> Swim`
- `3 -> Run`
- `9 -> WeightTraining`
- `13 -> Walk`
- `29 -> WeightTraining`
- unknown -> `Other`

### 10.2 Field mapping unit tests

- `moving_time` hours->seconds conversion
- `icu_training_load` copy
- null/zero omission behavior
- description assembly (notes + coach + metadata)
- no fallback to `Ride` for unknown types

### 10.3 Structured conversion decision tests

Test decision outcomes, not just payloads:

- structured ride/run/swim with renderer support -> description text mode (primary)
- ride/run where parser path is explicitly chosen and supported -> `zwo` mode
- unsupported structured bike/run -> `workout_doc` or metadata+notes fallback per capability flags
- strength -> description text mode (if renderer exists) else metadata+notes fallback
- no structure -> metadata+notes fallback

### 10.4 One-time TP library parity validation test/data fixture

Add redacted fixtures from real `LibraryItem` API payloads to prove `workoutTypeId` uses the same TP taxonomy as the plan UI mapping.

## 11. Implementation Notes (Non-code)

- Move sport mapping into a dedicated module (`sportTypeMapper.ts`) with exhaustive tests.
- Remove duplicate `WORKOUT_TYPE_MAP` definitions (`src/background/api/intervalsicu.ts` and `src/utils/constants.ts`).
- Keep the API client focused on request orchestration; mapping and mode selection should live in transformer/mapping modules.

## 12. External Comparison: `freekode/tp2intervals`

This project is a useful implementation reference, but not a drop-in source of truth for this plugin.

### 12.1 Findings that match this spec

- TP type IDs `1/2/3` are treated as `Swim/Bike/Run` (supports correcting the current plugin mapping).
- `TPWorkoutLibraryItemDTO` passes `workoutTypeId` into the same base `workoutTypeValueId` field used by plan workouts, supporting the assumption that library and plan endpoints share a TP type taxonomy.
- Intervals export uses textual workout syntax in `description` (via `ToIntervalsStructureConverter`) rather than relying on `workout_doc`.
- Intervals type mapping is richer than the current plugin implementation (`MountainBikeRide`, `VirtualRide`, `Walk`, `Other`, etc.).

### 12.2 Differences / reasons not to copy as-is

- `TPTrainingTypeMapper` only maps TP strength `9`; it does not cover TP strength `29`.
- The mapper repeats `TrainingType.UNKNOWN` several times in a Kotlin `mapOf(...)`; duplicate keys collapse, so the comments imply broader TP ID coverage than the effective map actually provides.
- It maps TP `8` to `MountainBikeRide` and virtual bike to `VirtualRide`; this spec allows those, but keeps generic core mappings as the default policy until explicitly adopted in this plugin.
- It does not implement `workout_doc` or parser-file (`zwo`) export in the observed converter path (`file_contents` is present in DTO but passed as `null` in the converter).

### 12.3 Spec impact from this comparison

- Promote Intervals textual workout syntax in `description` to the primary structured export path (Mode A).
- Keep `zwo` and `workout_doc` as optional secondary/advanced paths behind capability checks and tests.
- Preserve the stricter TP ID table in Section 3/5 (including `29=Strength`) and avoid duplicate-key mapping patterns.

## 13. References

Project code:

- `src/background/api/intervalsicu.ts`
- `src/utils/constants.ts`
- `src/popup/components/CalendarDayCell.tsx`
- `src/schemas/library.schema.ts`
- `src/schemas/rxBuilder.schema.ts`

Intervals.icu:

- API docs page: `https://intervals.icu/api-docs.html`
- OpenAPI spec: `https://intervals.icu/api/v1/docs`
- API cookbook: `https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090`
- Planned workouts discussion: `https://forum.intervals.icu/t/uploading-planned-workouts-to-intervals-icu/63624`

External comparison:

- `tp2intervals` repository: `https://github.com/freekode/tp2intervals/`
- `TPTrainingTypeMapper.kt`: `https://raw.githubusercontent.com/freekode/tp2intervals/main/boot/src/main/kotlin/org/freekode/tp2intervals/infrastructure/platform/trainingpeaks/workout/TPTrainingTypeMapper.kt`
- `TPWorkoutLibraryItemDTO.kt`: `https://raw.githubusercontent.com/freekode/tp2intervals/main/boot/src/main/kotlin/org/freekode/tp2intervals/infrastructure/platform/trainingpeaks/library/TPWorkoutLibraryItemDTO.kt`
- `TPBaseWorkoutResponseDTO.kt`: `https://raw.githubusercontent.com/freekode/tp2intervals/main/boot/src/main/kotlin/org/freekode/tp2intervals/infrastructure/platform/trainingpeaks/workout/TPBaseWorkoutResponseDTO.kt`
- `IntervalsTrainingTypeMapper.kt`: `https://raw.githubusercontent.com/freekode/tp2intervals/main/boot/src/main/kotlin/org/freekode/tp2intervals/infrastructure/platform/intervalsicu/workout/IntervalsTrainingTypeMapper.kt`
- `ToIntervalsWorkoutConverter.kt`: `https://raw.githubusercontent.com/freekode/tp2intervals/main/boot/src/main/kotlin/org/freekode/tp2intervals/infrastructure/platform/intervalsicu/workout/ToIntervalsWorkoutConverter.kt`
- `ToIntervalsStructureConverter.kt`: `https://raw.githubusercontent.com/freekode/tp2intervals/main/boot/src/main/kotlin/org/freekode/tp2intervals/infrastructure/platform/intervalsicu/workout/ToIntervalsStructureConverter.kt`

Issue tracking:

- Issue #75: `https://github.com/PlanMyPeak/cycling_coach_browser_plugin/issues/75`
- Issue #75 wiki (implementation plan): raw wiki page
- Issue #75 wiki (redesign plan): raw wiki page
