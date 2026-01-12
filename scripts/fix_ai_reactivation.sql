-- =============================================
-- SCRIPT COMPLETO PARA CORRIGIR REATIVAÇÃO DA IA
-- Execute este script no Supabase SQL Editor
-- =============================================

-- 1. Verificar se pg_cron está habilitado
-- Se não estiver, habilite: Dashboard > Database > Extensions > pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Criar/Recriar a função de resume automático
CREATE OR REPLACE FUNCTION resume_expired_ai_pauses()
RETURNS TABLE(resumed_count INTEGER) AS $$
DECLARE
  _count INTEGER;
BEGIN
  -- Update conversations where pause has expired
  WITH updated_conversations AS (
    UPDATE public.conversations
    SET 
      ai_mode = 'AUTO',
      human_control = false,
      ai_paused_until = NULL
    WHERE 
      ai_paused_until IS NOT NULL
      AND ai_paused_until <= NOW()
      AND status = 'open'
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO _count FROM updated_conversations;
  
  -- Log events for resumed conversations
  INSERT INTO ai_events (conversation_id, event_type, message, metadata)
  SELECT 
    id,
    'ai_auto_resumed',
    '🤖 IA retomada automaticamente após timeout de pausa.',
    jsonb_build_object(
      'resumed_at', NOW(),
      'triggered_by', 'auto_resume_function'
    )
  FROM public.conversations
  WHERE 
    ai_mode = 'AUTO'
    AND human_control = false
    AND ai_paused_until IS NULL
    AND status = 'open'
    AND updated_at > NOW() - INTERVAL '5 seconds';
  
  RETURN QUERY SELECT _count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION resume_expired_ai_pauses() TO authenticated;

-- 3. Criar função para reativar conversas inativas por 30min 
-- (diferente de ai_paused_until, isso verifica last_message_at)
CREATE OR REPLACE FUNCTION resume_inactive_ai_conversations()
RETURNS TABLE(resumed_count INTEGER) AS $$
DECLARE
  _count INTEGER;
  _threshold TIMESTAMP WITH TIME ZONE;
BEGIN
  _threshold := NOW() - INTERVAL '30 minutes';
  
  -- Update conversations where:
  -- - Status is open
  -- - AI is not AUTO or human_control is true
  -- - Last message was more than 30 minutes ago
  -- - Participant is NOT a supplier
  WITH updated_conversations AS (
    UPDATE public.conversations c
    SET 
      ai_mode = 'AUTO',
      human_control = false,
      ai_paused_until = NULL
    WHERE 
      c.status = 'open'
      AND (c.ai_mode != 'AUTO' OR c.human_control = true)
      AND c.last_message_at < _threshold
      AND NOT EXISTS (
        SELECT 1 FROM conversation_participant_state cps
        JOIN participants p ON p.id = cps.current_participant_id
        WHERE cps.conversation_id = c.id
        AND p.role_type = 'fornecedor'
      )
    RETURNING c.id
  )
  SELECT COUNT(*)::INTEGER INTO _count FROM updated_conversations;
  
  -- Log the reactivation events
  IF _count > 0 THEN
    INSERT INTO ai_events (conversation_id, event_type, message, metadata)
    SELECT 
      id,
      'ai_auto_reactivated',
      '🤖 IA reativada automaticamente após 30 minutos de inatividade.',
      jsonb_build_object(
        'reactivated_at', NOW(),
        'triggered_by', 'inactivity_check'
      )
    FROM public.conversations
    WHERE 
      ai_mode = 'AUTO'
      AND human_control = false
      AND status = 'open'
      AND updated_at > NOW() - INTERVAL '5 seconds';
  END IF;
  
  RETURN QUERY SELECT _count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION resume_inactive_ai_conversations() TO authenticated;

-- 4. Agendar job no pg_cron para rodar a cada 5 minutos
-- Primeiro remove jobs existentes se houver
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('resume-ai-pauses', 'resume-inactive-ai');

-- Agendar jobs
SELECT cron.schedule(
  'resume-ai-pauses',
  '*/5 * * * *',  -- Every 5 minutes
  $$SELECT resume_expired_ai_pauses()$$
);

SELECT cron.schedule(
  'resume-inactive-ai',
  '*/5 * * * *',  -- Every 5 minutes
  $$SELECT resume_inactive_ai_conversations()$$
);

-- 5. Executar imediatamente para limpar conversas pendentes
SELECT resume_expired_ai_pauses();
SELECT resume_inactive_ai_conversations();

-- 6. Verificar resultado
SELECT 
  'Jobs agendados:' as status,
  (SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'resume%') as jobs_count;

SELECT 
  'Conversas abertas com AI não-AUTO ou humano ativo:' as status,
  COUNT(*) as pending_count
FROM conversations
WHERE 
  status = 'open'
  AND (ai_mode != 'AUTO' OR human_control = true)
  AND last_message_at < NOW() - INTERVAL '30 minutes';
