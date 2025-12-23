-- Add resolved_at and resolved_by columns to conversations
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS resolved_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id);

-- Create index for resolved queries
CREATE INDEX IF NOT EXISTS idx_conversations_resolved_at ON public.conversations(resolved_at);

-- Update old messages with empty content based on message_type
UPDATE public.messages 
SET content = CASE message_type
  WHEN 'image' THEN '📷 Imagem'
  WHEN 'video' THEN '🎬 Vídeo'
  WHEN 'audio' THEN '🎤 Áudio'
  WHEN 'document' THEN '📄 Documento'
  ELSE '📎 Mídia'
END
WHERE content IS NULL OR content = '';