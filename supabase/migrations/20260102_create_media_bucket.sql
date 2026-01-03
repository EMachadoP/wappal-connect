-- Create storage bucket for media files (audio and video)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media-files',
  'media-files',
  true,
  52428800, -- 50MB limit
  ARRAY['audio/ogg', 'audio/mpeg', 'audio/mp4', 'video/mp4', 'video/quicktime', 'video/x-msvideo']
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to media files
CREATE POLICY IF NOT EXISTS "Public read access to media files"
ON storage.objects FOR SELECT
USING (bucket_id = 'media-files');

-- Allow authenticated users to upload media files
CREATE POLICY IF NOT EXISTS "Authenticated users can upload media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'media-files');

-- Allow service role to upload media files (for Edge Functions)
CREATE POLICY IF NOT EXISTS "Service role can upload media"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'media-files');

-- Allow service role to update media files
CREATE POLICY IF NOT EXISTS "Service role can update media"
ON storage.objects FOR UPDATE
TO service_role
USING (bucket_id = 'media-files');
