-- ============================================================
-- FIX AGRESSIVO: Remover TODAS as constraints/indexes em chat_id
-- ============================================================

-- 1. Listar TODAS as constraints UNIQUE na tabela conversations
SELECT 
  c.conname AS constraint_name,
  c.contype AS constraint_type,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE c.conrelid = 'public.conversations'::regclass
  AND c.contype = 'u'  -- UNIQUE constraints
ORDER BY c.conname;

-- 2. Listar TODOS os índices UNIQUE na tabela conversations
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'conversations'
  AND indexdef LIKE '%UNIQUE%';

-- 3. REMOVER constraint por nome exato (múltiplas tentativas)
DO $$
BEGIN
  -- Tentar vários nomes possíveis
  ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_chat_id_uq_full;
  ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_chat_id_key;
  ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_chat_id_uq;
  ALTER TABLE conversations DROP CONSTRAINT IF EXISTS chat_id_uq_full;
  
  RAISE NOTICE 'Constraints removidas (se existiam)';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Erro ao remover constraints: %', SQLERRM;
END $$;

-- 4. REMOVER índices UNIQUE em chat_id
DROP INDEX IF EXISTS conversations_chat_id_idx;
DROP INDEX IF EXISTS conversations_chat_id_uq_full;
DROP INDEX IF EXISTS idx_conversations_chat_id;

-- 5. Verificar o que sobrou (deve mostrar apenas thread_key)
SELECT 
  c.conname AS constraint_name,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conrelid = 'public.conversations'::regclass
  AND c.contype = 'u'
ORDER BY c.conname;
