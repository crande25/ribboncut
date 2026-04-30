## The actual problem

`discover-new-restaurants` authenticates callers by **string-comparing** the bearer token to the runtime `SUPABASE_SERVICE_ROLE_KEY` env var:

```ts
const authorized = token.length > 0 && token === SUPABASE_SERVICE_ROLE_KEY;
```

The cron job (`discover-new-restaurants-daily`, jobid 41) has a service-role JWT **hardcoded** into its `net.http_post` headers. When Lovable Cloud rotated the project's service role key, the runtime env var changed but the cron's hardcoded JWT did not — so every nightly invocation now returns `403 Forbidden` before doing any work. Edge logs confirm: only `[discover] forbidden` lines, zero `[discover] starting scan` lines for recent runs.

This — not Yelp key exhaustion — is why no restaurants have been added recently. The Yelp pool issue is real but secondary; the function never even reaches the Yelp call.

The vault entry `email_queue_service_role_key` is also stale, so re-pointing the cron at the vault won't help either.

## The fix

Adopt the same pattern `process-email-queue` already uses successfully:

1. Set `verify_jwt = true` on the function in `supabase/config.toml`. The Supabase gateway will validate the JWT signature against the project's JWKS **before** the handler runs. Any forged token is rejected at the edge.
2. In the handler, replace the brittle string-equality check with a parsed-claims check: accept the request only if `claims.role === 'service_role'`. Because the gateway has already verified the signature, trusting the `role` claim is safe — this is exactly what `process-email-queue` does.
3. No changes needed to the cron job, the vault, or any keys. The hardcoded JWT in the cron is a valid, signed service-role JWT — it just stopped matching the rotated env var. With signature-based verification, it works again.

## Why this is the right fix (vs. alternatives)

- **Re-storing the current service role key in vault** — would work today but breaks again on the next key rotation. Same fragility, just postponed.
- **Adding a separate ad-hoc admin token** — extra secret to manage, doesn't fix the nightly cron, and we'd still have the long-term rotation problem.
- **Switching to gateway JWT verification** — matches the existing `process-email-queue` pattern, survives future key rotations, and removes the stale-token failure mode permanently.

## Plan of work

1. **Patch `supabase/functions/discover-new-restaurants/index.ts`**
   - Remove the `token === SUPABASE_SERVICE_ROLE_KEY` check.
   - Add a `parseJwtClaims` helper (copy the one already used in `process-email-queue`) and require `claims.role === 'service_role'`.
   - Update the comment block above the auth check to reflect the new model (gateway verifies signature; handler checks role).
   - Keep using `SUPABASE_SERVICE_ROLE_KEY` for the `createClient` call — that part is fine.

2. **Update `supabase/config.toml`**
   - Add a `[functions.discover-new-restaurants]` block with `verify_jwt = true`.

3. **Verify end-to-end**
   - Deploy the function.
   - Manually trigger via `net.http_post` using the cron's existing hardcoded JWT and confirm a `[discover] starting scan` log line appears.
   - Re-run the on-demand "last 7 days, key 3 only" discovery you originally asked for: I'll temporarily mark `YELP_API_KEY` and `YELP_API_KEY_2` as exhausted, fire three chunks (8 / 8 / 4 cities) sequentially with `days=7`, then restore the key states.

4. **CHANGELOG**
   - Append a dated entry covering: root-cause of recent zero-discovery nights (stale hardcoded JWT vs. rotated runtime key), the move to gateway-verified JWT, and the one-off backfill scan.

## Files touched

- `supabase/functions/discover-new-restaurants/index.ts` — auth check rewrite
- `supabase/config.toml` — add `verify_jwt = true` for this function
- `CHANGELOG.md` — dated entry
- DB (no schema change): temporary `api_key_status` rows toggled and reverted around the manual scan

## Out of scope

- Rotating the cron's hardcoded JWT to something fresher — not needed; signature-based verification makes the existing one valid indefinitely (until the JWT itself expires in 2036 per the embedded `exp` claim).
- Touching `process-email-queue` / `send-push-notifications` / other functions — they already use the correct pattern or are not affected.
- The earlier monthly-vs-daily Yelp reset window discussion — still a real issue, but tracked separately; not part of this fix.
