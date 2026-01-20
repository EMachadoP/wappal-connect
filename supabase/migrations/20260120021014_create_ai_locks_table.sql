-- Tabela para controle de concorrência (semáforo) da IA
CREATE TABLE IF NOT EXISTS public.ai_conversation_locks (
    conversation_id UUID PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.ai_conversation_locks ENABLE ROW LEVEL SECURITY;

-- Política para permitir que o service role gerencie os locks
-- Como as Edge Functions usam a Service Role, elas bypassam RLS por padrão se não houver políticas restritivas,
-- mas é boa prática ter uma política clara para o service_role.
CREATE POLICY "Enable all access for service role" ON public.ai_conversation_locks
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Comentário para documentar a finalidade da tabela
COMMENT ON TABLE public.ai_conversation_locks IS 'Tabela de semáforo para evitar que a IA responda múltiplas vezes simultaneamente na mesma conversa.';
