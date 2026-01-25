-- ============================================
-- EMERGENCY FIX: G7 Serv Group
-- ============================================
-- Problema: Grupo aparece sem nome e sem mensagens no App
-- Causa: thread_key ou chat_id inconsistente

-- ============================================
-- ETAPA 1: DIAGNÓSTICO COMPLETO
-- ============================================

-- 1.1 Encontrar TODAS as conversas relacionadas ao G7
SELECT 
  'CONVERSAS' as tipo,
  c.id,
  c.thread_key,
  c.chat_id,
  c.contact_id,
  co.name as contact_name,
  co.phone,
  co.lid,
  c.last_message,
  c.status,
  COUNT(m.id) as total_messages
FROM conversations c
LEFT JOIN contacts co ON c.contact_id = co.id
LEFT JOIN messages m ON m.conversation_id = c.id
WHERE 
  co.name ILIKE '%G7%'
  OR c.thread_key ILIKE '%120363321808724020%'
  OR c.chat_id ILIKE '%120363321808724020%'
GROUP BY c.id, c.thread_key, c.chat_id, c.contact_id, co.name, co.phone, co.lid, c.last_message, c.status
ORDER BY c.updated_at DESC;

-- 1.2 Verificar o contato G7 Serv
SELECT
  'CONTATOS' as tipo,
  co.id,
  co.name,
  co.phone,
  co.lid,
  co.created_at,
  COUNT(c.id) as total_conversations
FROM contacts co
LEFT JOIN conversations c ON c.contact_id = co.id
WHERE 
  co.name ILIKE '%G7%'
  OR co.lid ILIKE '%120363321808724020%'
GROUP BY co.id, co.name, co.phone, co.lid, co.created_at
ORDER BY co.created_at DESC;

-- 1.3 Verificar mensagens do grupo
SELECT
  'MENSAGENS' as tipo,
  m.id,
  m.conversation_id,
  m.chat_id,
  m.sender_name,
  m.content,
  m.direction,
  m.sent_at,
  c.thread_key,
  co.name as contact_name
FROM messages m
LEFT JOIN conversations c ON c.id = m.conversation_id
LEFT JOIN contacts co ON co.id = c.contact_id
WHERE 
  m.chat_id ILIKE '%120363321808724020%'
  OR c.thread_key ILIKE '%120363321808724020%'
  OR co.name ILIKE '%G7%'
ORDER BY m.sent_at DESC
LIMIT 20;

-- ============================================
-- ETAPA 2: IDENTIFICAR O PROBLEMA
-- ============================================

-- Verificar inconsistências específicas
SELECT
  'PROBLEMAS' as tipo,
  c.id as conversation_id,
  c.thread_key,
  c.chat_id,
  co.name as contact_name,
  CASE
    WHEN c.thread_key IS NULL THEN 'thread_key NULL'
    WHEN c.thread_key NOT LIKE 'group:%' THEN 'thread_key não é grupo'
    WHEN c.chat_id IS NULL THEN 'chat_id NULL'
    WHEN c.chat_id NOT LIKE '%@g.us' THEN 'chat_id não é grupo'
    WHEN co.name IS NULL THEN 'contato sem nome'
    ELSE 'OK'
  END as problema
FROM conversations c
LEFT JOIN contacts co ON co.id = c.contact_id
WHERE
  c.chat_id ILIKE '%120363321808724020%'
  OR c.thread_key ILIKE '%120363321808724020%'
  OR co.name ILIKE '%G7%';

-- ============================================
-- ETAPA 3: FIX AUTOMÁTICO
-- ============================================
-- ATENÇÃO: Revise os resultados acima antes de executar!

-- Valores corretos conhecidos para o G7 Serv:
-- chat_id: 120363321808724020@g.us
-- thread_key: group:120363321808724020@g.us
-- nome: G7 Serv

DO $$
DECLARE
  v_contact_id UUID;
  v_conversation_id UUID;
  v_correct_chat_id TEXT := '120363321808724020@g.us';
  v_correct_thread_key TEXT := 'group:120363321808724020@g.us';
  v_correct_name TEXT := 'G7 Serv';
  v_messages_fixed INTEGER := 0;
