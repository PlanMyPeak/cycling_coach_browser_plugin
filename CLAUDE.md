# TrainingPeaks Browser Extension - Claude AI Development Guide

**Project**: TrainingPeaks Workout Library Browser Extension
**Status**: Intervals.icu Integration Complete (Issue #90-91)
**Version**: 1.0.0
**Last Updated**: 2026-09-17

---

## Quick Start

```bash
# Install dependencies
make install

# Start development
make dev

# Run tests
make test-unit

# Build for production
make build

# Load in Chrome
make load
```

---

## Tech Stack

### Core Technologies

**Build & Development**

- **Vite 7.3.1** - Build tool with HMR (<50ms updates)
- **TypeScript 5.9.3** - Strict type safety
- **Chrome Extension Manifest V3** - Latest extension platform

**Frontend**

- **React 19.0.0** - UI library with concurrent features
- **Tailwind CSS 4.2.0** - Utility-first styling
- **@crxjs/vite-plugin 2.3.0** - Seamless Chrome extension dev

**State Management**

- **Zustand 5.0.11** - Client state (1KB, minimal API)
- **TanStack Query 5.90.21** - Server state with caching

**Validation & Type Safety**

- **Zod 4.3.6** - Runtime validation (14x faster than v3)
- **TypeScript ESLint** - Advanced linting rules

**Testing**

- **Vitest 4.0.18** - Fast unit tests with ESM
- **Playwright 1.58.2** - E2E testing (not yet implemented)
- **@testing-library/react 16.3.2** - Component testing (not yet implemented)

---

## Project Structure

```
cycling_coach_browser_plugin/
├── src/
│   ├── background/          # Service worker
│   │   ├── api/            # API client (empty, Phase 3)
│   │   ├── index.ts        # Service worker entry
│   │   └── messageHandler.ts
│   ├── content/            # Content scripts
│   │   ├── mainWorldInterceptor.ts
│   │   ├── isolatedWorldBridge.ts
│   │   ├── workoutCaptureDetection.ts  # Pure TP calendar-write matcher
│   │   ├── siteControlBridge.ts   # PlanMyPeak site-control channel
│   │   └── overlay/               # In-page import overlay (lazy-loaded)
│   ├── popup/              # Extension popup UI
│   │   ├── components/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── services/           # Business logic layer
│   │   ├── authService.ts
│   │   ├── storageService.ts
│   │   ├── capturedWorkoutService.ts  # captured_workouts map, serialized writes
│   │   └── badgeService.ts            # single owner of the action badge
│   ├── store/              # Zustand state management
│   │   └── authStore.ts
│   ├── hooks/              # React custom hooks
│   │   ├── useAuth.ts
│   │   ├── useUser.ts
│   │   ├── useLibraries.ts
│   │   ├── useLibraryItems.ts
│   │   ├── useCapturedWorkouts.ts     # New Workouts tab list (storage-backed)
│   │   └── useSendCapturedWorkouts.ts # Send captured workouts via planMyPeakAdapter
│   ├── config/             # Configuration
│   │   └── queryClient.ts
│   ├── schemas/            # Zod validation schemas
│   │   ├── storage.schema.ts
│   │   └── capturedWorkout.schema.ts  # capture payload + stored record
│   ├── types/              # TypeScript type definitions
│   │   └── index.ts
│   ├── utils/              # Shared utilities
│   │   ├── constants.ts
│   │   └── logger.ts
│   └── styles/
│       └── globals.css
├── tests/
│   ├── unit/               # Unit tests (125 tests, 100% coverage)
│   │   ├── config/        # Query client tests
│   │   ├── hooks/         # React hooks tests (24 tests)
│   │   ├── services/      # Service tests
│   │   ├── schemas/       # Zod schema tests
│   │   └── background/    # Background worker tests
│   ├── integration/        # Integration tests (empty)
│   ├── components/         # Component tests (empty)
│   ├── e2e/                # E2E tests (empty)
│   └── setup.ts            # Test configuration
├── public/
│   ├── manifest.json       # Extension manifest
│   └── icons/              # Extension icons
├── docs/                   # Architecture documentation
│   └── Issue-1-TrainingPeaks-Plugin-Architecture.md
├── dist/                   # Build output (gitignored)
├── Makefile                # Common commands
├── CLAUDE.md               # This file
├── TESTING.md              # Testing guide
└── README.md               # User documentation
```

---

## Architecture Overview

### Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Extension                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐     ┌───────────────┐     ┌────────────┐ │
│  │   Popup UI   │────▶│  Zustand      │────▶│ Background │ │
│  │   (React)    │     │  Store        │     │  Worker    │ │
│  └──────────────┘     └───────────────┘     └────────────┘ │
│         │                     │                     │        │
│         ▼                     ▼                     ▼        │
│  ┌──────────────┐     ┌───────────────┐     ┌────────────┐ │
│  │   Hooks      │     │   Services    │     │  Storage   │ │
│  │  (useAuth)   │     │  (auth, API)  │     │  (chrome)  │ │
│  └──────────────┘     └───────────────┘     └────────────┘ │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│                      Content Script                           │
│              (Token Interceptor on TP domain)                │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│              TrainingPeaks API (tpapi.trainingpeaks.com)     │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User visits TrainingPeaks** → Content script intercepts API requests
2. **Token found** → Message sent to background worker
3. **Background stores token** → chrome.storage.local (encrypted by browser)
4. **User opens popup** → Zustand checks auth state via services
5. **Services query storage** → Zod validates data
6. **UI updates** → Shows authentication status

### Authentication Flow

```mermaid
sequenceDiagram
    User->>TrainingPeaks: Login
    TrainingPeaks->>API: Authenticated request
    ContentScript->>ContentScript: Intercept fetch/XHR
    ContentScript->>Background: Send bearer token
    Background->>Storage: Store token + timestamp
    User->>Popup: Click extension icon
    Popup->>Zustand: Get auth state
    Zustand->>AuthService: Check authentication
    AuthService->>Storage: Get token
    Storage->>AuthService: Return validated token
    AuthService->>Zustand: Update state
    Zustand->>Popup: Render auth status
```

---

## Current Implementation Status

### ✅ Completed (Phases 1-5)

**Phase 1: Project Foundation**

- ✅ Vite + TypeScript + React setup
- ✅ Chrome Extension Manifest V3 configured
- ✅ Tailwind CSS with modern PostCSS
- ✅ Development environment (Husky, lint-staged, commitlint)
- ✅ ESLint + Prettier + TypeScript strict mode

**Phase 2: Authentication & Token Management**

- ✅ Content script token interception (fetch + XHR)
- ✅ Background service worker
- ✅ Storage service with Zod validation
- ✅ Auth service with 24-hour expiration
- ✅ Zustand auth store
- ✅ AuthStatus UI component

**Phase 3: API Integration** (Issues #10-13, #35-40)

- ✅ TypeScript interfaces for TrainingPeaks API responses
- ✅ Zod schemas for API validation (user, libraries, library items)
- ✅ API service layer in `src/background/api/trainingPeaks.ts`
- ✅ React Query configuration with Chrome extension optimizations
- ✅ Custom hooks: `useUser`, `useLibraries`, `useLibraryItems`
- ✅ Type-safe chrome.runtime.sendMessage with generics
- ✅ 125 unit tests with 100% coverage

**Phase 4: Intervals.icu Integration** (Issues #90)

- ✅ Type system redesign (library-based, no dates)
- ✅ Zod schemas for Intervals.icu API (57 tests)
- ✅ API client implementation (33 tests)
- ✅ Export adapter (24 tests)
- ✅ API key management service (25 tests)
- ✅ IntervalsApiKeyBanner component
- ✅ Multi-library export dialog
- ✅ Folder creation and organization
- ✅ 139 tests with >95% coverage

**Phase 5: Testing & Validation** (Issue #91)

- ✅ Fixed athlete_id schema validation bug
- ✅ All 139 Intervals.icu tests passing
- ✅ 100% coverage on schemas, services, adapter
- ✅ 97.72% coverage on API client
- ✅ TypeScript compilation: 0 errors
- ✅ Production build successful
- ✅ Comprehensive test results documentation

**Phase 6: Documentation Updates** (Issue #91)

- ✅ README.md updated with library-based export guide
- ✅ INTERVALSICU_INTEGRATION.md comprehensive guide
- ✅ CLAUDE.md architecture patterns documented
- ✅ Test results documentation (PHASE_5_TEST_RESULTS.md)

**API Endpoints Implemented**:

**TrainingPeaks API**:

1. ✅ `GET /users/v3/user` - User profile
2. ✅ `GET /exerciselibrary/v2/libraries` - Library list
3. ✅ `GET /exerciselibrary/v2/libraries/{id}/items` - Library content

**Intervals.icu API**:

1. ✅ `POST /athlete/0/folders` - Create workout folder
2. ✅ `POST /athlete/0/workouts` - Create workout template

### ⏳ Future Enhancements

**UI Component Testing**

- ⏳ React Testing Library tests for UI components
- ⏳ E2E tests with Playwright
- ⏳ Integration tests for message handlers

**Additional Features**

- ⏳ OAuth 2.0 authentication for Intervals.icu
- ⏳ Structured workout parsing (intervals preservation)
- ⏳ Selective workout export
- ⏳ Sync status tracking

---

## Development Guidelines

### Code Style

**TypeScript**

- ✅ Strict mode enabled
- ✅ Explicit return types on functions
- ✅ No `any` types (enforced by ESLint)
- ✅ Prefer `interface` over `type` for object shapes
- ✅ Use `const` assertions for literal types

**React**

- ✅ Function components only
- ✅ Explicit return type: `ReactElement`
- ✅ Custom hooks for business logic
- ✅ No prop drilling (use Zustand for shared state)

**Imports**

- ✅ Use `@/` path aliases (not relative paths)
- ✅ Group imports: external → internal → types
- ✅ Named exports preferred over default

**Logging**

- ✅ Use `logger` utility (not console.log)
- ✅ Dev-only logging: `logger.info()`, `logger.debug()`
- ✅ Always log errors: `logger.error()`

### Clean Code Principles Applied

**SOLID**

- **Single Responsibility**: Each service/component has one purpose
- **Dependency Inversion**: UI depends on abstractions (hooks)

**DRY**

- Shared types in `src/types/`
- Reusable components
- Constants in `src/utils/constants.ts`

**KISS**

- Minimal dependencies
- Straightforward data flow
- No premature optimization

**YAGNI**

- Only Milestone 1 features implemented
- Advanced features deferred to future phases

### Testing Strategy

**Test Pyramid**

```
       /\
      /E2E\      ← Playwright (future)
     /------\
    /  INT   \   ← Integration tests (future)
   /----------\
  /   UNIT     \ ← Vitest (22 tests, 100% coverage)
 /--------------\
```

**Coverage Goals**

- Services: >90% (currently 100%)
- Components: >80% (not yet implemented)
- Overall: >80% (currently 100% on services)

**Test Naming**

```typescript
describe('serviceName', () => {
  describe('methodName', () => {
    it('should do expected behavior when condition', () => {
      // Arrange → Act → Assert
    });
  });
});
```

---

## Important Configuration

### Path Aliases

All imports use `@/` prefix:

```typescript
// ❌ Bad
import { useAuth } from '../../hooks/useAuth';

// ✅ Good
import { useAuth } from '@/hooks/useAuth';
```

Configured in:

- `tsconfig.json` → `paths: { "@/*": ["./src/*"] }`
- `vite.config.ts` → `alias: { '@': path.resolve(...) }`
- `vitest.config.ts` → `alias: { '@': path.resolve(...) }`

### Environment Variables

**Development** (`npm run dev`):

- `import.meta.env.DEV = true`
- Logger outputs to console
- HMR enabled

**Production** (`npm run build`):

- `import.meta.env.DEV = false`
- Logger silent (except errors)
- Optimized bundle

### Chrome Storage

**Keys Used**:

```typescript
const STORAGE_KEYS = {
  AUTH_TOKEN: 'auth_token', // Bearer token string
  TOKEN_TIMESTAMP: 'token_timestamp', // Unix timestamp (ms)
};
```

**Validation**: All storage reads go through Zod schemas

### Constants

Defined in `src/utils/constants.ts`:

```typescript
API_BASE_URL = 'https://tpapi.trainingpeaks.com';
TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
EXTENSION_NAME = 'TrainingPeaks Library Access';
```

---

## API Information

### TrainingPeaks API Endpoints

**Base URL**: `https://tpapi.trainingpeaks.com`

**Authentication**: Bearer token (intercepted from user session)

**Required Headers**:

```http
Authorization: Bearer {token}
Content-Type: application/json
Origin: https://app.trainingpeaks.com
```

**Endpoints (Phase 3)**:

1. **Get User Info**

   ```
   GET /users/v3/user
   Response: { id, email, firstName, lastName, timeZone }
   ```

2. **List Libraries**

   ```
   GET /exerciselibrary/v2/libraries
   Response: [{ id, name, ownerId, ownerName, itemCount, isShared }]
   ```

3. **Get Library Items**
   ```
   GET /exerciselibrary/v2/libraries/{id}/items
   Response: { items: [{ id, name, description, type, duration }] }
   ```

---

## React Query Patterns

### State Management Strategy

We maintain **strict separation** between two types of state:

**Server State (React Query)** - Data from TrainingPeaks API:

- User profile (`useUser`)
- Libraries list (`useLibraries`)
- Library items (`useLibraryItems`)

**Client State (Zustand)** - Local application state:

- Authentication status (`useAuth` - existing)
- UI preferences (future)
- Form state (future)

### Custom Hooks

**useUser Hook** - Fetch user profile data:

```typescript
import { useUser } from '@/hooks/useUser';

function UserProfile() {
  const { data: user, isLoading, error } = useUser();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!user) return null;

  return <div>Hello, {user.firstName}!</div>;
}
```

**useLibraries Hook** - Fetch libraries list:

```typescript
import { useLibraries } from '@/hooks/useLibraries';

function LibraryList() {
  const { data: libraries, isLoading, error, refetch } = useLibraries();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!libraries?.length) return <EmptyState />;

  return (
    <ul>
      {libraries.map(lib => (
        <LibraryCard key={lib.exerciseLibraryId} library={lib} />
      ))}
    </ul>
  );
}
```

**useLibraryItems Hook** - Fetch library items (parameterized):

```typescript
import { useLibraryItems } from '@/hooks/useLibraryItems';

function LibraryDetails({ libraryId }: { libraryId: number }) {
  const { data: items, isLoading, error } = useLibraryItems(libraryId);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;
  if (!items?.length) return <EmptyLibrary />;

  return (
    <div>
      <h2>{items.length} Workouts</h2>
      <WorkoutGrid items={items} />
    </div>
  );
}
```

**Conditional Fetching** - Lazy loading with `enabled` option:

```typescript
function LibraryPreview({ libraryId }: { libraryId: number }) {
  const { data, refetch } = useLibraryItems(libraryId, { enabled: false });

  return (
    <div>
      <button onClick={() => refetch()}>Load Workouts</button>
      {data && <WorkoutList items={data} />}
    </div>
  );
}
```

### Query Configuration

**Query Client Settings** (`src/config/queryClient.ts`):

- `staleTime: 5min` - Default cache freshness
- `gcTime: 10min` - Memory cleanup (keeps data for popup re-opens)
- `retry: 2` - Exponential backoff for network errors
- `refetchOnWindowFocus: true` - Validate on popup focus
- `refetchOnReconnect: true` - Refetch when network reconnects
- `refetchOnMount: false` - Trust cache on re-open

**Per-Hook Overrides**:

- `useUser`: `retry: 1` (auth failures shouldn't spam)
- `useLibraries`: `staleTime: 10min` (libraries change infrequently)
- `useLibraryItems`: `staleTime: 3min` (items may be edited more often)

### Message Passing Pattern

All API calls use type-safe `chrome.runtime.sendMessage`:

```typescript
// Type-safe message definition (src/types/index.ts)
export interface GetUserMessage {
  type: 'GET_USER';
}

// Custom hook sends message
const response = await chrome.runtime.sendMessage<
  GetUserMessage,
  ApiResponse<UserProfile>
>({ type: 'GET_USER' });

// Background handler processes
case 'GET_USER':
  return await fetchUser(); // Returns ApiResponse<UserProfile>
```

### Cache Invalidation

**Manual Invalidation**:

```typescript
import { useQueryClient } from '@tanstack/react-query';

const queryClient = useQueryClient();

// Invalidate all queries
queryClient.invalidateQueries();

// Invalidate specific queries
queryClient.invalidateQueries(['user']);
queryClient.invalidateQueries(['libraries']);
queryClient.invalidateQueries(['libraries', 123, 'items']);
```

**Hierarchical Query Keys**:

- `['user']` - User profile
- `['libraries']` - All libraries
- `['libraries', libraryId, 'items']` - Specific library items

Invalidating `['libraries']` will invalidate all library-related queries.

### Error Handling

**Layered Approach**:

1. **Background Worker** - Catches fetch errors, validates with Zod
2. **Query Functions** - Unwraps `ApiResponse<T>`, throws on error
3. **Custom Hooks** - Exposes React Query error state
4. **UI Components** - Displays user-friendly messages

```typescript
// In custom hooks
if (response.success) {
  return response.data;
} else {
  throw new Error(response.error.message); // Triggers React Query error state
}

// In UI components
if (error) {
  return <ErrorMessage error={error} onRetry={refetch} />;
}
```

---

## PlanMyPeak Site-Control Channel

The PlanMyPeak web app can drive the extension rather than only being an export
destination: it can detect the extension, read TrainingPeaks libraries,
workouts and training plans through it, and ask it to open an import overlay
rendered on the PlanMyPeak page.

Full wire protocol and page-side snippet: `PLANMYPEAK_INTEGRATION.md` →
"Site-Control Channel". Pattern guidance for other destinations:
`docs/EXPORT_DESTINATION_INTEGRATION_FLOW.md`.

**Key files**:

- `src/types/siteControl.types.ts` — protocol contract, `PLANMYPEAK_SITE_CONTROL_VERSION`
- `src/schemas/siteControl.schema.ts` — Zod validation, response builders
- `src/content/siteControlBridge.ts` — origin gate, page ↔ background relay
- `src/content/overlay/` — the overlay (shadow DOM, own QueryClient)
- `src/utils/constants.ts` — `PLANMYPEAK_CONTROL_ORIGINS`, `isPlanMyPeakControlOrigin`
- `src/services/planMyPeakConfigService.ts` — PlanMyPeak environment
  (production / staging / local) and the app URLs derived from it

**Fail closed on correctness, fail soft on presentation.** Two checks on this
channel look identical in code and must behave oppositely. `planMyPeak.coachId`
blocks the import when unknown, because being wrong writes one coach's data into
another's account and nothing downstream would catch it. A missing entry in
`PING.supports` degrades instead — a page whose plan grouping is unavailable
shows a flat list rather than hiding the import, because being wrong there costs
some headings. Decide which kind a new check is before choosing its failure
mode.

**One idea, one implementation.** Four bugs in this channel came from the same
root: the popup and the overlay each implementing the same idea. Non-owned
libraries reaching the page, the two surfaces naming tabs differently, plans
listed flat in one and grouped in the other, and nearly a fifth in the grouping
rule itself. The fix that holds is extracting the logic UI-free and pointing
both surfaces at it — `groupPlansByFolder`, `duplicatePreflight`,
`planMyPeakAdapter` — not fixing each surface as it is reported.

**Invariants — do not weaken these when extending the channel**:

- The page names _site-control_ request types only (`PING`, `GET_LIBRARIES`,
  `GET_LIBRARY_ITEMS`, `GET_TRAINING_PLANS`, `GET_PLAN_CONTENTS`,
  `GET_TRAINING_PLAN_LIBRARIES`, `GET_ATHLETE_GROUPS`, `OPEN_IMPORTER`). It can
  never name a `RuntimeMessage` type, so adding a background handler does not
  expose it to the page.
  `PING` advertises this list as `supports`, so the page feature-detects
  instead of comparing extension versions.
- Requests resolve the acting account from stored credentials, never from a
  page-supplied id: `GET_ATHLETE_GROUPS` takes no `coachId`, so an allowlisted
  page cannot read another coach's data by guessing one.
- `PING` reports `planMyPeak.coachId` so the page can refuse an import when the
  extension is acting as a different coach than the page session. Ingest is
  scoped to the token's coach, so a wrong-account import succeeds silently —
  this comparison is the only thing that catches it. `null` means unknown and
  must fail closed. An account id is not a credential; the coach's email and
  name still may not cross into the page.
- Imports are blocked on a confirmed TrainingPeaks/PlanMyPeak account mismatch
  in **both** surfaces — the popup (`AccountMismatchBanner`) and the overlay
  (`AccountMismatchGate`). A gate that exists on only one surface is not a gate:
  the page-driven path runs the same upload code. The comparison lives in one
  hook, `usePlanMyPeakAccountMatch`, and is enforced only against the
  **production** PlanMyPeak environment: on staging and local it reports
  `not-enforced`, because dev coach accounts are not linked to the coach's
  real TrainingPeaks account. Do not add a second bypass elsewhere.
- Origin is checked in the content script _and_ re-checked in the background
  against `sender.origin`. Adding a request type does not change this.
- A non-allowlisted origin gets **no response at all**, so a site cannot use
  the channel to detect the extension. Do not "helpfully" return an error.
- No credential (TrainingPeaks token, PlanMyPeak token, Supabase key,
  Intervals.icu key) may appear in any page-bound message, including errors.
- The always-injected bridge stays dependency-light; the overlay is behind a
  dynamic `import()`. Do not statically import React into the bridge.
- **A broken extension must say so, not go quiet.** The bridge imports
  schemas, so the build wraps it in a loader that fetches its module at
  runtime; if that fetch fails the bridge never attaches and is silent
  forever, which the page can only read as "not installed".
  `src/content/siteControlFallback.ts` covers that case and therefore
  **imports nothing** — with no imports the build emits it directly, with no
  module fetch of its own to fail. Adding an import to it would give it the
  failure mode it exists to cover. It answers `PING` only, stands down as soon
  as the bridge sets its ready flag, and relies on its manifest matches for
  the origin gate rather than carrying a second copy of the allow-list.

**Overlay imports use the shared path**: `planMyPeakAdapter`, the duplicate
preflight in `src/export/adapters/planMyPeak/duplicatePreflight.ts`, and the
progress state in `src/types/export.types.ts` are shared with the popup export
dialog, so the two surfaces cannot drift.

---

## Captured Workouts (TrainingPeaks calendar → PlanMyPeak)

A coach who creates a workout on an athlete's TrainingPeaks calendar can send
it to their default PlanMyPeak library ("My Library") without re-reading
TrainingPeaks. The main-world interceptor watches two routes only —
`POST …/fitness/v6/athletes/{athleteId}/workouts` (create) and
`PUT …/workouts/{workoutId}` (update of an already-captured workout) — on both
TrainingPeaks API hosts, via `fetch` and XHR. Full design:
`openspec/changes/tp-workout-capture-to-pmp/design.md`.

**Key files**:

- `src/content/workoutCaptureDetection.ts` — pure URL/body helpers (exact path
  match; sibling routes such as `/comments` and `/details` never match)
- `src/content/mainWorldInterceptor.ts` — takes a synchronous body handle,
  dispatches the original fetch at once, reads request + response off a
  clone on a detached promise, returns the original response immediately
- `src/content/isolatedWorldBridge.ts` — relays `TP_WORKOUT_CREATED` /
  `TP_WORKOUT_UPDATED` as `WORKOUT_CAPTURED` (no imports, no validation)
- `src/schemas/capturedWorkout.schema.ts` — tolerant payload schema, stored
  record schema, `buildCapturedWorkoutKey(environment, athleteId, workoutId)`
- `src/services/capturedWorkoutService.ts` — the `captured_workouts` map
- `src/services/badgeService.ts` — `refreshBadge()`, the badge owner
- `src/hooks/useCapturedWorkouts.ts`, `src/hooks/useSendCapturedWorkouts.ts`
- `src/popup/components/CapturedWorkoutList.tsx`, `CapturedWorkoutRow.tsx`,
  the **New Workouts** tab in `TabNavigation.tsx`

**Rules — do not weaken these when extending the feature**:

- **A page gets counts and handles, never a capture.** `WORKOUT_CAPTURED`,
  `GET_CAPTURED_WORKOUTS`, `UPDATE_CAPTURED_WORKOUT`, `REMOVE_CAPTURED_WORKOUTS`
  and `CLAIM_CAPTURED_WORKOUTS` are `RuntimeMessage` types only: not in
  `PING.supports`, not served by the site-control router, and the site-control
  test asserts this. What an allowlisted PlanMyPeak page _may_ do is the narrow
  surface of `GET_CAPTURED_WORKOUT_SUMMARY`, `IMPORT_MISSING_WORKOUTS` and
  `GET_CAPTURED_WORKOUT_IMPORT_STATUS` (`src/background/capturedImports/`):
  learn how many captures are missing from _its own verified account's_
  library, start an import into that account, and poll its counts. No reply
  carries a capture, an athlete id, a workout body, a record key or a
  credential; per-workout errors are the title plus a bounded reason. The
  account is resolved from the stored session on every request — `contextId`
  is correlation, not authorization — and the page's origin must equal the
  configured destination. Widening this surface is a security decision, not a
  convenience.
- **Captures are origin-gated in the background.** `WORKOUT_CAPTURED` is
  accepted only from a tab whose URL origin is a TrainingPeaks app origin
  (`trainingPeaksEnvironmentForAppOrigin`), and the record's `environment`
  comes from that origin, never from the message. The popup cannot send it.
- **No credential in a capture.** The posted message carries request body,
  response body, ids, kind and timestamp — never request headers.
- **The capture never affects the page.** Nothing is awaited before the
  original fetch is dispatched; the page gets the original response object
  as soon as it exists; every failure in the capture path is swallowed.
- **Only the background writes `captured_workouts`.** Every mutation is a
  read-modify-write serialized through `withCapturedWorkoutsLock`; the popup
  and hooks send runtime messages and never call `chrome.storage.local.set`
  on the key. Reads may bypass the queue.
- **One badge owner.** `badgeService.refreshBadge()` is the only place the
  idle badge is decided: export `in_progress` wins, then a `completed`/
  `failed` export younger than `EXPORT_BADGE_LINGER_MS`, then the pending
  capture count (`99+` cap, amber), else empty. Export services paint their
  own transient states and delegate the idle case; nothing else calls
  `chrome.action.setBadgeText` for the idle case. The linger check on
  `completedAt` is what keeps a persisted `✓` from surviving a restart.
- **Sends use the shared path with a namespaced identity.** The hook runs
  `planMyPeakAdapter.transform → validate → export` with
  `{ createFolder: false, providerIdNamespace: 'cal' | 'cal-sandbox', capturedKeys }`.
  The transformer mints `provider_workout_id` as `${namespace}:${workoutId}`;
  nothing outside it rewrites identities. `createFolder: false` resolves the
  `isDefault` library by flag, never by name.
- **Send outcomes are written by the background upload loop**, per workout,
  right after its POST, through `capturedKeys` on
  `EXPORT_WORKOUTS_TO_PLANMYPEAK_LIBRARY`. The popup only reflects storage,
  so a popup closed mid-send loses nothing. The hook records only
  transform-time skips (`lastSendError`).
- **Sends are gated like every other import**: disabled without PlanMyPeak
  auth or with the connection off, blocked on a confirmed account mismatch.
- **`exportWorkoutsToPlanMyPeakLibrary` no longer short-circuits when every
  upload fails.** It returns `success: true` with the full summary whenever
  the loop ran; `isTotalUploadFailure(summary)` is how consumers
  (`PlanMyPeakAdapter.export`, `trainingPlanExport`) turn that into the
  user-facing failure, now listing every failure message. `success: false`
  means no upload was attempted. `ExportResult.itemResults` (keyed by
  provider id) and `failures[].providerWorkoutId` are additive.

**Known limits**: only the documented create endpoint is captured (applying a
library item to the calendar, copy/paste and plan application use other
routes and are out of scope until observed); athlete names are not available,
so rows show the athlete id and workout day.

## Export Adapters

### Intervals.icu Export Adapter

**Pattern**: Library-based export (templates, not calendar events)

The Intervals.icu integration exports TrainingPeaks workout libraries as reusable templates in Intervals.icu, organized in folders. Workouts are saved without dates, allowing flexible scheduling later.

**Key Files**:

- `src/export/adapters/intervalsicu/IntervalsIcuAdapter.ts` - Adapter implementation
- `src/background/api/intervalsicu.ts` - API client
- `src/types/intervalsicu.types.ts` - Type definitions
- `src/schemas/intervalsicu.schema.ts` - Zod validation schemas

**Architecture**:

1. **Create Folder** (optional): `POST /athlete/0/folders`
2. **Export Workouts**: `POST /athlete/0/workouts` (individual requests)
3. **No Dates**: Workouts saved as templates for later scheduling

**Config Interface**:

```typescript
interface IntervalsIcuExportConfig {
  apiKey: string; // User's Intervals.icu API key
  libraryName: string; // Folder name (from TrainingPeaks library)
  createFolder?: boolean; // Create folder or use existing
  description?: string; // Optional folder description
}
```

**Usage**:

```typescript
import { IntervalsIcuAdapter } from '@/export/adapters/intervalsicu';

const adapter = new IntervalsIcuAdapter();

const config: IntervalsIcuExportConfig = {
  apiKey: 'user_api_key',
  libraryName: 'Cycling Base Training',
  createFolder: true,
  description: 'Base training workouts for cycling',
};

// Transform library items to Intervals.icu format
const workouts = await adapter.transform(items, config);
// Returns: IntervalsWorkoutResponse[] (templates, not events)

// Validate results
const validation = adapter.validate(workouts);
if (!validation.valid) {
  console.error('Export failed:', validation.errors);
}

// Get export summary
const result = adapter.export(workouts, config);
console.log(
  `Exported ${result.count} workouts to folder: ${result.destination}`
);
```

**Key Differences from Calendar-Based Export**:

- No `start_date_local` field in workout payloads
- Uses `/folders` and `/workouts` endpoints (not `/events/bulk`)
- Workouts organized by `folder_id` instead of dates
- Users schedule workouts in Intervals.icu by dragging to calendar

**API Endpoints**:

```typescript
// Get current athlete (fetch real athlete ID)
GET /api/v1/athlete/0
Response: { id: 12345, name: "Athlete Name", email: "..." }

// Create folder (uses real athlete ID)
POST /api/v1/athlete/{athleteId}/folders
{
  "name": "Cycling Base Training",
  "description": "Base training workouts"
}

// Create workout template (uses real athlete ID)
POST /api/v1/athlete/{athleteId}/workouts
{
  "category": "WORKOUT",
  "type": "Ride",
  "name": "Sweet Spot Intervals",
  "description": "4x10min @ 88-93% FTP\n\n**Coach Notes:**...",
  "moving_time": 3600,
  "icu_training_load": 85,
  "folder_id": 123  // Optional folder organization
}
```

**Note**: The integration first calls `GET /athlete/0` to fetch the current user's athlete ID, then uses that real ID (`/athlete/{athleteId}/`) in folder and workout API calls.

**Error Handling**:

```typescript
// API client returns ApiResponse<T>
const result = await createIntervalsWorkout(payload);

if (result.success) {
  console.log('Created workout:', result.data.id);
} else {
  // Handle errors: NO_API_KEY, INVALID_API_KEY, EXPORT_ERROR, API_ERROR
  console.error('Export failed:', result.error.message);
}
```

**Testing**:

- 100% coverage on adapter, API client, and schemas
- 139 total tests for Intervals.icu integration
- Tests located in `tests/unit/export/adapters/intervalsicu/`

---

## Common Tasks

### Adding a New Service

1. Create file in `src/services/myService.ts`
2. Export functions with explicit return types
3. Import from `@/services/myService`
4. Create tests in `tests/unit/services/myService.test.ts`
5. Run `make test-unit` to verify

### Adding a New Component

1. Create in `src/popup/components/MyComponent.tsx`
2. Use `ReactElement` return type
3. Import hooks from `@/hooks/`
4. Use Tailwind for styling
5. Export as named export

### Adding a Zod Schema

1. Create in `src/schemas/mySchema.ts`
2. Define schema: `export const MySchema = z.object({...})`
3. Export inferred type: `export type MyType = z.infer<typeof MySchema>`
4. Use `MySchema.parse(data)` for validation

### Running Quality Checks

```bash
make check        # Lint + Type check
make test-unit    # Run tests
make coverage     # Coverage report
make pre-commit   # Full pre-commit check
```

---

## Troubleshooting

### Extension Not Loading

**Issue**: Chrome rejects the extension
**Fix**:

```bash
make clean
make build
# Reload in chrome://extensions
```

### Tests Failing

**Issue**: Chrome API not mocked
**Fix**: Check `tests/setup.ts` has all needed mocks

**Issue**: Import errors with `@/`
**Fix**: Ensure `vitest.config.ts` has path alias configured

### Build Errors

**Issue**: TypeScript errors
**Fix**: `make type-check` for details

**Issue**: Vite build fails
**Fix**: Check `vite.config.ts` manifest path

### Token Not Intercepting

**Issue**: Extension doesn't detect TrainingPeaks login
**Fix**:

- Check you're on `app.trainingpeaks.com`
- Open DevTools → Console for content script logs
- Trigger an API request (click around TrainingPeaks), or click **Refresh** in
  the popup

### Refreshing sign-in without disrupting the user

The extension holds no credential of its own: tokens are only visible when the
site's page makes an authenticated request. A **Refresh** therefore asks the
background (`REFRESH_PROVIDER_AUTH` → `src/services/authRefreshService.ts`) to
open a temporary **background** tab on the site, wait for the token to land in
storage, and close the tab. Rules:

- Never reload or focus the user's own tab; that is exactly the disruption
  this replaces. `reloadPlanMyPeakTab` (an explicit data refresh) is the one
  deliberate exception and is only run when the user asks for it.
- A background tab, not a window: a new window steals focus and closes the
  popup.
- If no token arrives within `AUTH_REFRESH_TIMEOUT_MS` the tab is left open and
  brought forward: the user almost certainly has to sign in.
- The popup awaits the background's verdict (`useProviderAuthRefresh`) instead
  of guessing with a timer; the stores update live via `chrome.storage.onChanged`.
- The message opens tabs, so it is accepted only from extension pages and the
  PlanMyPeak overlay's allowlisted origin.

---

## Performance Budget

- **Bundle Size**: <2MB total (currently 254KB ✅)
- **Popup Open**: <200ms (currently <50ms ✅)
- **Extension Load**: <500ms initialization
- **Test Execution**: <5s for unit tests (currently 1.15s ✅)

---

## Security Considerations

**Token Storage**

- ✅ Use `chrome.storage.local` (encrypted by browser)
- ✅ Never log tokens in production
- ✅ No token transmission to third parties

**Permissions**

- ✅ Minimal required permissions only
- ✅ Host permissions restricted to TrainingPeaks domains

**CSP**

- ✅ Strict Content Security Policy
- ✅ No inline scripts
- ✅ No `eval()` or remote code execution

### This repository is public: what must never be committed

Everything in this repo, including docs, `openspec/` change notes, test
fixtures and commit messages, is readable by anyone. Before saving a file,
check it against this list. When in doubt, describe the thing generically
("the retired Supabase project", "the PlanMyPeak seed data") instead of naming
it.

**Never commit**:

- Any credential: TrainingPeaks or PlanMyPeak tokens, Supabase service-role or
  JWT secrets, Intervals.icu API keys, `.env` contents. The Supabase **anon**
  key in `src/utils/constants.ts` is the one exception: it is the publishable
  key already shipped in the portal's browser bundle.
- Anything about PlanMyPeak that a signed-in coach cannot see in their own
  browser: private repository names, local filesystem paths, migration or
  infrastructure file names (`infra/…`, `*.hcl`, `supabase/migrations/…`),
  PR numbers from other repos, database table or column names, internal
  admin features, hosts that are defined in infra but not served.
- Retired or unused hosts and project refs (old Supabase project ids, unused
  API subdomains). A decommissioned host is a lead for an attacker and
  useless to a reader.
- Real user data: coach or athlete names, emails, ids, captured workout
  bodies, exported debug logs. Fixtures use `example.com` addresses and
  invented ids.

**Allowed, because the browser already shows it**: the production and staging
app origins, `/api/backend/*` paths the portal itself calls, request and
response JSON shapes, and the site-control protocol the page runs.

**Cross-repo notes**: when a file is mirrored in the PlanMyPeak app, say so
without its path in that repo. Scratch notes belong in the ignored `.tmp/`
directory, not in `docs/` or `openspec/`.

---

## Links & References

**GitHub Issues**: [Issue #1](https://github.com/PlanMyPeak/cycling_coach_browser_plugin/issues/1)
**Architecture**: `docs/Issue-1-TrainingPeaks-Plugin-Architecture.md`
**Testing Guide**: `TESTING.md`
**User Guide**: `README.md`

**External Docs**:

- [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Guide](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Vite Docs](https://vitejs.dev/)
- [React Query Docs](https://tanstack.com/query/latest)
- [Zustand Docs](https://github.com/pmndrs/zustand)

---

## If you are working on a new integration

read @docs/EXPORT_DESTINATION_INTEGRATION_FLOW.md

---

**Last Updated**: 2026-09-17
**Maintained By**: Claude
**For Questions**: See README.md or architecture documentation
