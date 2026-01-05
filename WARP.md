# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Tooling and common commands

This is a Vite + React + TypeScript + Tailwind CSS single-page app.

- Install dependencies:
  - `npm install`
- Start development server (Vite):
  - `npm run dev`
  - Default port is `5175` and `host: true` is enabled in `vite.config.ts` for Docker/remote access.
- Type-check and build for production:
  - `npm run build`
  - Runs `tsc -b` followed by `vite build`.
- Lint the project with ESLint:
  - `npm run lint`
- Preview the production build locally:
  - `npm run preview`

There are currently no test scripts defined in `package.json`.

## Environment and configuration

The app relies on Vite environment variables (exposed to the client) for Supabase and Cloudflare R2 integration:

- Supabase (`src/lib/supabase.ts`):
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Cloudflare R2 (`src/lib/r2.ts`, admin submissions view):
  - `VITE_R2_ENDPOINT`
  - `VITE_R2_ACCESS_KEY_ID`
  - `VITE_R2_SECRET_ACCESS_KEY`
  - `VITE_R2_BUCKET_NAME`
  - `VITE_R2_PUBLIC_URL` (or falls back to `VITE_R2_ENDPOINT` when building public video URLs)

Vite is configured with an alias in `vite.config.ts`:

- `@` → `./src`

Use this alias (e.g. `@/components/...`, `@/lib/...`) instead of relative import chains where possible.

Tailwind is configured in `tailwind.config.js` with `darkMode: "class"` and content scanning of `./src/**/*.{ts,tsx}` plus some top-level folders. Theme tokens are defined via CSS variables (`--primary`, `--background`, etc.) and are consumed throughout the UI.

## High-level architecture

### Entry point, routing, and layout

- The React entry point is `src/main.tsx`, which mounts `<App />` into the `#root` element.
- Application routing is defined in `src/App.tsx` using `react-router-dom`:
  - Public route: `/login` (`LoginPage`).
  - All other routes are wrapped in `<RequireAuth>` and rendered inside `<AppLayout>`:
    - `/` → dashboard (simple overview view defined inline in `App.tsx`).
    - `/calendar` → `CalendarPage` (workout calendar and daily workout list).
    - `/upload` → `UploadPage` (uses `VideoUploader` for general uploads).
    - `/profile` → `ProfilePage` (placeholder for user settings/profile).
    - `/admin/deadlines` → `DeadlineManagement` (admin manages workout deadlines).
    - `/admin/submissions` → `SubmissionsPage` (admin views all user submissions).
- `AppLayout` (`src/components/layout/AppLayout.tsx`) provides the app shell:
  - Wraps the app in `ThemeProvider` (`src/components/theme-provider.tsx`) using storage key `fit-proof-theme`.
  - Uses `Sidebar` on desktop and `MobileNav` on smaller screens.
  - Renders route content via `<Outlet />` in the main content area.

### Authentication and authorization

- Authentication state and user profile management live in `src/context/AuthContext.tsx`:
  - Uses Supabase auth (`supabase.auth.getSession`, `onAuthStateChange`) to track `session` and `user`.
  - Fetches a matching `profiles` row from the `profiles` table (typed via `Database` in `src/types/database.types.ts`).
  - If no profile exists (PostgREST error code `PGRST116`), it creates one with:
    - `id` = Supabase user id.
    - `display_name` = email.
    - `role` = `'admin'` for a specific admin email (`estacercadeaqui@gmail.com`), otherwise `'client'`.
  - Exposes context value: `{ session, user, profile, loading, signInWithGoogle, signOut }`.
- `RequireAuth` (`src/components/auth/RequireAuth.tsx`) guards private routes:
  - While `loading` is `true`, shows a full-screen loading state.
  - If no `user`, redirects to `/login` (preserving the originating location in state).
- `LoginPage` (`src/pages/auth/LoginPage.tsx`) calls `signInWithGoogle()` from `useAuth` to initiate Google OAuth via Supabase.

