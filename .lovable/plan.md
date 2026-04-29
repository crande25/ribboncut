## Goal

Add a small, out-of-the-way "Contact us" affordance on the Settings page. Submissions are persisted to the database AND emailed to crande25@gmail.com so messages reliably reach you personally.

## UX

- A small "Contact us" text link at the bottom of Settings, just above the Device ID block. Subtle (muted-foreground, small font), tappable.
- Tapping opens a dialog (using existing shadcn `Dialog`) with:
  - Optional email input (placeholder: "Your email (optional)")
  - Required message textarea (placeholder: "Tell us what's on your mind…")
  - Two controls: **Send** (primary, disabled until message is non-empty) and **Cancel** (secondary, closes the dialog and discards in-progress text)
- On successful submit: dialog closes, toast shows "Thanks, message received!"
- On failure: toast shows error, dialog stays open so user can retry.

## Backend

1. **Email domain setup** — No domain is configured yet. The plan starts by opening the email domain setup dialog so you can add a sender domain. Once configured, setup continues automatically.
2. **Email infrastructure** — Provision Lovable Emails infrastructure (queue, tables, cron).
3. **Transactional email scaffold** — Generate the `send-transactional-email` edge function and unsubscribe handler.
4. **`feedback-received` template** — A branded React Email template that renders the message + optional sender email. Hardcoded to deliver to crande25@gmail.com (your address baked into the send call). `reply_to` is set to the submitter's email when provided, so you can reply directly from your inbox.
5. **`feedback` table** — Durable record so nothing is ever lost even if email delivery fails:
   - `id uuid pk`, `message text not null`, `sender_email text null`, `device_id text null`, `created_at timestamptz default now()`
   - RLS: anonymous INSERT allowed (with length checks via trigger), no SELECT/UPDATE/DELETE for clients. You can read it via the backend.
6. **Unsubscribe page** — Required by the transactional email system; a small `/unsubscribe` route added to handle the system-appended unsubscribe footer (won't realistically be used since emails go to you, but it's required infrastructure).

## Submission flow

1. Client validates: message trimmed non-empty, ≤ 2000 chars; email (if provided) is a valid format, ≤ 255 chars. Uses zod.
2. Client inserts row into `feedback` with a generated UUID.
3. Client invokes `send-transactional-email` with `templateName: 'feedback-received'`, `recipientEmail: 'crande25@gmail.com'`, `idempotencyKey: feedback-${id}`, `templateData: { message, senderEmail }`, and `replyTo: senderEmail` if provided.
4. Toast confirmation; dialog closes.

If the email send fails, the row still exists in the database — you don't lose the feedback. The toast still says "received" since the durable record succeeded; email is best-effort delivery.

## Cost

Free. Lovable Cloud + Lovable Emails are included.

## Files to add/change

- **New**: `src/components/ContactUsDialog.tsx` (form + dialog)
- **New**: `src/pages/Unsubscribe.tsx` (required by email system)
- **Edit**: `src/pages/Settings.tsx` (add the small link near the bottom)
- **Edit**: `src/App.tsx` (add `/unsubscribe` route)
- **New (backend)**: `feedback` table + RLS policies via migration
- **New (backend)**: `supabase/functions/_shared/transactional-email-templates/feedback-received.tsx` and registry entry
- **New (backend)**: `send-transactional-email`, `handle-email-unsubscribe`, `handle-email-suppression` edge functions (auto-scaffolded)

## What you'll need to do once

When the email setup dialog appears, add a sender subdomain (e.g. `notify.yourdomain.com`) and the system will walk you through adding a couple of NS records at your domain registrar. DNS verification can take a few hours but doesn't block the rest of the build — the contact form will be live immediately, and emails will start flowing once verification completes. In the meantime, every submission is still saved to the `feedback` table.

If you don't own a domain yet, let me know and I'll suggest alternatives (e.g. Discord webhook fallback) before proceeding.
