CREATE TABLE public.api_key_status (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL,
  key_name TEXT NOT NULL UNIQUE,
  exhausted_at TIMESTAMP WITH TIME ZONE,
  reset_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  last_status INTEGER,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.api_key_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read api_key_status"
ON public.api_key_status
FOR SELECT
USING (true);

CREATE INDEX idx_api_key_status_provider ON public.api_key_status(provider);