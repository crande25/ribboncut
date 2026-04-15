const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PLACES_API_URL =
  "https://places.googleapis.com/v1/places:searchText";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");
    if (!GOOGLE_PLACES_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GOOGLE_PLACES_API_KEY is not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const url = new URL(req.url);
    const location = url.searchParams.get("location");
    const openedSince = url.searchParams.get("opened_since"); // ISO date e.g. "2025-04-01"
    const pageToken = url.searchParams.get("page_token");

    if (!location) {
      return new Response(
        JSON.stringify({ error: "location parameter is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const fieldMask = [
      "places.id",
      "places.displayName",
      "places.formattedAddress",
      "places.location",
      "places.types",
      "places.priceLevel",
      "places.rating",
      "places.userRatingCount",
      "places.photos",
      "places.websiteUri",
      "places.nationalPhoneNumber",
      "places.currentOpeningHours",
      "places.businessStatus",
      "places.googleMapsUri",
      "places.primaryType",
      "places.primaryTypeDisplayName",
      "nextPageToken",
    ].join(",");

    // Build request body
    const body: Record<string, unknown> = {
      textQuery: `new restaurants in ${location}`,
      includedType: "restaurant",
      languageCode: "en",
      maxResultCount: 20,
      openNow: false,
    };

    if (pageToken) {
      body.pageToken = pageToken;
    }

    const placesResponse = await fetch(PLACES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
    });

    if (!placesResponse.ok) {
      const errorBody = await placesResponse.text();
      console.error(
        `Google Places API error [${placesResponse.status}]: ${errorBody}`
      );
      return new Response(
        JSON.stringify({
          error: `Google Places API error: ${placesResponse.status}`,
        }),
        {
          status: placesResponse.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data = await placesResponse.json();
    const places = data.places || [];
    const nextPageToken = data.nextPageToken || null;

    console.log(`Found ${places.length} places from search`);

    // Now fetch detail for each place to get openingDate (requires individual lookup)
    const enriched = await Promise.all(
      places.map(async (place: any) => {
        const placeId = place.id;
        try {
          const detailRes = await fetch(
            `https://places.googleapis.com/v1/places/${placeId}`,
            {
              headers: {
                "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
                "X-Goog-FieldMask": "id,openingDate",
              },
            }
          );
          if (detailRes.ok) {
            const detail = await detailRes.json();
            console.log(`Place ${placeId} openingDate:`, JSON.stringify(detail.openingDate));
            return { ...place, openingDate: detail.openingDate || null };
          } else {
            console.log(`Detail request failed for ${placeId}: ${detailRes.status}`);
          }
        } catch (e) {
          console.error(`Failed to get detail for ${placeId}:`, e);
        }
        return { ...place, openingDate: null };
      })
    );

    const withDate = enriched.filter((p: any) => p.openingDate);
    console.log(`${withDate.length}/${enriched.length} have openingDate`);

    // Filter by openingDate if opened_since is provided
    let filtered = enriched;
    if (openedSince) {
      const sinceDate = new Date(openedSince);
      filtered = enriched.filter((p: any) => {
        if (!p.openingDate) return true; // include if no date available
        const od = p.openingDate;
        const openDate = new Date(od.year, (od.month || 1) - 1, od.day || 1);
        return openDate >= sinceDate;
      });
      console.log(`After filtering by ${openedSince}: ${filtered.length} remain`);
    }

    // Map to our format
    const priceLevelMap: Record<string, string> = {
      PRICE_LEVEL_FREE: "Free",
      PRICE_LEVEL_INEXPENSIVE: "$",
      PRICE_LEVEL_MODERATE: "$$",
      PRICE_LEVEL_EXPENSIVE: "$$$",
      PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
    };

    const restaurants = filtered.map((p: any) => {
      const od = p.openingDate;
      let openingDateStr: string | null = null;
      if (od) {
        const mm = String(od.month || 1).padStart(2, "0");
        const dd = String(od.day || 1).padStart(2, "0");
        openingDateStr = `${od.year}-${mm}-${dd}`;
      }

      // Build photo URLs
      const photos = (p.photos || []).slice(0, 5).map((photo: any) => {
        return `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=800&key=${GOOGLE_PLACES_API_KEY}`;
      });

      return {
        id: p.id,
        name: p.displayName?.text || "",
        city: location,
        cuisine:
          p.primaryTypeDisplayName?.text ||
          (p.types || []).slice(0, 3).join(", "),
        priceRange: priceLevelMap[p.priceLevel] || "$",
        imageUrl: photos[0] || "",
        rating: p.rating || 0,
        reviewCount: p.userRatingCount || 0,
        address: p.formattedAddress || "",
        phone: p.nationalPhoneNumber || "",
        url: p.googleMapsUri || "",
        photos,
        hours: p.currentOpeningHours?.weekdayDescriptions || [],
        coordinates: p.location
          ? { latitude: p.location.latitude, longitude: p.location.longitude }
          : undefined,
        openingDate: openingDateStr,
      };
    });

    return new Response(
      JSON.stringify({
        restaurants,
        total: restaurants.length,
        nextPageToken,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error in discover-restaurants:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
