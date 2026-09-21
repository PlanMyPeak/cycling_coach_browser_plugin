# Intervals.icu Integration Guide

Complete guide for the Intervals.icu export integration in PlanMyPeak Importer.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Setup](#setup)
4. [Usage](#usage)
5. [Technical Details](#technical-details)
6. [Troubleshooting](#troubleshooting)
7. [API Reference](#api-reference)

---

## Overview

The Intervals.icu integration enables direct upload of TrainingPeaks workout libraries to your Intervals.icu workout library via API. Workouts are uploaded as reusable templates with full metadata preservation, including TSS, duration, sport type, and coach comments.

### Key Features

- **Direct API Upload**: No file downloads - workouts upload directly to your library
- **Library Organization**: Creates folders to organize workouts by TrainingPeaks library
- **Template-Based**: Workouts saved as reusable templates for later scheduling
- **Full Metadata Preservation**: All workout details preserved (TSS, duration, description, coach notes)
- **Multi-Sport Support**: Cycling, running, swimming, and strength training
- **Batch Upload**: Export entire libraries at once
- **No Date Management**: Workouts saved as templates without dates
- **Secure Authentication**: API key stored encrypted in browser storage

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Extension Popup UI                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐        ┌──────────────────┐          │
│  │ IntervalsApiKey  │        │  ExportDialog    │          │
│  │    Banner        │        │ (Folder Option)  │          │
│  └──────────────────┘        └──────────────────┘          │
│           │                           │                      │
│           ▼                           ▼                      │
│  ┌──────────────────────────────────────────────┐          │
│  │      intervalsApiKeyService                   │          │
│  │  (setApiKey, getApiKey, hasApiKey)           │          │
│  └──────────────────────────────────────────────┘          │
│           │                           │                      │
│           ▼                           ▼                      │
│  ┌──────────────────────────────────────────────┐          │
│  │         chrome.storage.local                  │          │
│  │     (intervals_api_key)                      │          │
│  └──────────────────────────────────────────────┘          │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Background Worker                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────┐          │
│  │       IntervalsIcuAdapter                     │          │
│  │  - transform()  - validate()  - export()     │          │
│  └──────────────────────────────────────────────┘          │
│                      │                                       │
│                      ▼                                       │
│  ┌──────────────────────────────────────────────┐          │
│  │    background/api/intervalsicu.ts             │          │
│  │  - createFolder()                            │          │
│  │  - createWorkout()                           │          │
│  │  - buildDescription()                        │          │
│  │  - WORKOUT_TYPE_MAP                          │          │
│  └──────────────────────────────────────────────┘          │
│                      │                                       │
└──────────────────────│───────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Intervals.icu API (intervals.icu)               │
│        POST /api/v1/athlete/0/folders                       │
│        POST /api/v1/athlete/0/workouts                      │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User configures API key** → IntervalsApiKeyBanner → intervalsApiKeyService → chrome.storage.local
2. **User selects library** → ExportDialog → IntervalsIcuAdapter
3. **Create folder (optional)** → POST to `/folders` endpoint → Returns folder ID
4. **Adapter transforms data** → Creates IntervalsWorkoutPayload[] with proper sport types and metadata
5. **API client uploads** → Individual POST requests to `/workouts` endpoint with Basic Auth
6. **Results returned** → IntervalsWorkoutResponse[] → Displayed in ExportResult modal

---

## Setup

### 1. Generate Intervals.icu API Key

1. **Log in to Intervals.icu**
   - Visit https://intervals.icu
   - Log in with your account

2. **Navigate to Settings**
   - Click your profile icon (top right)
   - Select "Settings"

3. **Generate API Key**
   - Scroll to "Developer Settings" section
   - Click "Generate API Key"
   - **Important**: Copy the key immediately - it won't be shown again

4. **Save the Key**
   - Store it securely (you'll need it for the extension)

### 2. Configure Extension

1. **Open Extension**
   - Click the extension icon in Chrome toolbar
   - Ensure you're authenticated with TrainingPeaks

2. **Open API Key Banner**
   - Click the "Intervals.icu Integration" banner
   - Banner shows "Setup Required" status

3. **Enter API Key**
   - Paste your Intervals.icu API key
   - Click "Save API Key"

4. **Verify Connection**
   - Banner should now show "✓ Connected"
   - You're ready to export!

---

## Usage

### Exporting Workouts

1. **Browse to Library**
   - Navigate to "Libraries" tab
   - Select a workout library

2. **Initiate Export**
   - Click the "Export" button
   - Export dialog opens

3. **Configure Export**
   - Select "Intervals.icu" as destination
   - Optionally check "Create folder" to organize workouts
   - The folder will be named after your TrainingPeaks library

4. **Acknowledge Authorization**
   - Check the authorization checkbox
   - Confirms you have rights to export the content

5. **Export**
   - Click "Export" button
   - Upload begins (shows progress indicator)
   - Success message appears when complete

6. **Verify in Intervals.icu**
   - Visit https://intervals.icu/workouts
   - Find your library folder
   - All workouts appear as templates
   - All metadata preserved

### Scheduling Workouts

After exporting workouts to Intervals.icu:

1. **Visit Workout Library**
   - Go to https://intervals.icu/workouts
   - Find your exported library folder

2. **Schedule Workouts**
   - Drag workouts from library to calendar
   - Assign dates as needed
   - Customize before scheduling if desired

3. **Flexible Planning**
   - Reuse templates for multiple training cycles
   - No need to re-export
   - Edit templates to update all future uses

---

## Technical Details

### Authentication

**Method**: Basic Authentication with API Key

```http
Authorization: Basic {base64("API_KEY:" + apiKey)}
```

The extension automatically:

- Retrieves API key from storage
- Encodes it with "API_KEY:" prefix
- Includes in Authorization header

### API Endpoints

**Base URL**: `https://intervals.icu/api/v1/athlete/0`

#### Create Folder

**URL**: `/folders`

**Method**: POST

**Content-Type**: application/json

**Payload**:

```json
{
  "name": "Library Name",
  "description": "Optional description"
}
```

**Response**: Returns folder object with `id` field

#### Create Workout Template

**URL**: `/workouts`

**Method**: POST

**Content-Type**: application/json

**Payload**:

```json
{
  "category": "WORKOUT",
  "type": "Ride",
  "name": "Workout Name",
  "description": "Full workout description with metadata",
  "moving_time": 3600,
  "icu_training_load": 85,
  "folder_id": 123
}
```

**Response**: Returns workout object with `id` and other fields

### Sport Type Mapping

TrainingPeaks workout types are mapped to Intervals.icu activity types:

| TrainingPeaks Type | workoutTypeId | Intervals.icu Type | Notes                       |
| ------------------ | ------------- | ------------------ | --------------------------- |
| Run                | 1             | `Run`              | Running workouts            |
| Bike               | 2             | `Ride`             | Cycling workouts            |
| Swim               | 3             | `Swim`             | Swimming workouts           |
| Strength           | 13            | `WeightTraining`   | Strength/RxBuilder workouts |
| Other              | 4+            | `Ride`             | Default fallback            |

### Metadata Transformation

TrainingPeaks data is transformed to Intervals.icu format:

| TrainingPeaks Field    | Intervals.icu Field | Transformation                   |
| ---------------------- | ------------------- | -------------------------------- |
| `exerciseLibraryId`    | `folder_id`         | Used to organize workouts        |
| `itemName`             | `name`              | Direct copy                      |
| `description`          | `description`       | Direct copy + metadata           |
| `coachComments`        | `description`       | Appended as "**Coach Notes:**"   |
| `totalTimePlanned`     | `moving_time`       | Hours → Seconds (\*3600)         |
| `tssPlanned`           | `icu_training_load` | Direct copy                      |
| `workoutTypeId`        | `type`              | Via WORKOUT_TYPE_MAP             |
| `ifPlanned`            | `description`       | Added to metadata section        |
| `distancePlanned`      | `description`       | Added to metadata section        |
| `elevationGainPlanned` | `description`       | Added to metadata section        |
| `caloriesPlanned`      | `description`       | Added to metadata section        |
| `velocityPlanned`      | `description`       | Added to metadata section (pace) |

**Note**: No `start_date_local` field - workouts are saved as templates without dates.

### Description Format

Uploaded workouts have a structured description:

```
{workout.description}

**Coach Notes:**
{workout.coachComments}

**Workout Details:**
IF: {ifPlanned} • Distance: {distancePlanned} • Elevation: {elevationGainPlanned}m • Calories: {caloriesPlanned} • Pace: {velocityPlanned}
```

### Workout Payload Structure

```typescript
{
  category: 'WORKOUT',
  type: 'Ride',
  name: 'Sweet Spot Intervals',
  description: '4x10min @ 88-93% FTP\n\n**Coach Notes:**\nKeep HR in Zone 2...',
  moving_time: 3600, // seconds
  icu_training_load: 85, // TSS
  folder_id: 123 // Optional folder organization
}
```

**Note**: No `start_date_local` field - workouts are templates for later scheduling.

### Error Handling

The integration handles various error scenarios:

| Error           | Code                    | User Message                           | Recovery                    |
| --------------- | ----------------------- | -------------------------------------- | --------------------------- |
| No API key      | `NO_API_KEY`            | "Intervals.icu API key not configured" | Configure API key in banner |
| Invalid API key | `INVALID_API_KEY` (401) | "Invalid Intervals.icu API key"        | Re-enter correct API key    |
| Network error   | `EXPORT_ERROR`          | "Network error. Check connection..."   | Retry export                |
| API error       | `API_ERROR`             | "Intervals.icu API error: {status}"    | Check Intervals.icu status  |

---

## Troubleshooting

### API Key Issues

**Problem**: "Intervals.icu API key not configured" error

**Solution**:

1. Open extension popup
2. Click "Intervals.icu Integration" banner
3. Enter API key from https://intervals.icu/settings
4. Click "Save API Key"

---

**Problem**: "Invalid Intervals.icu API key" (401 error)

**Solution**:

1. Verify API key is correct
2. Generate new API key if needed:
   - Visit https://intervals.icu/settings
   - Revoke old key
   - Generate new key
3. Update key in extension

---

### Export Issues

**Problem**: Workouts not appearing on Intervals.icu calendar

**Solution**:

This is expected behavior! Workouts are saved as **templates** in your library, not calendar events.

1. **Visit Workout Library**
   - Go to https://intervals.icu/workouts
   - Look for your library folder (named after your TrainingPeaks library)

2. **Schedule Workouts**
   - Drag workouts from library to calendar to schedule them
   - Assign dates as needed

3. **Verify Export Success**
   - Check export result for success message
   - Confirm workouts appear in library folder
   - All metadata should be preserved

---

**Problem**: "Network error" during export

**Solution**:

1. Check internet connection
2. Verify Intervals.icu is accessible (https://intervals.icu)
3. Retry export
4. If persistent, check browser console for details

---

### Metadata Issues

**Problem**: Missing coach comments or metrics

**Solution**:

- Metadata is embedded in workout description
- Open workout in Intervals.icu to view full description
- Look for "**Coach Notes:**" and "**Workout Details:**" sections

---

## API Reference

### Service Functions

**setIntervalsApiKey(apiKey: string): Promise<void>**

- Stores API key in chrome.storage.local
- Throws error if key is empty

**getIntervalsApiKey(): Promise<string | null>**

- Retrieves API key from storage
- Returns null if not configured

**hasIntervalsApiKey(): Promise<boolean>**

- Checks if API key exists
- Returns true if key is configured

**clearIntervalsApiKey(): Promise<void>**

- Removes API key from storage

### API Client Functions

**createIntervalsFolder(name: string, description?: string): Promise<ApiResponse<IntervalsFolderResponse>>**

Creates a folder in Intervals.icu workout library.

**Parameters**:

- `name`: Folder name (typically TrainingPeaks library name)
- `description`: Optional folder description

**Returns**:

- Success: `{ success: true, data: { id, name, ... } }`
- Error: `{ success: false, error: { message, code, status? } }`

**createIntervalsWorkout(payload: IntervalsWorkoutPayload): Promise<ApiResponse<IntervalsWorkoutResponse>>**

Creates a workout template in Intervals.icu.

**Parameters**:

- `payload`: Workout data (name, description, type, TSS, duration, folder_id)

**Returns**:

- Success: `{ success: true, data: { id, name, ... } }`
- Error: `{ success: false, error: { message, code, status? } }`

**Example**:

```typescript
// Create folder
const folderResult = await createIntervalsFolder('My Training Library');

if (folderResult.success) {
  const folderId = folderResult.data.id;

  // Create workout in folder
  const workoutPayload = {
    category: 'WORKOUT',
    type: 'Ride',
    name: 'Sweet Spot Intervals',
    description: '4x10min @ 88-93% FTP',
    moving_time: 3600,
    icu_training_load: 85,
    folder_id: folderId,
  };

  const workoutResult = await createIntervalsWorkout(workoutPayload);
  if (workoutResult.success) {
    console.log('Created workout:', workoutResult.data.id);
  }
}
```

### Adapter Interface

**IntervalsIcuAdapter**

Implements `ExportAdapter<IntervalsIcuExportConfig, IntervalsWorkoutResponse[]>`

**Methods**:

- `transform(items, config)`: Transforms TrainingPeaks items to Intervals.icu workout templates
- `validate(workouts)`: Validates exported workout responses
- `export(workouts, config)`: Returns export result summary

**Config Interface**:

```typescript
interface IntervalsIcuExportConfig {
  apiKey: string; // Intervals.icu API key
  libraryName: string; // Library/folder name
  createFolder?: boolean; // Create folder for organization
  description?: string; // Optional folder description
}
```

---

## Security Considerations

### API Key Storage

- API keys are stored in `chrome.storage.local`
- Chrome encrypts storage data at rest
- Keys are never logged in production builds
- Keys are never transmitted to third parties (only Intervals.icu)

### Data Privacy

- Workout data is sent only to Intervals.icu API
- No telemetry or tracking
- User controls all export operations
- Extension requires explicit user action to export

### Permissions

Required Chrome permissions:

- `storage`: Store API key
- `host_permissions`: Access to `intervals.icu` domain

---

## Development

### Running Tests

```bash
# Unit tests for Intervals.icu integration
npm test -- tests/unit/background/api/intervalsicu.test.ts
npm test -- tests/unit/services/intervalsApiKeyService.test.ts
npm test -- tests/unit/schemas/intervalsicu.schema.test.ts
npm test -- tests/unit/export/adapters/intervalsicu/

# All Intervals.icu tests (139 tests)
npm test -- tests/unit/export/adapters/intervalsicu/ \
  tests/unit/background/api/intervalsicu.test.ts \
  tests/unit/services/intervalsApiKeyService.test.ts \
  tests/unit/schemas/intervalsicu.schema.test.ts
```

### Code Coverage

Target: 100% coverage (project standard)

Current: 100% on all Intervals.icu integration code

### Code Organization

```
src/
├── background/api/intervalsicu.ts       # API client
├── export/adapters/intervalsicu/        # Adapter implementation
├── popup/components/                     # UI components
│   └── IntervalsApiKeyBanner.tsx
├── schemas/intervalsicu.schema.ts       # Zod schemas
├── services/intervalsApiKeyService.ts   # API key management
└── types/intervalsicu.types.ts          # Type definitions
```

---

## Future Enhancements

### Potential Improvements

1. **OAuth 2.0 Authentication**
   - Alternative to API key
   - More secure flow
   - Better UX (no manual key entry)

2. **Structured Workout Parsing**
   - Transform TrainingPeaks intervals to Intervals.icu workout format
   - Preserve interval structure

3. **Custom Date Scheduling**
   - Allow custom date per workout
   - Support different spacing patterns (weekly, custom)

4. **Selective Export**
   - Choose specific workouts to export
   - Multi-select interface

5. **Sync Status Tracking**
   - Track which workouts have been exported
   - Prevent duplicate exports
   - Update existing workouts

---

## Resources

### Official Documentation

- [Intervals.icu API Docs](https://intervals.icu/api-docs.html)
- [API Integration Cookbook](https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090)
- [Uploading Planned Workouts](https://forum.intervals.icu/t/uploading-planned-workouts-to-intervals-icu/63624)

### Support

- **Issues**: https://github.com/PlanMyPeak/cycling_coach_browser_plugin/issues
- **Discussions**: https://github.com/PlanMyPeak/cycling_coach_browser_plugin/discussions

---

**Last Updated**: 2026-02-24
**Version**: 1.0.0
**Maintained By**: Eduardo Arantes
