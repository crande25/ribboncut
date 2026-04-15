

# Backdate Existing Restaurant Sightings

## What
Update all current `restaurant_sightings` records to set `first_seen_at` to 3 weeks ago (21 days before now). This ensures the ~3,700 baseline restaurants won't appear as "newly opened" in the feed, since they were seeded today and most have been open for a long time.

## How
Single SQL update via the database insert tool:

```sql
UPDATE restaurant_sightings
SET first_seen_at = now() - interval '21 days';
```

This affects all existing rows. Any restaurants discovered by future daily scans will get the real discovery timestamp (`now()`), making them distinguishable as genuinely new.

No code or schema changes needed.

