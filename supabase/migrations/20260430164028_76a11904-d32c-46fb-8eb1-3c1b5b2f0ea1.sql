SELECT net.http_post(
    url := 'https://dcvgzkhoxlvtynlnxsdw.supabase.co/functions/v1/discover-new-restaurants?chunk=0&chunk_size=8&days=7',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjdmd6a2hveGx2dHlubG54c2R3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjE4NDcxNiwiZXhwIjoyMDkxNzYwNzE2fQ.QVom_ETFBpwM4qRnjb0n83ekxHMMXuIiVLjdRcDGH-c'
    ),
    body := '{}'::jsonb
  ) AS request_id;