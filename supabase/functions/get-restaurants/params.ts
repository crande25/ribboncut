// Query-param parsing + validation for get-restaurants.
//
// Pure function — easy to unit-test. Returns a tagged result so the caller
// can convert validation errors into a 400 response.

export interface GetRestaurantsParams {
  offset: number;
  limit: number;
  openedSince: string | null;
  citiesParam: string | null;
  dietaryCategories: string | null;
  selectedPrices: number[];
  minRating: number;
  hasPriceFilter: boolean;
  hasRatingFilter: boolean;
}

export type ParseResult =
  | { ok: true; value: GetRestaurantsParams }
  | { ok: false; error: string };

// Strict ISO 8601 (date or full datetime) — prevents `&`-injection of extra
// PostgREST query parameters via the opened_since field.
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function parseQueryParams(url: URL): ParseResult {
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);
  const openedSince = url.searchParams.get("opened_since");
  const citiesParam = url.searchParams.get("cities");
  const dietaryCategories = url.searchParams.get("categories");
  const pricesParam = url.searchParams.get("prices");
  const minRatingParam = url.searchParams.get("min_rating");

  const selectedPrices = pricesParam
    ? pricesParam.split(",").map((p) => parseInt(p.trim(), 10)).filter((n) => !Number.isNaN(n))
    : [];
  const minRating = minRatingParam ? parseFloat(minRatingParam) : 0;

  if (openedSince && (!ISO_8601_RE.test(openedSince) || Number.isNaN(Date.parse(openedSince)))) {
    return { ok: false, error: "Invalid opened_since (expected ISO 8601)" };
  }

  return {
    ok: true,
    value: {
      offset,
      limit,
      openedSince,
      citiesParam,
      dietaryCategories,
      selectedPrices,
      minRating,
      hasPriceFilter: selectedPrices.length > 0,
      hasRatingFilter: minRating > 0,
    },
  };
}
