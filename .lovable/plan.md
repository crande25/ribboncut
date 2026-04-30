# Make the leaked service-role JWT worthless (without rotation)

## Goal

We can't rotate the leaked `service_role` JWT (no Supabase dashboard access). So instead, neutralize it: every place the leaked token is currently accepted gets re-keyed to use a **new bearer secret** that lives only in Vault. After this, anyone holding the leaked JWT can still hit edge functions (it's a valid signed JWT and the gateway will accept the signature) — but every function will refuse to do anything because the `Authorization` header no longer matches the new shared secret. And direct PostgREST/SQL access via the JWT is blocked by RLS (you already have proper RLS on every public table — verified).

## What's currently exposed

Confirmed by inspection of `cron.job.command` and `rg "Bearer eyJ"`:

| Where | Token leaked? | Severity |
|---|---|---|
| `supabase/migrations/20260430164028_*.sql` (file on disk) | service_role | repo + git history |
| cron jobid 41 (`discover-new-restaurants-daily`) | service_role | DB + would also leak via any pg_dump |
| cron jobid 39 (`send-push-notifications-hourly`) | service_role | DB |
| cron jobid 36 (`nightly-backfill-categories`) | anon (in both `apikey` and `Authorization`!) | DB — also wrong (should never have been anon) |
| cron jobid 40 (`process-email-queue`) | already uses Vault | clean |
| codebase elsewhere | none | clean (rg confirmed) |

`send-push-notifications/index.ts` has **no auth check whatsoever** (the `rg` for "Authorization" returned hits in another file). Anyone with the URL can fan out push notifications today, leaked JWT or not. We'll fix that too.

## Approach: a new shared secret, stored in Vault

Introduce a new secret `internal_cron_token` (random 64-byte hex, never a JWT) stored in `vault.secrets`. Every cron-triggered function will accept **only** a request whose `Authorization: Bearer <X>` matches this Vault secret. The leaked `service_role` JWT becomes useless against these functions.

Why a custom shared secret instead of "rotate to a new service-role JWT and check `claims.role === service_role`":

- Rotating service-role isn't available to us.
- Checking only `claims.role === service_role` means **the leaked JWT still works** — it has that claim, signed with the project's HMAC secret (which we also can't rotate). So gateway-verified JWT auth alone doesn't neutralize the leak.
- A custom shared secret is fully under our control: stored encrypted in Vault, never in repo, never in `cron.job.command`, rotatable any time by `update vault.secrets`.

## Plan of work

### 1. Generate the new internal cron token + put it in Vault

One migration that:

- Calls `vault.create_secret(encode(gen_random_bytes(48), 'hex'), 'internal_cron_token', 'Shared secret for cron→edge-function calls')`.
- Idempotent guard: skip if the secret already exists.
- Also `update`s the existing `email_queue_service_role_key` Vault entry to a NOTE that it's deprecated (we'll migrate `process-email-queue` off it too in step 3 so everything uses one mechanism).

The token never leaves the database. I won't print it, log it, or echo it back. Edge functions read it via `vault.decrypted_secrets` at call time? No — edge functions can't read Vault. Instead they'll read it from a **runtime secret** with the same value. So:

- Migration generates the secret and writes it to Vault.
- I'll then have you copy the value out of Vault (one SELECT in Cloud → Database → SQL Editor) and store it in Lovable Cloud Secrets as `INTERNAL_CRON_TOKEN`. The edge functions read `Deno.env.get("INTERNAL_CRON_TOKEN")`.

That's the one manual step. After that, rotation is a single `update vault.secrets` + a single secret update — no code changes.

### 2. Re-schedule all 4 crons to use the Vault token

Replace the inline `Bearer eyJ...` in jobs 36, 39, 41 (and re-point job 40) to:

```sql
'Authorization', 'Bearer ' || (
  select decrypted_secret from vault.decrypted_secrets where name = 'internal_cron_token'
)
```

Job 36 also gets its `apikey` header fixed (the anon JWT in there is unnecessary and was itself leaked into the cron command — replacing the whole header block).

After this: `select command from cron.job` contains zero JWTs of any kind.

