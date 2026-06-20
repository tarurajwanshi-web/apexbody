
CREATE POLICY "shield-uploads own folder select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'shield-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "shield-uploads own folder insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'shield-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "shield-uploads own folder update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'shield-uploads' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'shield-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "shield-uploads own folder delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'shield-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
