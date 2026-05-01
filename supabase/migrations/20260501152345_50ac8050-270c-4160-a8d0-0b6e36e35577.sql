SELECT net.http_post(
    url := 'https://dcvgzkhoxlvtynlnxsdw.supabase.co/functions/v1/discover-new-restaurants',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_cron_token')
    ),
    body := '{}'::jsonb
);