// Yelp API key pool with automatic rotation on quota/auth exhaustion.
//
// Keys are loaded from env vars: YELP_API_KEY, YELP_API_KEY_2, ..., YELP_API_KEY_20.
// Exhaustion is persisted to the `api_key_status` table with a `reset_at` timestamp.
// Each key has a monthly quota of 3,000 requests that resets on the 1st of each month (UTC).
//
// 401 → key is dead, mark exhausted + rotate.
// 403 → distinguish key-level (TOKEN_INVALID/MISSING/REVOKED, FORBIDDEN_CLIENT) vs
//       per-resource (BUSINESS_UNAVAILABLE etc.). Only key-level marks exhausted.
// 429 → distinguish ACCESS_LIMIT_REACHED (mark exhausted) vs
//       TOO_MANY_REQUESTS_PER_SECOND (back off + retry same key).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const MONTHLY_QUOTA = 3000;

export interface YelpFetchResult {
  ok: boolean;
  status: number;
  body?: any;
  rateLimited: boolean;
  authError: boolean;
  keyName: string;
  exhaustedAllKeys?: boolean;
}

interface KeyEntry {
  name: string;
  value: string;
  exhausted: boolean;
  resetAt?: Date;
  remainingUses: number;
}

/** Compute the next monthly quota reset: 1st of next month, midnight UTC. */
function nextMonthlyReset(): Date {
  const now = new Date();
  const year = now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const month = now.getUTCMonth() === 11 ? 0 : now.getUTCMonth() + 1;
  return new Date(Date.UTC(year, month, 1, 0, 0, 0));
}

export class YelpKeyPool {
  private keys: KeyEntry[] = [];
  private supabase: SupabaseClient;
  private loaded = false;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /** Discover all YELP_API_KEY* env vars and load their persisted exhaustion status. */
  async load(): Promise<void> {
    if (this.loaded) return;

    const candidates: KeyEntry[] = [];
    const primary = Deno.env.get("YELP_API_KEY");
    if (primary) candidates.push({ name: "YELP_API_KEY", value: primary, exhausted: false, remainingUses: MONTHLY_QUOTA });
    for (let i = 2; i <= 20; i++) {
      const v = Deno.env.get(`YELP_API_KEY_${i}`);
      if (v) candidates.push({ name: `YELP_API_KEY_${i}`, value: v, exhausted: false, remainingUses: MONTHLY_QUOTA });
    }
    if (candidates.length === 0) {
      throw new Error("No YELP_API_KEY* env vars found");
    }

    const { data: statuses } = await this.supabase
      .from("api_key_status")
      .select("key_name, exhausted_at, reset_at, remaining_uses")
      .eq("provider", "yelp")
      .in("key_name", candidates.map((c) => c.name));

    const now = new Date();
    const statusMap = new Map<string, { reset_at: string | null; remaining_uses: number | null }>();
    for (const s of statuses || []) statusMap.set(s.key_name, s);

    for (const c of candidates) {
      const s = statusMap.get(c.name);
      if (s) {
        // If reset_at is in the past, the key has rolled over to a new month — reset it
        if (s.reset_at && new Date(s.reset_at) <= now) {
          c.exhausted = false;
          c.remainingUses = MONTHLY_QUOTA;
          // Persist the reset
          await this.supabase.from("api_key_status").upsert({
            provider: "yelp",
            key_name: c.name,
            exhausted_at: null,
            reset_at: null,
            last_error: null,
            remaining_uses: MONTHLY_QUOTA,
            updated_at: now.toISOString(),
          }, { onConflict: "key_name" });
          console.log(`[yelp-pool] ${c.name} monthly reset — back to ${MONTHLY_QUOTA} uses`);
        } else if (s.reset_at && new Date(s.reset_at) > now) {
          // Still exhausted
          c.exhausted = true;
          c.resetAt = new Date(s.reset_at);
          c.remainingUses = s.remaining_uses ?? 0;
        } else {
          // Not exhausted, load persisted remaining
          c.remainingUses = s.remaining_uses ?? MONTHLY_QUOTA;
        }
      }
    }

    this.keys = candidates;
    this.loaded = true;

    const available = this.keys.filter((k) => !k.exhausted).length;
    console.log(`[yelp-pool] loaded ${this.keys.length} keys, ${available} available`);
    for (const k of this.keys) {
      console.log(`[yelp-pool]   ${k.name} remaining=${k.remainingUses}${k.exhausted ? ` EXHAUSTED until ${k.resetAt?.toISOString()}` : ""}`);
    }
  }

