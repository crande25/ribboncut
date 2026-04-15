
CREATE TABLE public.atmosphere_cache (
  yelp_id text PRIMARY KEY,
  atmosphere_summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.atmosphere_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read atmosphere cache"
ON public.atmosphere_cache
FOR SELECT
USING (true);
