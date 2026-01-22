-- ============================================================
-- FIX: Remover constraint duplicada conversations_chat_id_uq_full
-- ============================================================
-- O thread_key já é único e mais confiável que chat_id
-- Remover constraint chat_id resolve conflito 23505

-- 1. Remover constraint UNIQUE em chat_id
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_chat_id_uq_full;

-- 2. Manter apenas thread_key como UNIQUE (já existe)
-- A constraint thread_key já garante unicidade por contato (dm:${contactId})

-- 3. Verificar constraints restantes
SELECT 
  conname AS constraint_name,
  contype AS constraint_type
FROM pg_constraint
WHERE conrelid = 'conversations'::regclass
  AND contype IN ('u', 'p');  -- u = unique, p = primary key

-- Resultado esperado: Apenas thread_key e primary key (id)