### 3. Lock down each function to require `INTERNAL_CRON_TOKEN`

For `discover-new-restaurants`, `backfill-categories`, `send-push-notifications`, and `process-email-queue`:

- Add a uniform auth gate at the top of the handler that compares `Authorization: Bearer <X>` against `Deno.env.get("INTERNAL_CRON_TOKEN")` using **constant-time comparison** (to avoid timing attacks on a shared secret).
- Remove the existing `token === SUPABASE_SERVICE_ROLE_KEY` checks and the `claims.role === 'service_role'` checks where they exist. Single auth model going forward.
- Set `verify_jwt = false` in `supabase/config.toml` for all four functions. We're no longer using JWT verification at all — the gateway should not gate these. (`process-email-queue` is currently `verify_jwt = true`; we're changing that.)

`send-push-notifications` gets the auth gate added for the first time (currently has none — separate but related leak fix).

### 4. Scrub the leaked migration file

Overwrite `supabase/migrations/20260430164028_76a11904-d32c-46fb-8eb1-3c1b5b2f0ea1.sql` with a comment-only stub:

```sql
-- This file previously contained a one-off net.http_post invocation with a
-- hardcoded service_role JWT in the Authorization header. The token was
-- leaked into git history. As of 2026-04-30, that JWT is no longer accepted
-- by any of our edge functions; auth is gated on a Vault-backed shared
-- secret instead. See CHANGELOG.md for details.
```

The token still exists in git history — unavoidable without history rewriting — but it's worthless after step 3.

### 5. Verify

After deploy:
- `psql -c "SELECT command FROM cron.job WHERE command ~ 'eyJ'"` → expect 0 rows.
- `rg "eyJ" supabase/` → expect only the comment in the scrubbed migration (which doesn't actually contain a token).
- Manually `curl` `discover-new-restaurants` with the OLD leaked JWT → expect `403`.
- Manually `curl` it with the new `INTERNAL_CRON_TOKEN` → expect `[discover] starting scan` in the logs.
- Wait one cron tick of `process-email-queue` (5s) → expect a successful drain (this also fixes the silent email-queue outage from the stale `email_queue_service_role_key` vault entry).

### 6. CHANGELOG

Dated entry covering: leak, neutralization strategy (shared-secret instead of JWT), 4 functions re-keyed, 4 crons re-scheduled, leaked migration scrubbed, push-notifications endpoint hardened (was unauth'd), email queue outage incidentally fixed. Note explicitly: leaked JWT remains in git history but is now worthless against this project's edge functions; direct PostgREST access via the JWT is blocked by existing RLS.

## Files touched

- `supabase/migrations/<new>_internal_cron_token.sql` — create Vault secret
- `supabase/migrations/<new>_reschedule_crons_with_vault_token.sql` — rewrite jobs 36, 39, 40, 41
- `supabase/migrations/20260430164028_76a11904-d32c-46fb-8eb1-3c1b5b2f0ea1.sql` — scrubbed to comment stub
- `supabase/functions/_shared/internalAuth.ts` — new shared helper (constant-time bearer check)
- `supabase/functions/discover-new-restaurants/index.ts` — swap auth check
- `supabase/functions/backfill-categories/index.ts` — swap auth check
- `supabase/functions/process-email-queue/index.ts` — swap auth check
- `supabase/functions/send-push-notifications/index.ts` — add auth check (was missing)
- `supabase/config.toml` — `verify_jwt = false` for all four
- `CHANGELOG.md` — dated entry

## What I need from you

After I run the first migration, I'll show you a one-line `SELECT` to run in Cloud → Database → SQL Editor that prints the new token. Then add it as `INTERNAL_CRON_TOKEN` in Cloud → Secrets. After that I'll deploy the function changes and re-schedule the crons.

## Out of scope

- Rotating the actual service-role JWT (you can't, I can't — only Lovable support can; raise a ticket whenever you want and we'll layer that on top).
- Rewriting git history to remove the migration file from past commits (would require a force-push and disrupts everyone).
- Touching the `yelp-headers-probe` throwaway function — kill it separately when you're ready.
