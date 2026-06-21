REVOKE EXECUTE ON FUNCTION public.shield_dispatch_calculate_score(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_dispatch_parse_device_upload(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shield_dispatch_calculate_score(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.shield_dispatch_parse_device_upload(uuid, uuid, date) TO service_role;
