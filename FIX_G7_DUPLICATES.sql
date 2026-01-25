-- ============================================
-- FIX G7 SERV GROUP DUPLICATES
-- ============================================
-- Este script consolida conversas duplicadas do grupo G7 Serv
-- ATENÇÃO: Execute DIAGNOSE_G7_GROUP.sql PRIMEIRO e preencha os IDs abaixo

-- ============================================
-- CONFIGURAÇÃO (PREENCHER COM DADOS REAIS)
-- ============================================

-- Substitua pelos valores encontrados no diagnóstico:
DO $$
DECLARE
  -- ID da conversa CANÔNICA (a que será mantida)
  canonical_conv_id UUID := NULL; -- PREENCHER: '<uuid-da-conversa-principal>'
  
  -- IDs das conversas DUPLICADAS (serão mescladas e deletadas)
  duplicate_conv_ids UUID[] := ARRAY[]::UUID[]; -- PREENCHER: ARRAY['<uuid-1>', '<uuid-2>']::UUID[]
  
  -- ID do contato correto
  correct_contact_id UUID := NULL; -- PREENCHER: '<uuid-do-contato>'
  
  -- Thread key e chat_id corretos (formato: group:<numero>@g.us)
  correct_thread_key TEXT := NULL; -- PREENCHER: 'group:120363321808724020@g.us'
  correct_chat_id TEXT := NULL;    -- PREENCHER: '120363321808724020@g.us'
  
  -- Contadores
  messages_moved INTEGER := 0;
  protocols_moved INTEGER := 0;
  conversations_deleted INTEGER := 0;
  
