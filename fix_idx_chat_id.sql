-- ============================================================
-- FIX: conversations.chat_id não pode ser UNIQUE
-- ============================================================
-- PROBLEMA: Erro 23505 quando chat_id muda entre phone/LID
-- SOLUÇÃO: Remover UNIQUE, criar índice normal para lookup
-- ============================================================

-- 1. Remover TODOS os índices relacionados a chat_id
DROP INDEX IF EXISTS public.idx_conversations_chat_id_unique;
DROP INDEX IF EXISTS public.idx_conversations_chat_id;
DROP INDEX IF EXISTS public.conversations_chat_id_unique;
DROP INDEX IF EXISTS public.conversations_chat_id_key;

-- 2. Criar índice NÃO-único para lookup (performance)
CREATE INDEX IF NOT EXISTS idx_conversations_chat_id_lookup
ON public.conversations (chat_id)
WHERE chat_id IS NOT NULL;

-- 3. Verificar resultado
SELECT 
  indexname,
  CASE 
    WHEN indexdef LIKE '%UNIQUE%' THEN '❌ UNIQUE' 
    ELSE '✅ Normal' 
  END as tipo,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'conversations'
  AND indexdef ILIKE '%chat_id%'
ORDER BY indexname;

-- Resultado esperado: apenas idx_conversations_chat_id_lookup (Normal)

