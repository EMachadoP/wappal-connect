-- =============================================================================
-- FIX: Remove UNIQUE constraint on contacts.chat_lid
-- =============================================================================
-- PROBLEMA: Erro 23505 (duplicate key) quando webhook tenta salvar mensagem
--           com chat_lid que já existe em outro contato.
-- 
-- CAUSA: UNIQUE constraint em contacts.chat_lid conflita com contact_aliases
--        que já gerencia unicidade de aliases.
--
-- SOLUÇÃO: Remover UNIQUE constraint, confiar em contact_aliases(alias_key UNIQUE)
-- =============================================================================

-- 1. Identificar e remover o constraint UNIQUE em chat_lid
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  -- Buscar nome do constraint
  SELECT conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'public.contacts'::regclass
    AND a.attname = 'chat_lid'
    AND c.contype = 'u';  -- 'u' = unique constraint
  
  IF constraint_name IS NOT NULL THEN
    RAISE NOTICE 'Removendo constraint: %', constraint_name;
    EXECUTE format('ALTER TABLE public.contacts DROP CONSTRAINT %I', constraint_name);
    RAISE NOTICE 'Constraint removido com sucesso!';
  ELSE
    RAISE NOTICE 'Nenhum UNIQUE constraint encontrado em chat_lid';
  END IF;
END
$$;

-- 2. Também verificar e remover índice único se existir
DO $$
DECLARE
  idx_name TEXT;
BEGIN
  -- Buscar índice único em chat_lid
  SELECT indexname INTO idx_name
  FROM pg_indexes
  WHERE tablename = 'contacts'
    AND schemaname = 'public'
    AND indexdef LIKE '%chat_lid%'
    AND indexdef LIKE '%UNIQUE%';
  
  IF idx_name IS NOT NULL THEN
    RAISE NOTICE 'Removendo índice único: %', idx_name;
    EXECUTE format('DROP INDEX IF EXISTS public.%I', idx_name);
    RAISE NOTICE 'Índice removido com sucesso!';
  ELSE
    -- Tentar nomes comuns
    DROP INDEX IF EXISTS public.contacts_chat_lid_key;
    DROP INDEX IF EXISTS public.idx_contacts_chat_lid;
    DROP INDEX IF EXISTS public.contacts_chat_lid_idx;
    RAISE NOTICE 'Tentou remover índices com nomes comuns';
  END IF;
END
$$;

-- 3. Criar índice NÃO-único para busca (performance sem constraint)
CREATE INDEX IF NOT EXISTS idx_contacts_chat_lid_lookup 
ON public.contacts (chat_lid) 
WHERE chat_lid IS NOT NULL;

-- =============================================================================
-- PARTE B: Garantir unicidade no lugar CORRETO (contact_aliases)
-- =============================================================================
-- A unicidade real é controlada por contact_aliases.alias_key
-- Isso impede duplicidade de LID/phone/chatId sem causar erros em contacts

-- 1) alias_key único (impede duplicidade de LID/phone/chatId)
CREATE UNIQUE INDEX IF NOT EXISTS contact_aliases_alias_key_uq
ON public.contact_aliases(alias_key);

-- 2) Um mesmo contato não repetir o mesmo alias duas vezes
CREATE UNIQUE INDEX IF NOT EXISTS contact_aliases_contact_id_alias_key_uq
ON public.contact_aliases(contact_id, alias_key);

-- =============================================================================
-- VERIFICAÇÃO FINAL
-- =============================================================================

-- Verificar índices em contacts
SELECT 
  'contacts' as tabela,
  indexname, 
  indexdef
FROM pg_indexes
WHERE tablename = 'contacts'
  AND schemaname = 'public'
  AND indexname LIKE '%chat_lid%';

-- Verificar índices em contact_aliases
SELECT 
  'contact_aliases' as tabela,
  indexname, 
  indexdef
FROM pg_indexes
WHERE tablename = 'contact_aliases'
  AND schemaname = 'public';
