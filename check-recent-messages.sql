-- Check recent messages from Ana Mônica in the last hour
SELECT 
    id,
    conversation_id,
    sender_name,
    sender_type,
    content,
    message_type,
    provider,
    provider_message_id,
    direction,
    status,
    sent_at,
    created_at
FROM messages
WHERE sender_name ILIKE '%Ana M%'
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 20;

-- Check for any errors in message_outbox
SELECT 
    id,
    idempotency_key,
    status,
    error,
    provider_message_id,
    created_at,
    sent_at,
    preview
FROM message_outbox
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 20;
