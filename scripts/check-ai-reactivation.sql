-- Script para verificar status da reativação automática da IA
-- Executar no Supabase SQL Editor

-- 1. Verificar eventos recentes de reativação da IA
SELECT 
  ae.id,
  ae.conversation_id,
  ae.event_type,
  ae.message,
  ae.created_at,
  c.status as conv_status,
  c.ai_mode,
  c.human_control,
  c.ai_paused_until,
  c.last_message_at
FROM ai_events ae
LEFT JOIN conversations c ON c.id = ae.conversation_id
WHERE ae.event_type IN ('ai_auto_reactivated', 'ai_auto_resumed', 'ai_mode_changed')
ORDER BY ae.created_at DESC
LIMIT 20;

-- 2. Conversas que DEVERIAM ter sido reativadas (humano ativo há mais de 30min)
SELECT 
  c.id,
  c.ai_mode,
  c.human_control,
  c.ai_paused_until,
  c.last_message_at,
  c.status,
  ct.name as contact_name,
  EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) / 60 as minutes_since_last_msg
FROM conversations c
LEFT JOIN contacts ct ON ct.id = c.contact_id
WHERE 
  c.status = 'open'
  AND (c.ai_mode != 'AUTO' OR c.human_control = true)
  AND c.last_message_at < NOW() - INTERVAL '30 minutes'
ORDER BY c.last_message_at ASC;

-- 3. Verificar se pg_cron está ativo
SELECT * FROM cron.job;

-- 4. Verificar histórico de execuções do pg_cron
SELECT * FROM cron.job_run_details 
ORDER BY start_time DESC 
LIMIT 10;

-- 5. Testar a função manualmente
SELECT resume_expired_ai_pauses();

-- 6. Verificar conversas com ai_paused_until expirado (deveria ter sido limpo)
SELECT 
  id,
  ai_mode,
  human_control,
  ai_paused_until,
  last_message_at,
  status
FROM conversations
WHERE 
  ai_paused_until IS NOT NULL
  AND ai_paused_until <= NOW();
