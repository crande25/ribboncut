## Context

Supabase pauses free-tier projects after 7 days of **database inactivity** (not API calls or dashboard visits). Your existing cron jobs trigger edge functions via HTTP, but those only write to the DB when they find new restaurants or have emails to process — meaning the DB can go days without actual write activity.

The most reliable prevention is a cron job that performs an actual database write on a regular schedule.

## What this changes

### 1. Create a `keepalive` table (migration)

A minimal single-row table:

```sql
CREATE TABLE public.keepalive (
  id integer PRIMARY KEY DEFAULT 1,
  pinged_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.keepalive ENABLE ROW LEVEL SECURITY;

-- No client access needed; only pg_cron writes to this
CREATE POLICY "no client access" ON public.keepalive
  FOR ALL TO public USING (false) WITH CHECK (false);

-- Seed the single row
INSERT INTO public.keepalive (id, pinged_at) VALUES (1, now());
```

### 2. Add a pg_cron job that writes daily

```sql
SELECT cron.schedule(
  'keepalive-daily',
  '0 6 * * *',
  $$UPDATE public.keepalive SET pinged_at = now() WHERE id = 1$$
);
```

This runs a real `UPDATE` every day at 06:00 UTC, which registers as database activity and resets the inactivity timer. No edge functions, no HTTP calls, no tokens — just a direct SQL write from pg_cron.

### 3. Update CHANGELOG.md

Append a dated entry for this change.

---

**No code changes needed** — this is entirely database-side (one migration + one cron schedule insert).
