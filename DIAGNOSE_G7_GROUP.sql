-- ============================================
-- DIAGNÓSTICO: G7 Serv Group Duplicates
-- ============================================
-- Este script identifica conversas duplicadas do grupo G7 Serv
-- e analisa inconsistências no thread_key e chat_id

-- 1. IDENTIFICAR TODAS AS CONVERSAS QUE PODEM SER G7 SERV
-- (por nome, thread_key com padrão de grupo, ou chat_id com @g.us)
SELECT 
  c.id,
  c.thread_key,
  c.chat_id,
  c.contact_id,
  c.last_message,
  c.last_message_at,
  c.created_at,
  c.status,
  c.assigned_to,
  co.name as contact_name,
  co.phone,
  co.lid,
  (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
FROM conversations c
LEFT JOIN contacts co ON c.contact_id = co.id
WHERE 
  -- Buscar por nome (case insensitive)
  (co.name ILIKE '%G7%' AND co.name ILIKE '%Serv%')
  OR c.thread_key ILIKE '%g7%'
  OR c.chat_id ILIKE '%g7%'
  -- OU por padrão de grupo no thread_key/chat_id
  OR (c.thread_key LIKE 'group:%' AND c.chat_id LIKE '%@g.us')
ORDER BY c.created_at DESC;

-- 2. ANALISAR MENSAGENS DAS CONVERSAS IDENTIFICADAS
-- (substituir {conv_id_1}, {conv_id_2} pelos IDs encontrados acima)
-- DESCOMENTAR E SUBSTITUIR OS IDs REAIS:
/*
SELECT 
  m.id,
  m.conversation_id,
  m.sender_name,
  m.sender_phone,
  m.content,
  m.message_type,
  m.direction,
  m.sent_at,
  m.chat_id,
  m.provider_message_id
FROM messages m
WHERE m.conversation_id IN ({conv_id_1}, {conv_id_2})
ORDER BY m.sent_at DESC
LIMIT 50;
*/

-- 3. VERIFICAR ALIASES DO CONTATO
-- (substituir {contact_id} pelo ID do contato encontrado)
/*
SELECT 
  ca.id,
  ca.contact_id,
  ca.alias_type,
  ca.alias_value,
  ca.created_at
FROM contact_aliases ca
WHERE ca.contact_id = {contact_id}
ORDER BY ca.created_at;
*/

-- 4. PADRÃO ESPERADO PARA THREAD_KEY DE GRUPOS
-- Deve ser: group:<numero>@g.us
-- Exemplo: group:120363321808724020@g.us

-- 5. VERIFICAR SE HÁ MÚLTIPLOS CONTATOS PARA O MESMO GRUPO
SELECT 
  co.id,
  co.name,
  co.phone,
  co.lid,
  co.created_at,
  (SELECT COUNT(*) FROM conversations cv WHERE cv.contact_id = co.id) as conv_count,
  (SELECT COUNT(*) FROM contact_aliases ca WHERE ca.contact_id = co.id) as alias_count
FROM contacts co
WHERE 
  co.name ILIKE '%G7%Serv%'
  OR co.lid LIKE '%@g.us'
  OR co.phone LIKE '%@g.us'
ORDER BY co.created_at;

-- 6. VERIFICAR INCONSISTÊNCIAS NO CHAT_ID vs THREAD_KEY
SELECT 
  c.id,
  c.thread_key,
  c.chat_id,
  CASE 
    WHEN c.thread_key LIKE 'group:%' AND c.chat_id NOT LIKE '%@g.us' THEN 'INCONSISTENT: thread is group but chat_id not'
    WHEN c.thread_key LIKE 'dm:%' AND c.chat_id LIKE '%@g.us' THEN 'INCONSISTENT: thread is dm but chat_id is group'
    WHEN c.thread_key LIKE 'group:%' AND NOT c.thread_key LIKE '%' || c.chat_id || '%' THEN 'INCONSISTENT: thread_key and chat_id mismatch'
    ELSE 'OK'
  END as consistency_status
FROM conversations c
WHERE 
  c.thread_key LIKE '%g7%' 
  OR c.chat_id LIKE '%g7%'
  OR c.thread_key LIKE 'group:%'
ORDER BY c.last_message_at DESC;

-- ============================================
-- NOTAS IMPORTANTES:
-- ============================================
-- 1. Execute cada query separadamente
-- 2. Anote os IDs encontrados para usar no próximo script
-- 3. NÃO delete nada ainda - apenas diagnóstico
-- 4. Procure por:
--    - Múltiplas conversas com thread_key diferentes mas mesmo grupo
--    - Conversas com thread_key = u:123456 mas chat_id = @g.us
--    - Contatos duplicados para o mesmo grupo
