SELECT 
    created_at, 
    conversation_id, 
    status, 
    skip_reason, 
    error_message, 
    model, 
    input_excerpt 
FROM ai_logs 
ORDER BY created_at DESC 
LIMIT 20;
