
CREATE POLICY "Admins can read api_key_status"
  ON public.api_key_status FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
