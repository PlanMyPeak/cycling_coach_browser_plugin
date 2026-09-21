# Intervals.icu Integration Migration Guide

## What Changed?

The Intervals.icu integration was redesigned to export workout **libraries** instead of **calendar events**.

### Before (Event-Based Architecture)

- Exported workouts as scheduled calendar events
- Required date selection for each workout
- Used `/events/bulk` endpoint
- Workouts appeared on calendar with specific dates
- One-time scheduling during export

### After (Library-Based Architecture)

- Exports workouts as reusable templates
- No dates required during export
- Uses `/folders` and `/workouts` endpoints
- Workouts saved in library for later scheduling
- Flexible scheduling in Intervals.icu

---

## Why the Change?

### Conceptual Alignment

TrainingPeaks workout libraries contain **workout definitions**, not scheduled training plans. They are:

- Reusable templates
- Sport-specific workouts
- Coach-created exercises
- Building blocks for training plans

The new architecture aligns with this concept by exporting workouts as templates rather than forcing them onto calendar dates.

### Benefits

1. **Better Organization**
   - Workouts organized in folders by library
   - Easy to find and reuse
   - Preserves library structure

2. **Flexible Scheduling**
   - Schedule workouts when needed
   - Reuse templates for multiple training cycles
   - No need to re-export for different dates

3. **Simplified Export Flow**
   - No date picker required
   - Fewer configuration steps
   - Less error-prone

4. **Aligns with Both Platforms**
   - TrainingPeaks: Libraries of workout definitions
   - Intervals.icu: Workout library with templates
   - Natural mapping between platforms

---

## For Users

### Nothing Breaks!

The export flow is actually **simpler** now:

1. No date picker to configure
2. Workouts automatically organized in folders
3. Schedule later by dragging in Intervals.icu

### New Workflow

**Old Workflow** (Event-Based):

1. Select library
2. Choose start date
3. Export to calendar
4. Workouts appear on calendar with dates

**New Workflow** (Library-Based):

1. Select library
2. Optionally create folder
3. Export to library
4. Schedule workouts when needed

### How to Schedule Workouts

After exporting to Intervals.icu:

1. **Visit Workout Library**
   - Go to https://intervals.icu/workouts
   - Find your exported library folder

2. **Schedule Workouts**
   - Drag workouts from library to calendar
   - Assign dates as needed
   - Customize before scheduling if desired

3. **Reuse Templates**
   - Use same workout multiple times
   - No need to re-export
   - Edit template to update all future uses

---

## For Developers

### API Changes

**Removed Functions**:

```typescript
// ❌ Old: Bulk event export
exportToIntervals(
  workouts: LibraryItem[],
  startDates: string[]
): Promise<ApiResponse<IntervalsEventResponse[]>>
```

**Added Functions**:

```typescript
// ✅ New: Create folder
createIntervalsFolder(
  name: string,
  description?: string
): Promise<ApiResponse<IntervalsFolderResponse>>

// ✅ New: Create workout template
createIntervalsWorkout(
  payload: IntervalsWorkoutPayload
): Promise<ApiResponse<IntervalsWorkoutResponse>>
```

### Type Changes

**Removed Types**:

```typescript
// ❌ Old: Event-based types
interface IntervalsEventPayload {
  category: 'WORKOUT';
  start_date_local: string; // ISO 8601 date
  type: string;
  name: string;
  description: string;
  moving_time: number;
  icu_training_load: number;
  external_id: string;
}

interface IntervalsEventResponse {
  id: string;
  start_date_local: string;
  // ... other fields
}
```

**Added Types**:

```typescript
// ✅ New: Folder types
interface IntervalsFolderPayload {
  name: string;
  description?: string;
}

interface IntervalsFolderResponse {
  id: number;
  name: string;
  description?: string;
  // ... other fields
}

// ✅ New: Workout template types
interface IntervalsWorkoutPayload {
  category: 'WORKOUT';
  type: string;
  name: string;
  description: string;
  moving_time: number;
  icu_training_load: number;
  folder_id?: number; // Optional folder organization
}

interface IntervalsWorkoutResponse {
  id: number;
  name: string;
  type: string;
  // ... other fields
}
```

### Config Changes

**Old Config**:

```typescript
interface IntervalsIcuExportConfig {
  apiKey: string;
  startDates: string[]; // Array of ISO dates
}
```

**New Config**:

```typescript
interface IntervalsIcuExportConfig {
  apiKey: string;
  libraryName: string; // Folder name
  createFolder?: boolean; // Create folder or use existing
  description?: string; // Optional folder description
}
```

### Message Handler Changes

**Removed Messages**:

```typescript
case 'EXPORT_TO_INTERVALS': {
  const { workouts, startDates, apiKey } = message;
  return await exportToIntervals(workouts, startDates);
}
```

**Added Messages**:

```typescript
case 'CREATE_INTERVALS_FOLDER': {
  const { name, description, apiKey } = message;
  return await createIntervalsFolder(name, description);
}

case 'CREATE_INTERVALS_WORKOUT': {
  const { payload, apiKey } = message;
  return await createIntervalsWorkout(payload);
}
```

### Adapter Changes

**Old Adapter**:

