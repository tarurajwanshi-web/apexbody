
REVOKE EXECUTE ON FUNCTION public.shield_dispatch_calculate_score(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_nutrition_logs_webhook() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_manual_inputs_webhook() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_training_logs_webhook() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_device_uploads_webhook() FROM PUBLIC, anon, authenticated;
