
CREATE TABLE public.keepalive (
  id integer PRIMARY KEY DEFAULT 1,
  pinged_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.keepalive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "no client access" ON public.keepalive
  FOR ALL TO public USING (false) WITH CHECK (false);

INSERT INTO public.keepalive (id, pinged_at) VALUES (1, now());
