-- Create storage bucket for WhatsApp media
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-media', 'whatsapp-media', true)
ON CONFLICT (id) DO NOTHING;

-- Policy to allow public read access
CREATE POLICY "Public read access for whatsapp-media"
ON storage.objects
FOR SELECT
USING (bucket_id = 'whatsapp-media');

-- Policy to allow service role to upload
CREATE POLICY "Service role can upload to whatsapp-media"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'whatsapp-media');

-- Policy to allow service role to update
CREATE POLICY "Service role can update whatsapp-media"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'whatsapp-media');

-- Policy to allow service role to delete
CREATE POLICY "Service role can delete from whatsapp-media"
ON storage.objects
FOR DELETE
USING (bucket_id = 'whatsapp-media');