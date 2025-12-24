-- 1. Habilita o Realtime (essencial para mensagens novas entrarem sozinhas)
-- Usando DO block para evitar erro se já estiver adicionado
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END $$;

-- 2. Define identidade completa para capturar mudanças em todos os campos
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;

-- 3. Limpeza de duplicidade (Mantém apenas a conversa mais recente por thread_key)
DELETE FROM public.conversations a
USING public.conversations b
WHERE a.id < b.id 
  AND a.thread_key = b.thread_key 
  AND a.thread_key IS NOT NULL
  AND a.status = b.status;