BEGIN
  -- ============================================
  -- VALIDAÇÃO DE PRÉ-REQUISITOS
  -- ============================================
  
  IF canonical_conv_id IS NULL THEN
    RAISE EXCEPTION 'canonical_conv_id não pode ser NULL. Execute o diagnóstico primeiro.';
  END IF;
  
  IF array_length(duplicate_conv_ids, 1) IS NULL OR array_length(duplicate_conv_ids, 1) = 0 THEN
    RAISE NOTICE 'Nenhuma conversa duplicada para mesclar. Script concluído.';
    RETURN;
  END IF;
  
  IF correct_thread_key IS NULL OR correct_chat_id IS NULL THEN
    RAISE EXCEPTION 'correct_thread_key e correct_chat_id são obrigatórios.';
  END IF;
  
  -- Verificar se thread_key tem formato correto
  IF correct_thread_key NOT LIKE 'group:%@g.us' THEN
    RAISE EXCEPTION 'correct_thread_key deve seguir o formato: group:<numero>@g.us';
  END IF;
  
  IF correct_chat_id NOT LIKE '%@g.us' THEN
    RAISE EXCEPTION 'correct_chat_id deve seguir o formato: <numero>@g.us';
  END IF;
  
  -- Verificar se a conversa canônica existe
  IF NOT EXISTS (SELECT 1 FROM conversations WHERE id = canonical_conv_id) THEN
    RAISE EXCEPTION 'Conversa canônica com ID % não encontrada.', canonical_conv_id;
  END IF;
  
  RAISE NOTICE '===================================================';
  RAISE NOTICE 'INICIANDO CONSOLIDAÇÃO DE CONVERSAS G7 SERV';
  RAISE NOTICE '===================================================';
  RAISE NOTICE 'Conversa canônica: %', canonical_conv_id;
  RAISE NOTICE 'Conversas duplicadas: %', duplicate_conv_ids;
  RAISE NOTICE 'Thread key correto: %', correct_thread_key;
  RAISE NOTICE '';
  
  -- ============================================
  -- ETAPA 1: MESCLAR MENSAGENS
  -- ============================================
  
  RAISE NOTICE '[1/5] Mesclando mensagens...';
  
  UPDATE messages 
  SET 
    conversation_id = canonical_conv_id,
    updated_at = NOW()
  WHERE 
    conversation_id = ANY(duplicate_conv_ids)
    AND id NOT IN (
      -- Evitar duplicação de mensagens com mesmo provider_message_id
      SELECT m2.id 
      FROM messages m2
      WHERE m2.conversation_id = canonical_conv_id
        AND m2.provider_message_id = messages.provider_message_id
    );
  
  GET DIAGNOSTICS messages_moved = ROW_COUNT;
  RAISE NOTICE '  ✓ % mensagens movidas para conversa canônica', messages_moved;
  
  -- ============================================
  -- ETAPA 2: MESCLAR PROTOCOLOS
  -- ============================================
  
  RAISE NOTICE '[2/5] Mesclando protocolos...';
  
  UPDATE protocols 
  SET 
    conversation_id = canonical_conv_id,
    updated_at = NOW()
  WHERE conversation_id = ANY(duplicate_conv_ids);
  
  GET DIAGNOSTICS protocols_moved = ROW_COUNT;
  RAISE NOTICE '  ✓ % protocolos movidos para conversa canônica', protocols_moved;
  
  -- ============================================
  -- ETAPA 3: NORMALIZAR CONVERSA CANÔNICA
  -- ============================================
  
  RAISE NOTICE '[3/5] Normalizando conversa canônica...';
  
  UPDATE conversations
  SET 
    thread_key = correct_thread_key,
    chat_id = correct_chat_id,
    contact_id = COALESCE(correct_contact_id, contact_id),
    updated_at = NOW()
  WHERE id = canonical_conv_id;
  
  RAISE NOTICE '  ✓ Conversa atualizada:';
  RAISE NOTICE '    - thread_key: %', correct_thread_key;
  RAISE NOTICE '    - chat_id: %', correct_chat_id;
  
  -- ============================================
  -- ETAPA 4: ATUALIZAR CHAT_ID DAS MENSAGENS
  -- ============================================
  
  RAISE NOTICE '[4/5] Atualizando chat_id das mensagens...';
  
  UPDATE messages
  SET 
    chat_id = correct_chat_id,
    updated_at = NOW()
  WHERE conversation_id = canonical_conv_id
    AND (chat_id IS NULL OR chat_id != correct_chat_id);
  
  RAISE NOTICE '  ✓ chat_id das mensagens normalizado';
  
  -- ============================================
  -- ETAPA 5: DELETAR CONVERSAS DUPLICADAS
  -- ============================================
  
  RAISE NOTICE '[5/5] Deletando conversas duplicadas...';
  
  -- Verificar se ainda há mensagens ou protocolos nas duplicadas
  IF EXISTS (
    SELECT 1 FROM messages WHERE conversation_id = ANY(duplicate_conv_ids)
  ) THEN
    RAISE EXCEPTION 'ERRO: Ainda existem mensagens nas conversas duplicadas. Abortando.';
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM protocols WHERE conversation_id = ANY(duplicate_conv_ids)
  ) THEN
    RAISE EXCEPTION 'ERRO: Ainda existem protocolos nas conversas duplicadas. Abortando.';
  END IF;
  
  DELETE FROM conversations
  WHERE id = ANY(duplicate_conv_ids);
  
  GET DIAGNOSTICS conversations_deleted = ROW_COUNT;
  RAISE NOTICE '  ✓ % conversas duplicadas deletadas', conversations_deleted;
  
  -- ============================================
  -- ETAPA 6: ATUALIZAR NOME DO CONTATO (OPCIONAL)
  -- ============================================
  
  IF correct_contact_id IS NOT NULL THEN
    RAISE NOTICE '[EXTRA] Atualizando nome do contato...';
    
    UPDATE contacts
    SET 
      name = 'G7 Serv',
      updated_at = NOW()
    WHERE id = correct_contact_id
      AND (name IS NULL OR name = 'Grupo sem nome' OR name = 'Desconhecido');
    
    RAISE NOTICE '  ✓ Nome do contato atualizado para "G7 Serv"';
  END IF;
  
  -- ============================================
  -- RESUMO FINAL
  -- ============================================
  
  RAISE NOTICE '';
  RAISE NOTICE '===================================================';
  RAISE NOTICE 'CONSOLIDAÇÃO CONCLUÍDA COM SUCESSO!';
  RAISE NOTICE '===================================================';
  RAISE NOTICE 'Estatísticas:';
  RAISE NOTICE '  - Mensagens movidas: %', messages_moved;
  RAISE NOTICE '  - Protocolos movidos: %', protocols_moved;
  RAISE NOTICE '  - Conversas deletadas: %', conversations_deleted;
  RAISE NOTICE '';
  RAISE NOTICE 'Próximos passos:';
  RAISE NOTICE '  1. Execute a verificação abaixo';
  RAISE NOTICE '  2. Teste enviar mensagem para o grupo G7 Serv';
  RAISE NOTICE '  3. Verifique na UI se tudo está funcionando';
  RAISE NOTICE '';
  
END $$;

-- ============================================
-- VERIFICAÇÃO PÓS-FIX
-- ============================================

-- Deve retornar APENAS UMA conversa para G7 Serv
SELECT 
  c.id,
  c.thread_key,
  c.chat_id,
  c.contact_id,
  co.name as contact_name,
  c.last_message,
  c.status,
  c.created_at,
  c.updated_at,
  COUNT(DISTINCT m.id) as total_messages,
  COUNT(DISTINCT p.id) as total_protocols
FROM conversations c
LEFT JOIN contacts co ON c.contact_id = co.id
LEFT JOIN messages m ON m.conversation_id = c.id
LEFT JOIN protocols p ON p.conversation_id = c.id
WHERE 
  co.name ILIKE '%G7%Serv%'
  OR c.thread_key ILIKE '%g7%'
  OR c.chat_id ILIKE '%g7%'
GROUP BY c.id, c.thread_key, c.chat_id, c.contact_id, co.name, c.last_message, c.status, c.created_at, c.updated_at
ORDER BY c.updated_at DESC;

-- ============================================
-- NOTAS IMPORTANTES
-- ============================================
-- 1. SEMPRE execute DIAGNOSE_G7_GROUP.sql primeiro
-- 2. Preencha TODOS os campos de configuração no início
-- 3. Revise os valores antes de executar
-- 4. Execute em TRANSAÇÃO se possível (BEGIN; ... COMMIT;)
-- 5. Mantenha backup se estiver nervoso :)
-- 6. O script é idempotente - pode executar múltiplas vezes
