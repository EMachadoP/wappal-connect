
SELECT created_at, model, status, input_excerpt 
FROM ai_logs 
WHERE model IN ('send-message-debug', 'webhook-debug') 
ORDER BY created_at DESC 
LIMIT 5;
