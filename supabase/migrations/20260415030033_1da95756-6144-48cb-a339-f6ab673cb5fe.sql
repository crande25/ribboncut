
-- Enable extensions for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Lightweight sightings table
CREATE TABLE public.restaurant_sightings (
  yelp_id TEXT PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  city TEXT NOT NULL
);

ALTER TABLE public.restaurant_sightings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read sightings"
  ON public.restaurant_sightings FOR SELECT
  USING (true);

-- scan_log table
CREATE TABLE public.scan_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  new_count INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.scan_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read scan_log"
  ON public.scan_log FOR SELECT
  USING (true);

-- Index for filtered queries
CREATE INDEX idx_sightings_city_first_seen ON public.restaurant_sightings (city, first_seen_at DESC);
