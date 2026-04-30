DO $$
DECLARE
  v_key TEXT;
  v_req_id BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'email_queue_service_role_key';

  SELECT net.http_post(
    url := 'https://dcvgzkhoxlvtynlnxsdw.supabase.co/functions/v1/discover-new-restaurants?chunk=0&chunk_size=8&days=7',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb
  ) INTO v_req_id;

  RAISE NOTICE 'discover request id=%', v_req_id;
END;
$$;