# Changelog

All notable changes to RibbonCut are documented here.

Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Dates are `YYYY-MM-DD`. Newest entries on top.

Categories used:
- **Added** — new features
- **Changed** — changes to existing behavior
- **Fixed** — bug fixes
- **Security** — vulnerability patches and dependency bumps for CVEs
- **Dependencies** — non-security dependency updates

---

## 2026-04-30

### Fixed
- **Discovery cron auth (root cause of zero-discovery nights)** — `discover-new-restaurants` was rejecting every nightly invocation with `403 Forbidden`. The handler did exact string-equality between the bearer token and the runtime `SUPABASE_SERVICE_ROLE_KEY` env var, but the cron job had a hardcoded service-role JWT that no longer matched after a key rotation. Switched to gateway-verified JWT (`verify_jwt = true` in `supabase/config.toml`) plus a `claims.role === 'service_role'` check in the handler — same pattern as `process-email-queue`. The cron's existing JWT now works again and remains valid across future rotations.

### Changed
- Ran a one-off discovery scan across all 20 SE Michigan cities for the past 7 days using only `YELP_API_KEY_3` (keys 1 and 2 were temporarily marked exhausted in `api_key_status` and restored after). Result: 129 new restaurant sightings inserted across every city.

---

## 2026-04-30

### Fixed
- **Nightly harvest**: Rescheduled `discover-new-restaurants-daily` cron from `0 6 * * *` UTC (≈2am ET) to `30 8 * * *` UTC (30 min after Yelp's daily quota reset at 08:00 UTC / midnight Pacific). The previous schedule ran *before* Yelp's reset, so on days when keys were exhausted the harvest started with no usable Yelp keys and inserted zero sightings even though the cron reported success.

## 2026-04-30 (later)

### Changed
- **ESLint backlog cleared (52 errors → 0).** Targeted cleanup so future regressions stand out:
  - Replaced `require("tailwindcss-animate")` in `tailwind.config.ts` with an ESM `import` (fixes `@typescript-eslint/no-require-imports`).
  - Auto-fixed one `prefer-const` in `discover-new-restaurants/index.ts`.
  - Replaced 8 `any` casts in frontend code (`useInstallPrompt`, `usePushNotifications`) with precise structural types (`Window & { MSStream?: unknown }`, `Navigator & { standalone?: boolean }`, `{ error?: string }`) — preserves runtime behavior, restores type-safety on browser APIs.
  - Fleshed out an empty `catch {}` in `CitySearch.tsx` with an explanatory comment so it no longer trips `no-empty`.
  - **Scoped `@typescript-eslint/no-explicit-any` off for `supabase/functions/**`** in `eslint.config.js`. Edge functions deal with untyped third-party API responses (Yelp, Google Places, Resend, web-push) where `any` is the pragmatic boundary type. Frontend code (`src/`) keeps the rule strict.
- **Cleared remaining `react-refresh/only-export-components` warnings** so the dev console is fully clean (0 errors / 0 warnings):
  - Extracted `ThemeContext` + `useTheme` hook + `Theme` type from `src/hooks/useTheme.tsx` into a new `src/hooks/themeContext.ts`. The `.tsx` file now exports only the `ThemeProvider` component, which lets Vite Fast Refresh hot-reload it without losing state. Updated `ThemeSelector` and `ui/sonner` to import the hook from `@/hooks/themeContext`.
  - Removed the `toast` re-export from `src/components/ui/sonner.tsx` so it's component-only. Consumers already import `toast` directly from `"sonner"`.

## 2026-04-30

### Security
- **Bumped `rollup` 4.24.0 → 4.60.2** to patch the Arbitrary File Write via Path Traversal vulnerability (Dependabot alert). Added `rollup` as a direct `devDependency` to override Vite's transitive resolution, which would otherwise have kept us on the vulnerable 4.24.x line.
- **Bumped `flatted` 3.3.1 → 3.4.2** via direct `devDependency` override. Flatted is a transitive dep used by ESLint's cache layer; its parent (`flat-cache`) pins `^3.2.9`, so a direct entry was required to force the patched version into the lockfile.
- **Verified patched versions already in lockfile after `bun update`:**
  - `@remix-run/router@1.23.2` (XSS via Open Redirects — not exploitable in our app since we use Declarative Mode `<BrowserRouter>`, but patched anyway)
  - `picomatch@4.0.4` (ReDoS via extglob quantifiers)
  - `minimatch@9.0.x` (ReDoS — patched via updated ESLint chain)

### Dependencies
- Ran `bun update` to refresh all packages to latest patch/minor versions within existing semver ranges. Notable bumps:
  - All Radix UI components → latest patch
  - `@supabase/supabase-js` 2.103.3 → 2.105.1
  - `@tanstack/react-query` 5.83.0 → 5.100.6
  - `eslint` 9.32.0 → 9.39.4
  - `typescript` 5.8.3 → 5.9.3
  - `vite` 5.4.19 → 5.4.21
  - `react-hook-form` 7.61.1 → 7.74.0
  - `react-router-dom` 6.30.1 → 6.30.3
- Major version bumps **NOT** applied (would require manual review for breaking changes): React 19, React Router 7, Tailwind 4, Vite 7, recharts 3.

### Fixed
- **Scroll position on route change.** Navigating between Feed (`/`) and Settings (`/settings`) preserved the previous page's scroll offset, which felt like a bug. Added a `ScrollToTop` component that listens to `useLocation` and resets `window.scrollTo(0, 0)` on every pathname change. Wired in as the first child of `<BrowserRouter>` in `src/App.tsx`.

### Added
- **Rotating tagline below `RibbonCut` header.** The "WHAT JUST HAPPENED" subtitle in the restaurant feed now rotates through a fixed sequence of phrases on every page load (navigation or refresh). Implemented as a `useRotatingTagline` hook that persists the current index in `localStorage` and increments it on each mount, ensuring users see the next phrase in the sequence on their next visit. Phrases (in order):
  1. What just opened
  2. Fresh out the kitchen
  3. New doors opened
  4. Cut the line
  5. Taste it first
  6. Be the first bite
  7. New flavors just dropped
  8. No old news
  9. Skip the classics
  10. Dine different