  /** Mark a key exhausted (persist to DB) until the 1st of next month. */
  private async markExhausted(keyName: string, status: number, errorBody: string): Promise<void> {
    const resetAt = nextMonthlyReset();
    const entry = this.keys.find((k) => k.name === keyName);
    if (entry) {
      entry.exhausted = true;
      entry.resetAt = resetAt;
      entry.remainingUses = 0;
    }
    console.warn(`[yelp-pool] marking ${keyName} EXHAUSTED status=${status} until=${resetAt.toISOString()}`);
    const { error } = await this.supabase.from("api_key_status").upsert(
      {
        provider: "yelp",
        key_name: keyName,
        exhausted_at: new Date().toISOString(),
        reset_at: resetAt.toISOString(),
        last_error: errorBody.slice(0, 500),
        last_status: status,
        remaining_uses: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key_name" },
    );
    if (error) console.error(`[yelp-pool] failed to persist exhaustion for ${keyName}:`, error.message);
  }

  /** Decrement remaining uses for a key after a successful request. */
  private async decrementUses(keyName: string): Promise<void> {
    const entry = this.keys.find((k) => k.name === keyName);
    if (!entry) return;

    entry.remainingUses = Math.max(0, entry.remainingUses - 1);

    // Persist the updated count
    await this.supabase.from("api_key_status").upsert(
      {
        provider: "yelp",
        key_name: keyName,
        remaining_uses: entry.remainingUses,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key_name" },
    );

    // Proactively exhaust if we've used all quota
    if (entry.remainingUses <= 0) {
      console.warn(`[yelp-pool] ${keyName} hit 0 remaining uses — marking exhausted proactively`);
      await this.markExhausted(keyName, 200, "Monthly quota of 3000 requests reached (proactive)");
    }
  }

  /** Get the first non-exhausted key, or null if all are exhausted. */
  private nextAvailable(): KeyEntry | null {
    return this.keys.find((k) => !k.exhausted) || null;
  }

  /** Fetch via Yelp with automatic key rotation on 429/401/403. */
  async fetch(url: string): Promise<YelpFetchResult> {
    if (!this.loaded) await this.load();

    while (true) {
      const key = this.nextAvailable();
      if (!key) {
        return {
          ok: false, status: 0, rateLimited: true, authError: false,
          keyName: "(none)", exhaustedAllKeys: true,
        };
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key.value}`, Accept: "application/json" },
      });

      // 401 = auth always means the key is bad. Rotate + persist.
      if (res.status === 401) {
        const body = await res.text();
        console.warn(`[yelp-pool] ${key.name} got 401: ${body.slice(0, 200)}`);
        await this.markExhausted(key.name, res.status, body);
        continue;
      }

      // 403 has TWO flavors:
      //   Key-level (TOKEN_INVALID/MISSING/REVOKED, UNAUTHORIZED, FORBIDDEN_CLIENT) → key is dead
      //   Per-resource (BUSINESS_UNAVAILABLE, etc.) → key is fine, just this resource fails
      if (res.status === 403) {
        const body = await res.text();
        const isKeyProblem = /TOKEN_INVALID|TOKEN_MISSING|TOKEN_REVOKED|UNAUTHORIZED|FORBIDDEN_CLIENT/i.test(body);
        console.warn(`[yelp-pool] ${key.name} got 403 (${isKeyProblem ? "key-level" : "per-resource"}): ${body.slice(0, 200)}`);
        if (isKeyProblem) {
          await this.markExhausted(key.name, res.status, body);
          continue;
        }
        // Per-resource 403 still counts as a use
        await this.decrementUses(key.name);
        return {
          ok: false, status: 403, body,
          rateLimited: false, authError: false, keyName: key.name,
        };
      }

      // 429 has TWO flavors:
      //   ACCESS_LIMIT_REACHED        → monthly quota dead until next reset → mark exhausted + rotate
      //   TOO_MANY_REQUESTS_PER_SECOND → transient throttle → back off briefly + retry SAME key
      if (res.status === 429) {
        const body = await res.text();
        const isPerSecond = /TOO_MANY_REQUESTS_PER_SECOND/i.test(body);
        const isQuotaExhausted = /ACCESS_LIMIT_REACHED/i.test(body);
        console.warn(`[yelp-pool] ${key.name} got 429 (${isPerSecond ? "per-second" : isQuotaExhausted ? "quota" : "unknown"}): ${body.slice(0, 200)}`);
        if (isPerSecond) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        await this.markExhausted(key.name, res.status, body);
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        await this.decrementUses(key.name);
        return {
          ok: false, status: res.status, body,
          rateLimited: false, authError: false, keyName: key.name,
        };
      }

      const data = await res.json();
      await this.decrementUses(key.name);
      console.log(`[yelp-pool] success: ${key.name} served request (${key.remainingUses} remaining)`);
      return {
        ok: true, status: 200, body: data,
        rateLimited: false, authError: false, keyName: key.name,
      };
    }
  }

  /** Snapshot of pool state for debugging/responses. */
  status() {
    return this.keys.map((k) => ({
      name: k.name,
      exhausted: k.exhausted,
      remaining_uses: k.remainingUses,
      reset_at: k.resetAt?.toISOString() || null,
    }));
  }
}
