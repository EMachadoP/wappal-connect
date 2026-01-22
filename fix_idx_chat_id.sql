-- ============================================================
-- FIX: Remover índice UNIQUE idx_conversations_chat_id_unique
-- ============================================================

-- 1. Remover o índice específico
DROP INDEX IF EXISTS idx_conversations_chat_id_unique;

-- 2. Remover outras variações possíveis
DROP INDEX IF EXISTS idx_conversations_chat_id;
DROP INDEX IF EXISTS conversations_chat_id_unique;

-- 3. Verificar índices restantes
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'conversations'
ORDER BY indexname;

-- Resultado esperado: Apenas índices em id, thread_key, protocol
