
## Monthly Yelp API Key Usage Tracking

### What changes

**1. Database migration** — add `remaining_uses` column to `api_key_status`
- New column `remaining_uses INTEGER DEFAULT 3000`
- Initialize all existing rows to 3000

**2. `nextYelpReset()` → `nextMonthlyReset()`** in `yelpKeyPool.ts`
- Change from "next midnight Pacific" to "1st of next month, midnight UTC"
- Used when marking a key exhausted so `reset_at` points to the month boundary

**3. Decrement `remaining_uses` on every successful fetch** in `yelpKeyPool.ts`
- After a 200 response, decrement the key's `remaining_uses` by 1
- When `remaining_uses` hits 0, proactively mark the key exhausted (don't wait for 429)

**4. On exhaustion (429/401), set `remaining_uses = 0`** in `yelpKeyPool.ts`
- When `markExhausted` is called, also set remaining to 0

**5. On load, auto-reset keys past their `reset_at`**  in `yelpKeyPool.ts`
- If `reset_at` is in the past, clear exhaustion and reset `remaining_uses` to 3000

**6. Update `yelp-key-sanity-check`** edge function
- Read `remaining_uses` from DB and include in response
- Fix reset calculation to monthly
- Return `remaining_uses` alongside the existing health data

**7. Update `ApiKeyHealth.tsx`** admin component
- Show "Monthly Uses Remaining" column instead of the Yelp daily headers
- Display `remaining / 3000` per key

**8. Update comments** throughout to say "monthly" instead of "daily"

### Technical details

**Migration SQL:**
```sql
ALTER TABLE public.api_key_status
  ADD COLUMN remaining_uses INTEGER NOT NULL DEFAULT 3000;

UPDATE public.api_key_status SET remaining_uses = 3000;
```

**Monthly reset function:**
```typescript
function nextMonthlyReset(): Date {
  const now = new Date();
  const year = now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const month = (now.getUTCMonth() + 1) % 12;
  return new Date(Date.UTC(year, month, 1, 0, 0, 0));
}
```

**Files touched:**
- `supabase/functions/_shared/yelpKeyPool.ts` — monthly reset, decrement on use, reset on load
- `supabase/functions/yelp-key-sanity-check/index.ts` — include remaining_uses in response
- `src/components/admin/ApiKeyHealth.tsx` — show monthly remaining
- New migration for `remaining_uses` column
- `CHANGELOG.md`
