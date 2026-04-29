# Tech Debt & Dead Code Cleanup

A scan of `src/` and `supabase/` turned up a manageable amount of dead code and a few small backend issues. Nothing is broken — this is hygiene work to shrink bundle size, speed up builds, and reduce future confusion.

## Findings

### 1. Dead frontend files (safe to delete)
- **`src/lib/mockData.ts`** (155 lines) — not imported anywhere. Leftover from early prototyping.
- **`src/components/NavLink.tsx`** (28 lines) — not imported anywhere. `BottomNav` uses react-router's `NavLink` directly.
- **`src/App.css`** (42 lines) — not imported anywhere (`index.css` is the active stylesheet).
- **`src/tailwind.config.lov.json`** (190 KB) — legacy artifact; `tailwind.config.ts` at the project root is the real config.

### 2. Unused shadcn/ui components (36 of 49)
Only 13 of the 49 shadcn primitives in `src/components/ui/` are actually imported. The other 36 are dead weight pulling in `@radix-ui/*` deps.

Unused: `accordion, alert-dialog, alert, aspect-ratio, avatar, badge, breadcrumb, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, drawer, dropdown-menu, form, hover-card, input-otp, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, sidebar, slider, switch, table, tabs, textarea, toggle-group`.

### 3. Theme system mismatch (low priority)
`useTheme`/`ThemeProvider` is the app's source of truth, but `src/components/ui/sonner.tsx` reads from `next-themes` instead. Toast theme can drift from app theme. Fix: switch `sonner.tsx` to use our `useTheme`.

### 4. Minor backend debt
- **`scan_log`** is written by `discover-new-restaurants` but never read. Either surface it ("Last scan: 2h ago") or drop the writes + table.
- **Missing indexes** on hot queries: `restaurant_sightings (city, first_seen_at DESC)` and `push_subscriptions (enabled, frequency) WHERE enabled = true`.
- **`api_key_status`** has public `SELECT true` RLS. No secrets are exposed, but key names + exhaustion timestamps don't need to be public — tighten to service role only.

## Proposed cleanup

1. Delete the 4 dead frontend files.
2. Delete the 36 unused `src/components/ui/*.tsx` files.
3. `bun remove` any `@radix-ui/*` packages with zero remaining importers, plus `next-themes` if unused.
4. Fix `sonner.tsx` to use our `useTheme`.
5. Migration: add the two indexes; tighten `api_key_status` RLS.
6. Decide on `scan_log` — default is **remove** unless you want it surfaced.

## Regression validation plan

Run after each cleanup batch (frontend, deps, backend) so a failure is easy to attribute.

**Automated**
- `lovable-exec test` — runs the existing Vitest suite (currently just `example.test.ts`). Before the cleanup, add a small set of smoke tests so removals are actually exercised:
  - `App.test.tsx` — renders `<App />` inside `MemoryRouter`, asserts no throw and `BottomNav` is present.
  - `Settings.test.tsx` — renders Settings, toggles theme, toggles a frequency option, asserts state changes.
  - `RestaurantFeed.test.tsx` — renders with mocked `getRestaurants` (empty + populated), asserts list renders and empty state shows.
- `tsc --noEmit` (build step) — catches any orphaned imports left behind by file deletions.
- `supabase--linter` — re-run after the migration to confirm no new RLS warnings.
- `supabase--test_edge_functions` on `get-restaurants`, `discover-new-restaurants`, `subscribe-push`, `send-push-notifications` — add minimal Deno tests that hit each function's happy path and one error path. Confirms the index migration didn't break queries and RLS tightening didn't break the service-role reads.

**Manual smoke (preview)**
- `/` Index — feed loads, city filter chips work, pull-to-refresh fires, infinite scroll loads more.
- `/settings` — change theme, change cities (save persists), toggle frequency on/off, enable push (permission prompt), send test push, disable push.
- `/nonexistent` — NotFound renders.
- DevTools Network tab — confirm `get-restaurants` returns 200 and the response shape is unchanged.
- Lighthouse / bundle size — record `dist/` size before and after; expect a measurable drop from removing the 36 ui files + Radix deps.

**Backend spot-checks** (`supabase--curl_edge_functions`)
- `GET /get-restaurants?cities=Detroit&limit=5` — 200 with restaurants array.
- `POST /discover-new-restaurants` — runs without RLS errors against `api_key_status`.
- `POST /test-push` with a known device id — push delivered.

**Rollback criteria**
If any of: TS build fails, Vitest suite fails, edge function tests fail, or manual smoke shows a broken screen → revert that batch's changes (frontend / deps / backend are independently revertible) before continuing.

## What I'd skip
- Don't refactor the theme system beyond the `sonner` fix.
- Don't touch edge function business logic.
- Don't reorganize folders.

## Question for you
For `scan_log` — surface it in the UI ("Last scan: X ago") or remove it entirely? Default is **remove** unless you say otherwise.
