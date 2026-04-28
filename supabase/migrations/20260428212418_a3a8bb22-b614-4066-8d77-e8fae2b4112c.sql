CREATE TABLE public.restaurant_metrics (
  yelp_id text PRIMARY KEY,
  price_level smallint,
  rating numeric(2,1),
  review_count integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.restaurant_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read restaurant_metrics"
ON public.restaurant_metrics
FOR SELECT
USING (true);

CREATE INDEX idx_restaurant_metrics_price ON public.restaurant_metrics (price_level);
CREATE INDEX idx_restaurant_metrics_rating ON public.restaurant_metrics (rating);