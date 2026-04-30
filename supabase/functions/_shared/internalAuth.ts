// Constant-time bearer-token check against the INTERNAL_CRON_TOKEN env var.
//
// This is the auth gate for cron-triggered edge functions. The pg_cron jobs
// pass `Authorization: Bearer <token>` where <token> matches a Vault secret
// kept in sync with this env var. Using a custom shared secret (rather than
// the project's service_role JWT) means we can rotate auth on these functions
// at any time, independent of the project's signing keys, by updating both
// the Vault entry and this env var.
export function checkInternalAuth(req: Request): { ok: true } | { ok: false; status: number; body: { error: string } } {
  const expected = Deno.env.get("INTERNAL_CRON_TOKEN");
  if (!expected || expected.length < 32) {
    console.error("[internalAuth] INTERNAL_CRON_TOKEN missing or too short");
    return { ok: false, status: 500, body: { error: "Server misconfigured" } };
  }
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (token.length !== expected.length) {
    return { ok: false, status: 403, body: { error: "Forbidden" } };
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  if (diff !== 0) {
    return { ok: false, status: 403, body: { error: "Forbidden" } };
  }
  return { ok: true };
}
