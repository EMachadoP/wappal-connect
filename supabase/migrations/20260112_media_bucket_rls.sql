-- Migration: Create RLS policies for media-files bucket
-- Run this via supabase db push or SQL Editor

-- Permitir uploads autenticados no bucket media-files
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'Allow authenticated uploads media' 
    AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Allow authenticated uploads media" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'media-files');
  END IF;
END $$;

-- Permitir leitura pública
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'Allow public read media' 
    AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Allow public read media" ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'media-files');
  END IF;
END $$;
