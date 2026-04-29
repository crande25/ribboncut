ALTER TABLE public.restaurant_metrics
ADD COLUMN IF NOT EXISTS google_place_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_metrics_google_place_id
ON public.restaurant_metrics (google_place_id)
WHERE google_place_id IS NOT NULL;