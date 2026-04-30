-- Create a SECURITY DEFINER RPC that updates the internal_cron_token vault entry.
-- Only callable by service_role (the sync edge function).
CREATE OR REPLACE FUNCTION public.set_internal_cron_token(new_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  existing_id uuid;
BEGIN
  IF new_token IS NULL OR length(new_token) < 32 THEN
    RAISE EXCEPTION 'token must be at least 32 chars';
  END IF;

  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'internal_cron_token';
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(new_token, 'internal_cron_token', 'Shared secret for cron->edge-function auth. Synced from INTERNAL_CRON_TOKEN runtime secret.');
  ELSE
    PERFORM vault.update_secret(existing_id, new_token, 'internal_cron_token', 'Shared secret for cron->edge-function auth. Synced from INTERNAL_CRON_TOKEN runtime secret.');
  END IF;
END;
$$;

-- Lock down execute: only service_role may call.
REVOKE ALL ON FUNCTION public.set_internal_cron_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_internal_cron_token(text) TO service_role;