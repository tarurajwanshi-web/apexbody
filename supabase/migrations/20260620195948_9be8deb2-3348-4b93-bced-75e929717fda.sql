CREATE POLICY "Authenticated users can read resources"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'resources');

CREATE POLICY "Authenticated users can upload resources"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'resources');

CREATE POLICY "Authenticated users can update their resource uploads"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'resources' AND auth.uid() = owner);

CREATE POLICY "Authenticated users can delete their resource uploads"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'resources' AND auth.uid() = owner);