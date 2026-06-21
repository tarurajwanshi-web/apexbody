
REVOKE EXECUTE ON FUNCTION public.shield_dispatch_calculate_score(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_dispatch_parse_device_upload(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_onboarding_macros(uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, text) FROM PUBLIC, anon, authenticated;

-- internal_secrets: explicit deny-all policy so anon/authenticated cannot
-- read or write even if someone later adds a misconfigured GRANT.
-- service_role bypasses RLS and retains full access.
CREATE POLICY "deny all to non-service-role"
  ON public.internal_secrets
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
