-- Push notification subscriptions, keyed by anonymous device_id
CREATE TABLE public.push_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  cities TEXT[] NOT NULL DEFAULT '{}',
  frequency TEXT NOT NULL DEFAULT 'daily',
  last_notified_at TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- App is anonymous (device_id only). Edge functions use service role.
-- Direct anon access from the client is not needed; all writes go via edge functions.
-- Deny-all policy: only service role bypasses RLS.
CREATE POLICY "no direct client access"
  ON public.push_subscriptions
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE INDEX idx_push_subscriptions_enabled ON public.push_subscriptions(enabled) WHERE enabled = true;
CREATE INDEX idx_push_subscriptions_cities ON public.push_subscriptions USING GIN(cities);

CREATE OR REPLACE FUNCTION public.update_push_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_push_subscriptions_updated_at();