BEGIN
  RAISE NOTICE 'Iniciando correção do grupo G7 Serv...';
  
  -- 3.1 Buscar ou criar o contato correto
  SELECT id INTO v_contact_id
  FROM contacts
  WHERE lid = v_correct_chat_id
  LIMIT 1;
  
  IF v_contact_id IS NULL THEN
    -- Buscar por nome se não encontrou por lid
    SELECT id INTO v_contact_id
    FROM contacts
    WHERE name ILIKE '%G7%Serv%'
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;
  
  IF v_contact_id IS NULL THEN
    RAISE NOTICE 'Criando novo contato para G7 Serv...';
    INSERT INTO contacts (name, lid, phone, created_at, updated_at)
    VALUES (v_correct_name, v_correct_chat_id, v_correct_chat_id, NOW(), NOW())
    RETURNING id INTO v_contact_id;
    RAISE NOTICE 'Contato criado: %', v_contact_id;
  ELSE
    -- Atualizar contato existente
    UPDATE contacts
    SET 
      name = v_correct_name,
      lid = v_correct_chat_id,
      phone = v_correct_chat_id,
      updated_at = NOW()
    WHERE id = v_contact_id;
    RAISE NOTICE 'Contato atualizado: %', v_contact_id;
  END IF;
  
  -- 3.2 Buscar ou criar a conversa correta
  SELECT id INTO v_conversation_id
  FROM conversations
  WHERE thread_key = v_correct_thread_key
  LIMIT 1;
  
  IF v_conversation_id IS NULL THEN
    -- Buscar por chat_id se não encontrou por thread_key
    SELECT id INTO v_conversation_id
    FROM conversations
    WHERE chat_id = v_correct_chat_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;
  
  IF v_conversation_id IS NULL THEN
    RAISE NOTICE 'Criando nova conversa para G7 Serv...';
    INSERT INTO conversations (
      thread_key, 
      chat_id, 
      contact_id, 
      status, 
      created_at, 
      updated_at
    )
    VALUES (
      v_correct_thread_key,
      v_correct_chat_id,
      v_contact_id,
      'active',
      NOW(),
      NOW()
    )
    RETURNING id INTO v_conversation_id;
    RAISE NOTICE 'Conversa criada: %', v_conversation_id;
  ELSE
    -- Atualizar conversa existente
    UPDATE conversations
    SET 
      thread_key = v_correct_thread_key,
      chat_id = v_correct_chat_id,
      contact_id = v_contact_id,
      updated_at = NOW()
    WHERE id = v_conversation_id;
    RAISE NOTICE 'Conversa atualizada: %', v_conversation_id;
  END IF;
  
  -- 3.3 Mover TODAS as mensagens do grupo para a conversa correta
  UPDATE messages
  SET 
    conversation_id = v_conversation_id,
    chat_id = v_correct_chat_id,
    updated_at = NOW()
  WHERE 
    chat_id ILIKE '%120363321808724020%'
    AND conversation_id != v_conversation_id;
  
  GET DIAGNOSTICS v_messages_fixed = ROW_COUNT;
  RAISE NOTICE 'Mensagens movidas: %', v_messages_fixed;
  
  -- 3.4 Atualizar last_message da conversa
  UPDATE conversations
  SET 
    last_message = (SELECT content FROM messages WHERE conversation_id = v_conversation_id ORDER BY sent_at DESC LIMIT 1),
    last_message_at = (SELECT sent_at FROM messages WHERE conversation_id = v_conversation_id ORDER BY sent_at DESC LIMIT 1),
    updated_at = NOW()
  WHERE id = v_conversation_id;
  
  -- 3.5 Deletar conversas duplicadas vazias
  DELETE FROM conversations
  WHERE 
    (chat_id ILIKE '%120363321808724020%' OR thread_key ILIKE '%120363321808724020%')
    AND id != v_conversation_id
    AND NOT EXISTS (SELECT 1 FROM messages WHERE conversation_id = conversations.id);
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ CORREÇÃO CONCLUÍDA!';
  RAISE NOTICE 'Contact ID: %', v_contact_id;
  RAISE NOTICE 'Conversation ID: %', v_conversation_id;
  RAISE NOTICE 'Thread Key: %', v_correct_thread_key;
  RAISE NOTICE 'Chat ID: %', v_correct_chat_id;
  RAISE NOTICE '';
  
END $$;

-- ============================================
-- ETAPA 4: VERIFICAÇÃO FINAL
-- ============================================

-- Deve retornar APENAS 1 conversa com todos os dados corretos
SELECT
  'RESULTADO_FINAL' as status,
  c.id as conversation_id,
  c.thread_key,
  c.chat_id,
  c.contact_id,
  co.name as contact_name,
  co.lid,
  c.last_message,
  c.status,
  COUNT(m.id) as total_messages,
  MAX(m.sent_at) as ultima_mensagem_em
FROM conversations c
LEFT JOIN contacts co ON co.id = c.contact_id
LEFT JOIN messages m ON m.conversation_id = c.id
WHERE 
  c.thread_key = 'group:120363321808724020@g.us'
GROUP BY c.id, c.thread_key, c.chat_id, c.contact_id, co.name, co.lid, c.last_message, c.status;

-- Verificar se há conversas órfãs (sem mensagens)
SELECT
  'CONVERSAS_ORFAS' as tipo,
  c.id,
  c.thread_key,
  c.chat_id,
  co.name
FROM conversations c
LEFT JOIN contacts co ON co.id = c.contact_id
WHERE 
  (c.thread_key ILIKE '%120363321808724020%' OR c.chat_id ILIKE '%120363321808724020%')
  AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id);

-- ============================================
-- INSTRUÇÕES DE USO:
-- ============================================
-- 1. Execute ETAPA 1 (diagnóstico) primeiro
-- 2. Revise os resultados
-- 3. Execute ETAPA 3 (fix automático)
-- 4. Execute ETAPA 4 (verificação)
-- 5. Recarregue o App e verifique se o grupo aparece corretamente
-- 6. Se persistir, compartilhe os resultados da ETAPA 1
