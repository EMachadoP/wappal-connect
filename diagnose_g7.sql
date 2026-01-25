-- Diagnose G7 Serv Duplicates
SELECT 
    id, 
    chat_id, 
    thread_key, 
    contact_name, 
    created_at, 
    status,
    (pending_payload->>'chatName') as raw_chat_name,
    (pending_payload->>'isGroup') as is_group
FROM conversations 
WHERE 
    contact_name ILIKE '%G7%' 
    OR contact_name ILIKE '%Serv%'
    OR chat_id ILIKE '%g.us%'
    OR thread_key ILIKE '%group:%'
ORDER BY created_at DESC
LIMIT 20;
