UPDATE public.api_key_status
SET reset_at = '2026-04-30 08:00:00+00',
    updated_at = now()
WHERE provider = 'yelp' AND key_name IN ('YELP_API_KEY', 'YELP_API_KEY_2');