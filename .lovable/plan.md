## Goal

Replace the ungrounded Lovable AI call with a direct call to Google's Gemini API using the `google_search` tool, so the harvest actually finds recently opened restaurants. Keep the same downstream pipeline (Yelp verify → upsert into `restaurant_sightings`).

## Why direct Gemini, not Lovable AI

The Lovable AI gateway does not expose Google Search grounding. Direct Gemini API does — within Google's free tier (1,500 grounded requests/day on `gemini-2.5-flash`). Our usage is ~29/day.

## Step 1 — Add `GEMINI_API_KEY` secret

Free key from https://aistudio.google.com → "Get API Key" → "Create API key". No billing setup required for the free tier.

I'll request it via the secret tool. Edge function won't deploy a working harvest until it's set.

## Step 2 — Rewrite `callLovableAI` → `callGeminiGrounded`

File: `supabase/functions/discover-new-restaurants/index.ts`

Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

Request body:

```json
{
  "contents": [{
    "role": "user",
    "parts": [{ "text": "<existing prompt with city + date window>" }]
  }],
  "tools": [{ "google_search": {} }],
  "generationConfig": { "temperature": 0.2 }
}
```

Note: with `google_search` enabled, Gemini does **not** allow `responseSchema` or function-calling tools in the same request. So we ask for a plain-text answer in a strict format and parse it.

Prompt update — append:

```text
Return ONLY a JSON array, no prose, no markdown fencing. Each item:
{"name": "...", "address": "..."}
If none found, return [].
```

Parser: strip optional ```json fences, `JSON.parse`, validate each item has string `name`/`address`. Existing fuzzy filter still drops obviously bad rows.

## Step 3 — Surface grounding metadata in debug mode

Existing `debug` flag already returns the raw response. With Gemini direct, the response shape becomes:

```text
candidates[0].content.parts[].text         ← the JSON we parse
candidates[0].groundingMetadata
  ├── webSearchQueries: ["new restaurants opened Detroit MI ..."]
  ├── groundingChunks: [{ web: { uri, title } }, ...]
  └── groundingSupports: [...]
```

Debug response surfaces `webSearchQueries` and the list of `groundingChunks` URIs alongside `raw_ai_response`. That's the receipt that grounding actually fired.

## Step 4 — Error handling

- **429** → "Gemini rate limited (free tier 15 RPM / 1,500 req/day)". Throw, city is logged as failed, harvest continues to next city.
- **403** with `API_KEY_INVALID` → throw with clear message; user needs to rotate the secret.
- **Empty `candidates`** or no `parts[].text` → log and return `[]` (same as current behavior).
- **JSON parse failure** → log raw text in debug mode, return `[]`.

## Step 5 — Cron behavior

Cron job continues to call the same endpoint with no body. Default model becomes Gemini grounded — no opt-in flag, no fallback. (We discussed opt-in earlier; flipping to "always grounded" is the right call because the ungrounded path returns 0 candidates and is therefore useless.)

The Lovable AI gateway code path is **removed**, not kept as a fallback. Reasons:
- Maintaining two providers doubles the surface area for bugs.
- The ungrounded path is proven empty.
- If Gemini quota ever exhausts, the failure mode (logged 429s, 0 inserts that day) is the same as cron simply not running.

## Step 6 — Verification after deploy

1. Debug call for Detroit, 30-day window:
   ```
   POST /discover-new-restaurants
   body: {"cities":["Detroit, MI"],"days":30,"debug":true}
   ```
   Expect: non-empty `candidates`, `grounding.webSearchQueries` populated, `grounding.groundingChunks` URIs pointing to real news pages from the last 30 days.

2. If candidates look real, run a full harvest with `{}`. Expect non-zero inserts across multiple cities.

## Files touched

- **Edited**: `supabase/functions/discover-new-restaurants/index.ts`
  - Replace `callLovableAI` body + parser
  - Update debug response to include grounding metadata
  - Update error messages
- **Secret added**: `GEMINI_API_KEY`
- **No** changes to: cron schedule, frontend, DB schema, RLS, auth guard, Yelp pool

## What we're NOT doing

- Not keeping the Lovable AI fallback
- Not switching models (stays on `gemini-2.5-flash` — free tier covers it)
- Not adding a UI toggle for grounded vs ungrounded
- Not storing grounding citation URLs in the DB (debug-only for now; can add later if you want an audit trail)

## Tradeoffs

1. **New external dependency**: a Google account / key that lives outside Lovable Cloud. If the user revokes it or the project is forked, the new owner needs their own key.
2. **No structured-output guarantee**: `google_search` precludes JSON schema enforcement, so we rely on prompt + parser. Mitigation: the prompt is explicit and the parser is forgiving (strips fences, validates per-item).
3. **Free tier ceiling**: 1,500 grounded req/day. We use ~29. Plenty of room, but if you ever expand to hundreds of cities or hourly runs, you'd hit the limit.
4. **Cost path forward**: if you outgrow the free tier, $35 per 1,000 grounded requests on Google's pay-as-you-go. ~$1/day at current scale would be the worst case.
