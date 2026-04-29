ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Detroit',
  ADD COLUMN IF NOT EXISTS preferred_hour smallint NOT NULL DEFAULT 10;