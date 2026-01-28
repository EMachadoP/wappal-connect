-- Update ai_conversation_locks table for the new AI reply logic
-- Re-creating the table to match the expected schema with locked_until and lock_owner

DROP TABLE IF EXISTS public.ai_conversation_locks;

CREATE TABLE public.ai_conversation_locks (
    conversation_id UUID PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
    locked_until TIMESTAMPTZ NOT NULL,
    lock_owner TEXT
);

CREATE INDEX IF NOT EXISTS ai_conversation_locks_locked_until_idx
  ON public.ai_conversation_locks (locked_until);

-- Habilitar RLS
ALTER TABLE public.ai_conversation_locks ENABLE ROW LEVEL SECURITY;

-- Política para permitir que o service role gerencie os locks
CREATE POLICY "Enable all access for service role" ON public.ai_conversation_locks
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Comentário para documentar a finalidade da tabela
COMMENT ON TABLE public.ai_conversation_locks IS 'Tabela de semáforo para evitar que a IA responda múltiplas vezes simultaneamente na mesma conversa.';
