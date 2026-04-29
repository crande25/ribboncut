import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { YelpKeyPool } from "./yelpKeys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YELP_API_URL = "https://api.yelp.com/v3";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing required environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Init Yelp key pool (rotates across YELP_API_KEY, YELP_API_KEY_2, ...)
    const pool = new YelpKeyPool(supabase);
    try {
      await pool.load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load Yelp keys";
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const openedSince = url.searchParams.get("opened_since");
    const citiesParam = url.searchParams.get("cities");
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);
    const dietaryCategories = url.searchParams.get("categories");
    const pricesParam = url.searchParams.get("prices");
    const minRatingParam = url.searchParams.get("min_rating");
    const selectedPrices = pricesParam
      ? pricesParam.split(",").map((p) => parseInt(p.trim(), 10)).filter((n) => !Number.isNaN(n))
      : [];
    const minRating = minRatingParam ? parseFloat(minRatingParam) : 0;
    const hasPriceFilter = selectedPrices.length > 0;
    const hasRatingFilter = minRating > 0;

    // Build PostgREST query
    const filters: string[] = [];
    filters.push(`select=yelp_id,first_seen_at,city`);
    filters.push(`order=first_seen_at.desc`);
    filters.push(`offset=${offset}`);
    filters.push(`limit=${limit}`);

    // Exclude restaurants with future first_seen_at
    filters.push(`first_seen_at=lte.${new Date().toISOString()}`);

    // Validate opened_since strictly as ISO 8601 (date or full datetime) to
    // prevent injection of additional PostgREST query parameters via `&`.
    if (openedSince) {
      const isoRe = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
      if (!isoRe.test(openedSince) || Number.isNaN(Date.parse(openedSince))) {
        return new Response(
          JSON.stringify({ error: "Invalid opened_since (expected ISO 8601)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      filters.push(`first_seen_at=gte.${encodeURIComponent(openedSince)}`);
    }
    if (citiesParam) {
      // URL-encode each city token so embedded quotes/&/= cannot break out of
      // the in.(...) filter or inject new PostgREST parameters.
      const cities = citiesParam
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0 && c.length <= 100)
        .slice(0, 50);
      if (cities.length > 0) {
        const encoded = cities
          .map((c) => `"${encodeURIComponent(c).replace(/"/g, "%22")}"`)
          .join(",");
        filters.push(`city=in.(${encoded})`);
      }
    }

    const dbUrl = `${SUPABASE_URL}/rest/v1/restaurant_sightings?${filters.join("&")}`;

    const dbRes = await fetch(dbUrl, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "count=exact",
      },
    });

    if (!dbRes.ok) {
      const errText = await dbRes.text();
      console.error("PostgREST error:", dbRes.status, errText);
      return new Response(
        JSON.stringify({ error: "Database query failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contentRange = dbRes.headers.get("content-range");
    const total = contentRange ? parseInt(contentRange.split("/")[1] || "0", 10) : 0;
    const sightings = await dbRes.json();

    if (!sightings || sightings.length === 0) {
      return new Response(
        JSON.stringify({ restaurants: [], total, offset, limit }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Batch-fetch atmosphere cache for all yelp_ids
    const yelpIds = sightings.map((s: any) => s.yelp_id);
    const { data: atmosphereData } = await supabase
      .from("atmosphere_cache")
      .select("yelp_id, atmosphere_summary")
      .in("yelp_id", yelpIds);

    const atmosphereMap = new Map<string, string>();
    for (const row of atmosphereData || []) {
      atmosphereMap.set(row.yelp_id, row.atmosphere_summary);
    }

    // Batch-fetch cached categories
    const { data: categoryData } = await supabase
      .from("restaurant_categories")
      .select("yelp_id, aliases")
      .in("yelp_id", yelpIds);

    const categoryMap = new Map<string, string[]>();
    for (const row of categoryData || []) {
      categoryMap.set(row.yelp_id, row.aliases || []);
    }

    // Batch-fetch cached metrics + display fields
    const { data: metricsData } = await supabase
      .from("restaurant_metrics")
      .select("yelp_id, price_level, rating, review_count, name, image_url, address, phone, url, coordinates, updated_at")
      .in("yelp_id", yelpIds);

    type MetricsRow = {
      price_level: number | null;
      rating: number | null;
      review_count: number | null;
      name: string | null;
      image_url: string | null;
      address: string | null;
      phone: string | null;
      url: string | null;
      coordinates: any | null;
      updated_at: string | null;
    };
    const metricsMap = new Map<string, MetricsRow>();
    for (const row of metricsData || []) {
      metricsMap.set(row.yelp_id, {
        price_level: row.price_level,
        rating: row.rating !== null ? Number(row.rating) : null,
        review_count: row.review_count,
        name: row.name,
        image_url: row.image_url,
        address: row.address,
        phone: row.phone,
        url: row.url,
        coordinates: row.coordinates,
        updated_at: row.updated_at,
      });
    }

    // Cache usability check: serve from cache when ALL display fields the
    // card needs are present. No time-based expiry — periodic refresh of
    // price/rating/categories/vibe is owned by the refresh-metrics job.
    const isCacheUsable = (yelpId: string) => {
      const m = metricsMap.get(yelpId);
      if (!m) return false;
      if (!m.name || !m.image_url) return false;
      if (m.rating === null || m.price_level === null) return false;
      const cats = categoryMap.get(yelpId);
      if (!cats || cats.length === 0) return false;
      return true;
    };

    // Strict pre-filter: drop sightings that don't satisfy active filters before
    // paying for Yelp detail calls. Mirrors the dietary-filter behavior.
    let workingSightings = sightings;
    let droppedNoCache = 0;
    let droppedPredicate = 0;
    let droppedLodging = 0;
    // Always exclude lodging-only entries (e.g. hotels with onsite restaurants).
    // Only filter when we actually have category data cached — entries with no
    // cached aliases yet are kept and will be evaluated again once enriched.
    const NON_RESTAURANT_ALIASES = new Set([
      "hotels", "hotelstravel", "resorts", "bedbreakfast", "guesthouses", "hostels",
    ]);
    workingSightings = workingSightings.filter((s: any) => {
      const aliases = categoryMap.get(s.yelp_id);
      if (!aliases || aliases.length === 0) return true;
      const lodgingOnly = aliases.every((a) => NON_RESTAURANT_ALIASES.has(a));
      if (lodgingOnly) {
        droppedLodging++;
        return false;
      }
      return true;
    });
    if (droppedLodging > 0) console.log(`[filter] dropped ${droppedLodging} lodging-only entries`);
    if (dietaryCategories) {
      const filters = dietaryCategories.split(",").map((c) => c.trim().toLowerCase());
      workingSightings = workingSightings.filter((s: any) => {
        const aliases = categoryMap.get(s.yelp_id);
        if (!aliases) return false; // strict: exclude unknowns
        return filters.some((f) => aliases.includes(f));
      });
    }
    if (hasPriceFilter || hasRatingFilter) {
      workingSightings = workingSightings.filter((s: any) => {
        const m = metricsMap.get(s.yelp_id);
        if (!m) { droppedNoCache++; return false; } // strict: exclude unknowns
        if (hasPriceFilter && (m.price_level === null || !selectedPrices.includes(m.price_level))) {
          droppedPredicate++;
          return false;
        }
        if (hasRatingFilter && (m.rating === null || m.rating < minRating)) {
          droppedPredicate++;
          return false;
        }
        return true;
      });
      console.log(`[filter] price/rating dropped no-cache=${droppedNoCache} predicate-fail=${droppedPredicate}`);
    }

    // Inline blocking fallback: generate vibes for visible sightings that
    // lack one. Bounded by concurrency + per-call timeout + total budget so
    // the Feed never hangs. Anything still missing falls through to the
    // cuisine-string fallback inside buildFromCache.
    {
      const missing = workingSightings
        .map((s: any) => s.yelp_id as string)
        .filter((id: string) => !atmosphereMap.has(id));
      if (missing.length > 0) {
        const MAX_CONCURRENT = 8;
        const PER_CALL_TIMEOUT_MS = 6000;
        const TOTAL_BUDGET_MS = 10000;
        const startedAt = Date.now();
        const remainingBudget = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

        const callOne = async (yelpId: string): Promise<void> => {
          const budget = remainingBudget();
          if (budget <= 0) return;
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), Math.min(PER_CALL_TIMEOUT_MS, budget));
          try {
            const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-vibe`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({ yelp_id: yelpId }),
              signal: ctrl.signal,
            });
            const d = await r.json();
            if (d?.ok && typeof d.vibe === "string") {
              atmosphereMap.set(yelpId, d.vibe);
            }
          } catch (e) {
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
        console.log(`[vibe-fill] generated ${generated}/${missing.length} missing vibes in ${Date.now() - startedAt}ms (budget=${TOTAL_BUDGET_MS}ms)`);
      }
    }

    // Build a degraded restaurant from cached data only (used when Yelp is exhausted/failing).
    const buildFromCache = (sighting: any) => {
      const m = metricsMap.get(sighting.yelp_id);
      if (!m || !m.name) return null;
      const titles = (categoryMap.get(sighting.yelp_id) || []) as string[];
      const cuisine = titles.join(", ");
      const cachedAtmosphere = atmosphereMap.get(sighting.yelp_id);
      const priceRange = m.price_level ? "$".repeat(m.price_level) : "$";
      return {
        id: sighting.yelp_id,
        name: m.name,
        city: sighting.city,
        cuisine,
        priceRange,
        imageUrl: m.image_url || "",
        rating: m.rating,
        reviewCount: m.review_count,
        address: m.address || "",
        phone: m.phone || "",
        url: m.url || "",
        photos: m.image_url ? [m.image_url] : [],
        hours: [],
        coordinates: m.coordinates || undefined,
        firstSeenAt: sighting.first_seen_at,
        atmosphereSummary: cachedAtmosphere || cuisine || "",
      };
    };

    // Fetch live Yelp details for each (post-filter) sighting via the rotating key pool,
    // unless the cached metrics row is fresh (<72h) — then serve directly from cache.
    let cacheHits = 0;
    let yelpFetches = 0;
    const restaurants = await Promise.all(
      workingSightings.map(async (sighting: any) => {
        if (isCacheUsable(sighting.yelp_id)) {
          cacheHits++;
          return buildFromCache(sighting);
        }
        try {
          yelpFetches++;
          const detailRes = await pool.fetch(`${YELP_API_URL}/businesses/${sighting.yelp_id}`);

          if (!detailRes.ok) {
            if (detailRes.exhaustedAllKeys) {
              console.error(`Yelp ALL KEYS EXHAUSTED while fetching ${sighting.yelp_id} — using cache fallback`);
            } else {
              console.error(`Yelp detail error for ${sighting.yelp_id}: status=${detailRes.status} key=${detailRes.keyName} — using cache fallback`);
            }
            return buildFromCache(sighting);
          }

          const biz = detailRes.body;

          // Lazy-write category cache when we have fresh Yelp data
          if (!categoryMap.has(sighting.yelp_id)) {
            const aliases = (biz.categories || []).map((c: any) => String(c.alias || "").toLowerCase()).filter(Boolean);
            const titles = (biz.categories || []).map((c: any) => String(c.title || "")).filter(Boolean);
            supabase
              .from("restaurant_categories")
              .upsert(
                { yelp_id: sighting.yelp_id, aliases, titles, updated_at: new Date().toISOString() },
                { onConflict: "yelp_id" },
              )
              .then(({ error }: { error: any }) => {
                if (error) console.error(`[cache] lazy upsert failed ${sighting.yelp_id}: ${error.message}`);
              });
          }

          // Lazy-write metrics + display fields when missing or incomplete (no cached name)
          const existingMetrics = metricsMap.get(sighting.yelp_id);
          if (!existingMetrics || !existingMetrics.name) {
            const priceLevel = typeof biz.price === "string" && biz.price.length > 0 ? biz.price.length : null;
            const displayAddress = Array.isArray(biz.location?.display_address)
              ? biz.location.display_address.join(", ")
              : null;
            supabase
              .from("restaurant_metrics")
              .upsert(
                {
                  yelp_id: sighting.yelp_id,
                  price_level: priceLevel,
                  rating: typeof biz.rating === "number" ? biz.rating : null,
                  review_count: typeof biz.review_count === "number" ? biz.review_count : null,
                  name: typeof biz.name === "string" ? biz.name : null,
                  image_url: typeof biz.image_url === "string" ? biz.image_url : null,
                  address: displayAddress,
                  phone: typeof biz.display_phone === "string" ? biz.display_phone : null,
                  url: typeof biz.url === "string" ? biz.url : null,
                  coordinates: biz.coordinates && typeof biz.coordinates === "object" ? biz.coordinates : null,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "yelp_id" },
              )
              .then(({ error }: { error: any }) => {
                if (error) console.error(`[cache] lazy metrics upsert failed ${sighting.yelp_id}: ${error.message}`);
              });
          }

          // Use cached atmosphere or fallback
          const cachedAtmosphere = atmosphereMap.get(sighting.yelp_id);
          const categories = (biz.categories || []).map((c: any) => c.title).join(", ");
          const fallbackAtmosphere = `${categories}${biz.price ? ` · ${biz.price}` : ""}`;

          return {
            id: biz.id,
            name: biz.name,
            city: sighting.city,
            cuisine: categories,
            priceRange: biz.price || "$",
            imageUrl: biz.image_url || "",
            rating: biz.rating,
            reviewCount: biz.review_count,
            address: biz.location?.display_address?.join(", ") || "",
            phone: biz.display_phone || "",
            url: biz.url || "",
            photos: biz.photos || [biz.image_url],
            hours: biz.hours || [],
            coordinates: biz.coordinates,
            firstSeenAt: sighting.first_seen_at,
            atmosphereSummary: cachedAtmosphere || fallbackAtmosphere,
          };
        } catch (err) {
          console.error(`Error fetching ${sighting.yelp_id}:`, err);
          return buildFromCache(sighting);
        }
      })
    );

    console.log(`[cache] hits=${cacheHits} yelp-fetches=${yelpFetches} (TTL=72h)`);
    const filtered = restaurants.filter(Boolean);

    return new Response(
      JSON.stringify({
        restaurants: filtered,
        total,
        offset,
        limit,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in get-restaurants:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
