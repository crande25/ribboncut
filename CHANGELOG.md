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
