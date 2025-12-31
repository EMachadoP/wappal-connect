-- Migração para corrigir o esquema do banco de dados para o Webhook da Z-API
-- Data: 2025-12-29

-- 1. Adicionar colunas faltantes na tabela zapi_settings
ALTER TABLE public.zapi_settings 
ADD COLUMN IF NOT EXISTS forward_webhook_url TEXT,
ADD COLUMN IF NOT EXISTS last_webhook_received_at TIMESTAMPTZ;

-- 2. Garantir que chat_lid seja único na tabela contacts para permitir o upsert
-- Nota: Usamos um índice único parcial ou global dependendo da necessidade. 
-- O código do webhook faz upsert baseado em chat_lid.
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'contacts_chat_lid_key'
    ) THEN
        ALTER TABLE public.contacts ADD CONSTRAINT contacts_chat_lid_key UNIQUE (chat_lid);
    END IF;
END $$;

-- 3. Criar a função RPC increment_unread_count
CREATE OR REPLACE FUNCTION public.increment_unread_count(conv_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.conversations
    SET unread_count = unread_count + 1
    WHERE id = conv_id;
END;
$$;

-- 4. Garantir permissões para a função (opcional, mas recomendado)
GRANT EXECUTE ON FUNCTION public.increment_unread_count(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_unread_count(UUID) TO authenticated;
