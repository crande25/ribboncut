CREATE TABLE public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  sender_email TEXT NULL,
  device_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT feedback_message_length CHECK (char_length(message) BETWEEN 1 AND 2000),
  CONSTRAINT feedback_sender_email_length CHECK (sender_email IS NULL OR char_length(sender_email) <= 255)
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Allow anonymous and authenticated users to insert feedback
CREATE POLICY "Anyone can submit feedback"
ON public.feedback
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- No SELECT/UPDATE/DELETE policies => clients cannot read or modify rows.
