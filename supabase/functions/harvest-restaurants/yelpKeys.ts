// Yelp API key pool with automatic rotation on quota/auth exhaustion.
//
// Keys are loaded from env vars: YELP_API_KEY, YELP_API_KEY_2, YELP_API_KEY_3, ...
// Exhaustion is persisted to the `api_key_status` table with a `reset_at` timestamp.
// Yelp's daily quota resets at midnight Pacific Time.

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
}

/** Compute the next Yelp daily-quota reset: midnight Pacific Time. */
function nextYelpReset(): Date {
  // Pacific is UTC-8 (PST) or UTC-7 (PDT). We approximate to UTC-8 for safety
  // (a slightly later reset just means we re-try a key one hour late at worst).
  const now = new Date();
  const pacificOffsetHours = 8;
  // Current time in pacific
  const pacificMs = now.getTime() - pacificOffsetHours * 3600 * 1000;
  const pacific = new Date(pacificMs);
  // Next midnight in pacific
  pacific.setUTCHours(24, 0, 0, 0);
  // Convert back to real UTC
  return new Date(pacific.getTime() + pacificOffsetHours * 3600 * 1000);
}

export class YelpKeyPool {
  private keys: KeyEntry[] = [];
  private supabase: any;
  private loaded = false;

  constructor(supabase: any) {
    this.supabase = supabase;
  }

  /** Discover all YELP_API_KEY* env vars and load their persisted exhaustion status. */
  async load(): Promise<void> {
    if (this.loaded) return;

    const candidates: KeyEntry[] = [];
    // Primary key
    const primary = Deno.env.get("YELP_API_KEY");
    if (primary) candidates.push({ name: "YELP_API_KEY", value: primary, exhausted: false });
    // Numbered fallbacks YELP_API_KEY_2 .. YELP_API_KEY_20
    for (let i = 2; i <= 20; i++) {
      const v = Deno.env.get(`YELP_API_KEY_${i}`);
      if (v) candidates.push({ name: `YELP_API_KEY_${i}`, value: v, exhausted: false });
    }

    if (candidates.length === 0) {
      throw new Error("No YELP_API_KEY* env vars found");
    }

    // Load persisted status
    const { data: statuses } = await this.supabase
      .from("api_key_status")
      .select("key_name, exhausted_at, reset_at")
      .eq("provider", "yelp")
      .in("key_name", candidates.map((c) => c.name));

    const now = new Date();
    const statusMap = new Map<string, { reset_at: string | null }>();
    for (const s of statuses || []) statusMap.set(s.key_name, s);

    for (const c of candidates) {
      const s = statusMap.get(c.name);
      if (s?.reset_at) {
        const resetAt = new Date(s.reset_at);
        if (resetAt > now) {
          c.exhausted = true;
          c.resetAt = resetAt;
        }
      }
    }

    this.keys = candidates;
    this.loaded = true;

    const available = this.keys.filter((k) => !k.exhausted).length;
    console.log(`[YelpKeyPool] loaded ${this.keys.length} keys, ${available} available`);
    for (const k of this.keys) {
      if (k.exhausted) {
        console.log(`[YelpKeyPool]   ${k.name} EXHAUSTED until ${k.resetAt?.toISOString()}`);
      }
    }
  }

  /** Mark a key exhausted (persist to DB) until next Yelp reset. */
  private async markExhausted(keyName: string, status: number, errorBody: string): Promise<void> {
    const resetAt = nextYelpReset();
    const entry = this.keys.find((k) => k.name === keyName);
    if (entry) {
      entry.exhausted = true;
      entry.resetAt = resetAt;
    }
    console.warn(`[YelpKeyPool] marking ${keyName} EXHAUSTED status=${status} until=${resetAt.toISOString()}`);
    const { error } = await this.supabase.from("api_key_status").upsert(
      {
        provider: "yelp",
        key_name: keyName,
        exhausted_at: new Date().toISOString(),
        reset_at: resetAt.toISOString(),
        last_error: errorBody.slice(0, 500),
        last_status: status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key_name" },
    );
    if (error) console.error(`[YelpKeyPool] failed to persist exhaustion:`, error.message);
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

      // Quota exhausted or auth/permission failure → rotate
      if (res.status === 429 || res.status === 401 || res.status === 403) {
        const body = await res.text();
        console.warn(`[YelpKeyPool] ${key.name} got ${res.status}: ${body.slice(0, 200)}`);
        await this.markExhausted(key.name, res.status, body);
        continue; // try next key
      }

      if (!res.ok) {
        const body = await res.text();
        return {
          ok: false, status: res.status, body,
          rateLimited: false, authError: false, keyName: key.name,
        };
      }

      const data = await res.json();
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
      reset_at: k.resetAt?.toISOString() || null,
    }));
  }
}