Admin access is determined purely by the `profile.role` field (and ultimately by the hard-coded admin email logic in `AuthContext`). Admin-only screens check `profile?.role === 'admin'`.

### Data model and Supabase access

The app uses a typed Supabase client via `src/types/database.types.ts` and `src/lib/supabase.ts`.

Key tables (all under `Database['public']['Tables']`):

- `profiles`:
  - Identified by `id` (string, Supabase auth user id).
  - Stores `display_name`, `role` (`'admin' | 'client'`), `streak_count`, and `updated_at`.
- `deadlines`:
  - Fields include `id`, `title`, `target_time` (string, e.g. `"23:59"`), `frequency` (`'daily' | 'weekly' | 'monthly'`), `created_at`.
- `submissions`:
  - Represents workout submissions (currently focused on video uploads).
  - Fields include `id`, `user_id`, `type` (`'video' | 'comment'`), `r2_key`, `thumbnail_url`, `duration`, `comment_text`, `status` (`'success' | 'fail' | 'excused'`), `target_date` (`yyyy-MM-dd` date string), `created_at`.

Supabase access patterns are encapsulated in a small set of hooks and components:

- `useDeadlines` (`src/hooks/useDeadlines.ts`):
  - Fetches and orders all rows from `deadlines` (`order('id', { ascending: true })`).
  - Returns `{ deadlines, loading, error }`.
- `useSubmissions` (`src/hooks/useSubmissions.ts`):
  - Requires an authenticated user from `useAuth`.
  - Fetches submissions where `user_id` matches the current user, ordered by `created_at` (descending).
  - Returns `{ submissions, loading, error, refetch }`.
- `useProfile` (`src/hooks/useProfile.ts`):
  - Fetches the current user’s `profiles` row and exposes `{ profile, loading, error, setProfile }` for components that need direct profile access.

### Calendar workflow and workout history

- `CalendarPage` (`src/pages/calendar/CalendarPage.tsx`) is the central workout history view:
  - Uses FullCalendar (day grid) plus `useDeadlines` and `useSubmissions`.
  - Maintains `selectedDate` and `isUploadOpen` state.
  - Derives `selectedSubmissions` by filtering the current user’s submissions where `target_date` matches the `selectedDate`.
  - Builds a `dayDataMap` for a moving 62-day window (±31 days from today):
    - For each `deadline`, expands it into dates based on its `frequency` (`daily` or `weekly`) and associates colored indicators based on any matching submission’s `status`.
    - Separately flags dates that have at least one `submission` as `hasWorkout`.
  - Renders FullCalendar with:
    - Custom day cell content showing the day number and colored status dots.
    - Click handler that updates `selectedDate`.
  - Below the calendar, renders `WorkoutList` for the selected day.
  - Provides a floating action button that opens `UploadModal`, passing `selectedDate` and a callback to `refetch` submissions on successful upload.

- `WorkoutList` (`src/components/calendar/WorkoutList.tsx`) displays the per-day workout cards:
  - Accepts `date` and `submissions` (typed as `submissions.Row[]`).
  - Uses `WorkoutCard` to render individual submissions or shows a simple empty-state if none exist.

### Upload pipeline (Cloudflare R2 + Supabase)

Uploads are handled via the AWS SDK v3 against Cloudflare R2 using `r2Client` from `src/lib/r2.ts`.

- `r2Client` is an `S3Client` configured with:
  - `region: 'auto'`.
  - `endpoint` from `VITE_R2_ENDPOINT`.
  - `credentials` from `VITE_R2_ACCESS_KEY_ID` / `VITE_R2_SECRET_ACCESS_KEY`.
- `R2_BUCKET_NAME` is read from `VITE_R2_BUCKET_NAME`.

There are two primary upload entry points:

