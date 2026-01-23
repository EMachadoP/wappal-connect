-- Diagnóstico: Verificar mensagens recentes e possíveis problemas

-- 1. Verificar se a mensagem "Teste06" de Ana Mônica foi salva
SELECT 
    id,
    conversation_id,
    sender_name,
    content,
    sent_at,
    created_at,
    provider_message_id,
    status
FROM messages
WHERE content ILIKE '%Teste06%'
ORDER BY created_at DESC
LIMIT 5;

-- 2. Verificar message_outbox (idempotência)
SELECT 
    id,
    status,
    error,
    preview,
    sent_at,
    created_at
FROM message_outbox
WHERE preview ILIKE '%Teste06%'
ORDER BY created_at DESC
LIMIT 5;

-- 3. Verificar últimas mensagens da conversa com Eldon Machado
SELECT 
    m.id,
    m.sender_name,
    m.sender_type,
    m.content,
    m.sent_at,
    m.created_at,
    c.chat_id
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
WHERE c.chat_id ILIKE '%558197438430%'
ORDER BY m.created_at DESC
LIMIT 10;
