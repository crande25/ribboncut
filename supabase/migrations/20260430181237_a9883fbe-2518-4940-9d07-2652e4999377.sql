DO $$
DECLARE
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'internal_cron_token';
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(48), 'hex'),
      'internal_cron_token',
      'Shared secret used by pg_cron jobs to authenticate against edge functions. Replaces the leaked service_role JWT. Rotate by UPDATE vault.secrets SET secret = ... WHERE name = ''internal_cron_token'' and updating the INTERNAL_CRON_TOKEN runtime secret to match.'
    );
  END IF;
END $$;