1. `VideoUploader` (`src/components/upload/VideoUploader.tsx`):
   - Used on the `/upload` page (general uploads, without a specific calendar date).
   - Validates file type (`MP4`, `MOV`, `WebM`) and size (≤ 100 MB).
   - Generates a thumbnail using `generateThumbnail` (`src/utils/thumbnail.ts`), which:
     - Creates a hidden `<video>` element and `<canvas>`, seeks to a given time (default 1s), draws the frame, and returns a base64 JPEG data URL.
   - Builds an R2 object key: `uploads/{user.id}/{timestamp}.{ext}`.
   - Converts the `File` to an `ArrayBuffer`, uploads via `PutObjectCommand`, and logs to the console.
   - On success, inserts a row into `submissions` with `status: 'success'` and optional `thumbnail_url`.

2. `UploadModal` (`src/components/upload/UploadModal.tsx`):
   - Used from `CalendarPage` to attach a video to a specific date.
   - Shares the same validations and upload mechanics as `VideoUploader`.
   - Additionally sets `target_date` on the `submissions` row using `format(targetDate, 'yyyy-MM-dd')`.
   - Exposes `onSuccess` so `CalendarPage` can refresh the submission list.

### Admin views and video review

Admin users (those whose `profiles.role` resolves to `'admin'`) have access to two admin screens, both wired from the sidebar / mobile nav based on `profile.role`:

- `DeadlineManagement` (`src/pages/admin/DeadlineManagement.tsx`):
  - Uses `useDeadlines` to display existing deadlines.
  - Provides a form to insert new rows into `deadlines` (title, target time, frequency).
  - Uses Supabase `insert` and `delete` on the `deadlines` table, followed by `window.location.reload()` to refresh data.
- `SubmissionsPage` (`src/pages/admin/SubmissionsPage.tsx`):
  - Checks `profile?.role !== 'admin'` and early-returns an access-denied message for non-admins.
  - On mount, fetches all `submissions` joined with `profiles(display_name)` and orders them by `created_at` descending.
  - Renders a grid of cards showing thumbnail (or placeholder), user display name, timestamp (formatted with `date-fns` and `ja` locale), and status with icon.
  - Builds a playable video URL using `VITE_R2_PUBLIC_URL` or `VITE_R2_ENDPOINT` and the stored `r2_key`.
  - On click, passes this URL to `VideoPlayerModal`.

`VideoPlayerModal` (`src/components/admin/VideoPlayerModal.tsx`) provides a custom video player overlay:

- Accepts `videoUrl` and `onClose`.
- Uses a `Slider`-based scrubber bound to playback progress.
- Tracks `isPlaying`, `isMuted`, `playbackRate`, and `progress` in component state.
- Offers quick-set playback speeds (1x to 3x) and basic play/pause and mute controls.

### Layout, navigation, and theming

- `Sidebar` and `MobileNav` (`src/components/layout/Sidebar.tsx`):
  - Define the primary navigation items (`Dashboard`, `Calendar`, `Upload`, `Profile`).
  - Conditionally append `Deadlines` and `Submissions` links when `profile.role === 'admin'`.
  - Use `useLocation` to style the active route.
  - Both provide an action to call `signOut()` from `useAuth`.
  - Include a `ModeToggle` control to switch themes.
- `ThemeProvider` (`src/components/theme-provider.tsx`) and `ModeToggle` (`src/components/mode-toggle.tsx`):
  - Implement a theme context backed by `localStorage` (key `fit-proof-theme`).
  - Tailwind’s `darkMode: 'class'` and the component-level classes (`bg-background`, `text-muted-foreground`, etc.) rely on the CSS variable theme defined in `src/index.css`.

- Shadcn-inspired primitives under `src/components/ui/` (`button`, `card`, `input`, `label`, `progress`, `scroll-area`, `sheet`, `slider`, `avatar`, etc.) are used extensively to build consistent UI without re-implementing basic components each time.

### Other notes

- The project is configured as a PWA via `vite-plugin-pwa` in `vite.config.ts`, with a manifest named "FitProof" and icons `pwa-192x192.png` / `pwa-512x512.png` included as assets.
- The utility `cn` (`src/lib/utils.ts`) wraps `clsx` and `tailwind-merge` and is used for Tailwind class composition.