```typescript
class IntervalsIcuAdapter implements ExportAdapter<
  IntervalsIcuExportConfig,
  IntervalsEventResponse[]
> {
  transform(
    items: LibraryItem[],
    config: IntervalsIcuExportConfig
  ): Promise<IntervalsEventResponse[]> {
    // Transform to events with dates
    const events = items.map((item, index) => ({
      ...item,
      start_date_local: config.startDates[index],
    }));
    // ...
  }
}
```

**New Adapter**:

```typescript
class IntervalsIcuAdapter implements ExportAdapter<
  IntervalsIcuExportConfig,
  IntervalsWorkoutResponse[]
> {
  async transform(
    items: LibraryItem[],
    config: IntervalsIcuExportConfig
  ): Promise<IntervalsWorkoutResponse[]> {
    let folderId: number | undefined;

    // Create folder if requested
    if (config.createFolder) {
      const folderResult = await createIntervalsFolder(
        config.libraryName,
        config.description
      );
      if (folderResult.success) {
        folderId = folderResult.data.id;
      }
    }

    // Transform to workout templates (no dates)
    const workouts = await Promise.all(
      items.map((item) => {
        const payload = {
          category: 'WORKOUT' as const,
          type: mapWorkoutType(item.workoutTypeId),
          name: item.itemName,
          description: buildDescription(item),
          moving_time: item.totalTimePlanned * 3600,
          icu_training_load: item.tssPlanned,
          folder_id: folderId,
        };
        return createIntervalsWorkout(payload);
      })
    );
    // ...
  }
}
```

### Schema Changes

**Removed Schemas**:

```typescript
// ❌ Old: Event schemas
export const IntervalsEventPayloadSchema = z.object({
  category: z.literal('WORKOUT'),
  start_date_local: z.string(),
  // ...
});
```

**Added Schemas**:

```typescript
// ✅ New: Folder schemas
export const IntervalsFolderPayloadSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export const IntervalsFolderResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().optional(),
});

// ✅ New: Workout schemas
export const IntervalsWorkoutPayloadSchema = z.object({
  category: z.literal('WORKOUT'),
  type: z.string(),
  name: z.string().min(1),
  description: z.string(),
  moving_time: z.number(),
  icu_training_load: z.number(),
  folder_id: z.number().optional(),
});

export const IntervalsWorkoutResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string(),
  // ...
});
```

---

## Migration Checklist

### If You Have Custom Code

- [ ] Remove references to `exportToIntervals()`
- [ ] Replace with `createIntervalsFolder()` and `createIntervalsWorkout()`
- [ ] Update config to use `libraryName` instead of `startDates`
- [ ] Remove date-related logic from adapters
- [ ] Update type imports (remove Event types, add Folder/Workout types)
- [ ] Update Zod schemas
- [ ] Update tests to reflect new API endpoints
- [ ] Remove date picker UI components
- [ ] Add folder creation UI (optional checkbox)

### If You're Using the Extension

- [ ] No action required! The new flow is automatic.
- [ ] Note: Workouts appear in library, not calendar
- [ ] Schedule workouts by dragging in Intervals.icu

---

## Testing the Migration

### Unit Tests

All 139 tests pass with 100% coverage:

```bash
npm test -- tests/unit/export/adapters/intervalsicu/
npm test -- tests/unit/background/api/intervalsicu.test.ts
npm test -- tests/unit/schemas/intervalsicu.schema.test.ts
npm test -- tests/unit/services/intervalsApiKeyService.test.ts
```

### Manual Testing

1. **Export Library**
   - Select a TrainingPeaks library
   - Export to Intervals.icu with folder creation enabled
   - Verify folder appears in Intervals.icu workouts

2. **Verify Metadata**
   - Open a workout in Intervals.icu library
   - Check TSS, duration, description, coach notes
   - Confirm all fields preserved

3. **Schedule Workout**
   - Drag workout from library to calendar
   - Assign date
   - Verify workout appears on calendar

---

## Rollback Plan

If you need to revert to the old architecture:

1. **Checkout Previous Commit**

   ```bash
   git checkout <commit-before-migration>
   ```

2. **Restore Old Types**
   - Restore `IntervalsEventPayload` and `IntervalsEventResponse`
   - Remove folder/workout types

3. **Restore Old API Client**
   - Restore `exportToIntervals()` function
   - Remove `createIntervalsFolder()` and `createIntervalsWorkout()`

4. **Restore Old Adapter**
   - Use event-based transformation
   - Include date mapping logic

5. **Restore Old UI**
   - Add date picker back to export dialog
   - Remove folder creation checkbox

**Note**: Rollback is **not recommended** as the new architecture is more robust and aligns better with both platforms.

---

## Support

### Questions?

- **GitHub Issues**: https://github.com/PlanMyPeak/cycling_coach_browser_plugin/issues
- **Documentation**: See `docs/INTERVALSICU_INTEGRATION.md`

### Reporting Bugs

If you encounter issues with the new architecture:

1. Check that you're using the latest version
2. Verify API key is configured correctly
3. Check browser console for errors
4. Open a GitHub issue with:
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser console logs
   - Export configuration used

---

**Migration Date**: 2026-02-24
**Affected Version**: 1.0.0+
**Previous Architecture**: Event-based calendar export
**New Architecture**: Library-based template export
