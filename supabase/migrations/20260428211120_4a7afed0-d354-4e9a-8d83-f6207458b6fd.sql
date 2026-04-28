CREATE TABLE public.restaurant_categories (
  yelp_id text PRIMARY KEY,
  aliases text[] NOT NULL DEFAULT '{}',
  titles text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.restaurant_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read restaurant_categories"
ON public.restaurant_categories
FOR SELECT
TO public
USING (true);

CREATE INDEX idx_restaurant_categories_aliases
ON public.restaurant_categories
USING GIN (aliases);