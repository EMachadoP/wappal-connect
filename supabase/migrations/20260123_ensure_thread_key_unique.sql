-- =============================================================================
-- FIX: Garantir UNIQUE em conversations.thread_key
-- =============================================================================
-- JUSTIFICATIVA: thread_key é a chave canônica de identificação de conversas.
--                Sem UNIQUE, o UPSERT não garante dedupe verdadeira.
-- =============================================================================

-- Criar índice UNIQUE em thread_key (com filtro para valores válidos)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_thread_key_unique
ON public.conversations (thread_key)
WHERE thread_key IS NOT NULL AND thread_key <> '';

-- Verificar resultado
SELECT 
  indexname,
  CASE 
    WHEN indexdef LIKE '%UNIQUE%' THEN '✅ UNIQUE' 
    ELSE '⚠️ Normal' 
  END as tipo,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'conversations'
  AND indexdef ILIKE '%thread_key%'
ORDER BY indexname;

-- Resultado esperado: idx_conversations_thread_key_unique (UNIQUE)
