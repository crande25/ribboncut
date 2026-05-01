
# Admin Dashboard Plan

## Approach

A hidden `/admin` route with no links from the main UI. Non-admin users see nothing different. Admin access requires email/password login verified against a `user_roles` table.

## Database Changes

1. **Create `user_roles` table** with enum `app_role` ('admin') and RLS using a `has_role` security-definer function (standard pattern from project guidelines).
2. **Create a `profiles` table** (minimal: `id` FK to `auth.users`, `email`) with auto-create trigger on signup.
3. **Seed your admin user** — you'll sign up via the admin login form, then I'll provide a migration to grant the admin role to your user ID.

## Auth

- Email/password signup+login on the `/admin` route itself (inline form, no global UI changes).
- No auto-confirm — you verify email first.
- Google OAuth optional (can add later).
- No "admin" button in BottomNav or anywhere visible.

## Frontend

- **`/admin` route** — if not authenticated or not admin, shows a simple login form. If admin, shows the dashboard.
- **`/admin` login form** — email + password, sign up / sign in toggle. Minimal, no branding clutter.
- **Admin Dashboard tabs/sections:**
  - **API Key Health** — calls `yelp-key-sanity-check` edge function, displays results.
  - **Fire Discovery** — button to invoke `discover-new-restaurants` edge function with city picker.
  - **Restaurant Stats** — query `restaurant_sightings` grouped by date, show daily new additions chart/table.
  - **Errors/Logs** — display recent `api_key_status` errors and any edge function error summaries from the DB.

## Security

- `user_roles` table has RLS; only service_role can write.
- `has_role()` security-definer function prevents recursive RLS.
- Admin dashboard queries use the authenticated user's session; edge function invocations go through the standard Supabase client (anon key + user JWT).
- Edge functions that the admin triggers (sanity check, discovery) already use `verify_jwt = false` with internal auth — we'll add an alternate admin-auth path that checks the JWT's user has the admin role.

## Files

| File | Action |
|------|--------|
| Migration SQL | Create `app_role` enum, `user_roles`, `profiles`, `has_role()` fn, triggers, RLS |
| `src/pages/Admin.tsx` | New page — login form + dashboard |
| `src/components/admin/*` | ApiKeyHealth, DiscoveryRunner, RestaurantStats, ErrorLog components |
| `src/hooks/useAdminAuth.ts` | Hook: check auth state + admin role |
| `src/App.tsx` | Add `/admin` route |

No changes to BottomNav, Index, Settings, or any public-facing component.

## Technical Details

- The `has_role` function queries `user_roles` with `SECURITY DEFINER` to avoid RLS recursion.
- Admin check on the client: after login, call `supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' })`. If false, show "Access denied."
- For triggering edge functions from admin UI, use `supabase.functions.invoke(...)` which includes the user's JWT automatically.
- Discovery and sanity-check functions currently use `INTERNAL_CRON_TOKEN` auth. We'll add a secondary auth path: if `Authorization` header contains a valid Supabase JWT for an admin user, also allow the request. This keeps cron working as-is while enabling admin UI triggers.
