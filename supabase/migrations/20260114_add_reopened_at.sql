-- Adiciona coluna reopened_at para permitir ordenação correta ao reabrir conversas
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMP WITH TIME ZONE;

-- Comentário para documentação
COMMENT ON COLUMN public.conversations.reopened_at IS 'Data/hora da última vez que a conversa foi reaberta de um estado resolvido.';
