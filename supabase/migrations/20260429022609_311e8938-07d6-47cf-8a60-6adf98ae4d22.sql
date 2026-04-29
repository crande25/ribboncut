-- Indexes for hot query paths
CREATE INDEX IF NOT EXISTS idx_restaurant_sightings_city_first_seen
  ON public.restaurant_sightings (city, first_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_enabled_frequency
  ON public.push_subscriptions (frequency)
  WHERE enabled = true;

-- Tighten api_key_status: drop public-read policy.
-- Service-role bypasses RLS, so backend functions still have full access.
DROP POLICY IF EXISTS "Anyone can read api_key_status" ON public.api_key_status;

-- Drop unused scan_log table
DROP TABLE IF EXISTS public.scan_log;
