

## Plan: Proof-of-Concept — Detroit Restaurant Counts by Price Tier

### Goal
Before committing to a multi-pass strategy, test how many restaurants Yelp reports for Detroit at each price level (`1`, `2`, `3`, `4`) and without a price filter. If 4 price-filtered passes × 1,000 results each covers the full inventory, that's sufficient — no need for category or sort permutations.

### Implementation

**1. Create a temporary test edge function `test-yelp-counts/index.ts`**

A lightweight function that queries Yelp for Detroit with each price value and returns only the `total` field:

```
For each price in [1, 2, 3, 4, null]:
  GET /businesses/search?location=Detroit,MI&categories=restaurants&price={price}&limit=1
  Record data.total
Return { price_1: N, price_2: N, price_3: N, price_4: N, no_filter: N, sum_by_price: N }
```

This tells us:
- Whether the sum of price-filtered totals ≥ the unfiltered total (i.e., full coverage)
- Whether any single tier exceeds 1,000 (would need sub-filtering)

**2. Deploy and call it**

Deploy the function, call it once, read the results.

**3. Clean up**

Delete the test function after we have the numbers. Then decide: if 4 passes suffice, update `scan-restaurants` to simply loop over `price=1..4` with `maxResults=1000` each. That's only 4× the current work — very manageable.

### Files
- Create `supabase/functions/test-yelp-counts/index.ts` (temporary)
- No database changes

