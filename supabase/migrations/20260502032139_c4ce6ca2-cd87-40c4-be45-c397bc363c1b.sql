ALTER TABLE public.api_key_status
  ADD COLUMN remaining_uses INTEGER NOT NULL DEFAULT 3000;

UPDATE public.api_key_status SET remaining_uses = 3000;