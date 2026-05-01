
## Changes

### 1. Strip signup from AdminLogin
- Remove the `onSignUp` prop and signup mode toggle from `AdminLogin.tsx`
- The form becomes sign-in only — no way for new users to self-register through `/admin`
- Remove `signUp` usage from `Admin.tsx`

### 2. Add "Users" tab to admin dashboard
- Add a new tab called **Users** to the dashboard
- New component `src/components/admin/UserManagement.tsx`:
  - Lists current admins (queries `user_roles` joined with `profiles`)
  - **Grant admin** form: enter an email, look up their `user_id` in `profiles`, insert into `user_roles`
  - **Revoke admin** button next to each admin (except yourself)
- This requires the authenticated admin to be able to insert/delete from `user_roles`, so we need an RLS policy update

### 3. Database migration
- Add RLS policies on `user_roles` so that admins can **insert** and **delete** roles (using the existing `has_role()` function)
- Add an RLS policy on `profiles` so admins can **read all profiles** (needed to look up a user by email when granting admin)

### Technical details

**New RLS policies:**
```sql
-- Admins can grant roles
CREATE POLICY "Admins can insert roles"
  ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admins can revoke roles
CREATE POLICY "Admins can delete roles"
  ON public.user_roles FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admins can read all profiles (for email lookup)
CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
```

**New admin must already have a Supabase auth account** (signed up elsewhere or created by you manually). The grant flow is: existing admin enters email → system looks up profile → inserts admin role.

**Files changed:**
- `src/components/admin/AdminLogin.tsx` — remove signup
- `src/pages/Admin.tsx` — remove signUp prop, add Users tab
- `src/components/admin/UserManagement.tsx` — new component
- `src/hooks/useAdminAuth.ts` — can remove `signUp` export
- Migration SQL — new RLS policies
- `CHANGELOG.md`
