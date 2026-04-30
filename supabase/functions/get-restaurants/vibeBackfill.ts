// Inline blocking fallback: generate vibes for visible sightings that lack
// one. Bounded by concurrency + per-call timeout + total budget so the Feed
// never hangs. Anything still missing falls through to the cuisine-string
// fallback inside buildFromCache.

import type { SightingRow } from "./sightingsQuery.ts";

const MAX_CONCURRENT = 8;
const PER_CALL_TIMEOUT_MS = 6000;
const TOTAL_BUDGET_MS = 10000;

export async function backfillMissingVibes(
  supabaseUrl: string,
  serviceRoleKey: string,
  sightings: SightingRow[],
  atmosphereMap: Map<string, string>,
): Promise<void> {
  const missing = sightings
    .map((s) => s.yelp_id)
    .filter((id) => !atmosphereMap.has(id));

  if (missing.length === 0) return;

  const startedAt = Date.now();
  const remainingBudget = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  const callOne = async (yelpId: string): Promise<void> => {
    const budget = remainingBudget();
    if (budget <= 0) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(PER_CALL_TIMEOUT_MS, budget));
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/generate-vibe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ yelp_id: yelpId }),
        signal: ctrl.signal,
      });
      const d = await r.json();
      if (d?.ok && typeof d.vibe === "string") {
        atmosphereMap.set(yelpId, d.vibe);
      }
    } catch (_e) {
      // Timeout / network — silently skip; cuisine fallback applies.
    } finally {
      clearTimeout(timer);
    }
  };

  // Concurrency-limited execution
  let cursor = 0;
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, missing.length) }, async () => {
    while (cursor < missing.length && remainingBudget() > 0) {
      const idx = cursor++;
      await callOne(missing[idx]);
    }
  });
  await Promise.all(workers);

  const generated = missing.filter((id) => atmosphereMap.has(id)).length;
  console.log(
    `[get-restaurants] vibe-fill: generated ${generated}/${missing.length} missing vibes ` +
    `in ${Date.now() - startedAt}ms (budget=${TOTAL_BUDGET_MS}ms)`
  );
}
