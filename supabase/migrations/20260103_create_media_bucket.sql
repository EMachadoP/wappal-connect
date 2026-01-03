-- ============================================
-- CRIAR BUCKET DE STORAGE PARA MÍDIA
-- ============================================
-- Este script cria o bucket necessário para armazenar
-- áudios e vídeos permanentemente no Supabase Storage

-- 1. Criar bucket público para arquivos de mídia
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media-files',
  'media-files',
  true,
  52428800, -- 50MB limit
  ARRAY[
    'audio/ogg',
    'audio/mpeg', 
    'audio/mp4',
    'audio/wav',
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 52428800;

-- 2. Política: Permitir leitura pública
DROP POLICY IF EXISTS "Public read access to media files" ON storage.objects;
CREATE POLICY "Public read access to media files"
ON storage.objects FOR SELECT
USING (bucket_id = 'media-files');

-- 3. Política: Permitir upload por usuários autenticados
DROP POLICY IF EXISTS "Authenticated users can upload media" ON storage.objects;
CREATE POLICY "Authenticated users can upload media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'media-files');

-- 4. Política: Permitir upload pelo service role (Edge Functions)
DROP POLICY IF EXISTS "Service role can upload media" ON storage.objects;
CREATE POLICY "Service role can upload media"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'media-files');

-- 5. Política: Permitir atualização pelo service role
DROP POLICY IF EXISTS "Service role can update media" ON storage.objects;
CREATE POLICY "Service role can update media"
ON storage.objects FOR UPDATE
TO service_role
USING (bucket_id = 'media-files');

-- 6. Política: Permitir deleção pelo service role
DROP POLICY IF EXISTS "Service role can delete media" ON storage.objects;
CREATE POLICY "Service role can delete media"
ON storage.objects FOR DELETE
TO service_role
USING (bucket_id = 'media-files');

-- Verificar criação
SELECT id, name, public, file_size_limit 
FROM storage.buckets 
WHERE id = 'media-files';
