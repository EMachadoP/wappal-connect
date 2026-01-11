-- Migration: Update resume AI function to exclude suppliers
-- Created: 2026-01-11
-- Purpose: Modify resume_expired_ai_pauses to NOT reactivate AI for suppliers (fornecedores)

-- Drop and recreate function to exclude suppliers
CREATE OR REPLACE FUNCTION resume_expired_ai_pauses()
RETURNS TABLE(resumed_count INTEGER) AS $$
DECLARE
  _count INTEGER;
BEGIN
  -- Update conversations where pause has expired
  -- EXCLUDING conversations where the participant is a supplier (fornecedor)
  WITH conversations_to_update AS (
    SELECT c.id
    FROM public.conversations c
    LEFT JOIN public.conversation_participant_state cps ON cps.conversation_id = c.id
    LEFT JOIN public.participants p ON p.id = cps.current_participant_id
    WHERE 
      c.ai_paused_until IS NOT NULL
      AND c.ai_paused_until <= NOW()
      AND c.status = 'open'
      AND (p.role_type IS NULL OR p.role_type != 'fornecedor')  -- Exclude suppliers
  ),
  updated_conversations AS (
    UPDATE public.conversations
    SET 
      ai_mode = 'AUTO',
      human_control = false,
      ai_paused_until = NULL
    WHERE id IN (SELECT id FROM conversations_to_update)
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO _count FROM updated_conversations;
  
  -- Log events for resumed conversations
  INSERT INTO ai_events (conversation_id, event_type, message, metadata)
  SELECT 
    c.id,
    'ai_auto_resumed',
    '🤖 IA retomada automaticamente após timeout de pausa.',
    jsonb_build_object(
      'resumed_at', NOW(),
      'triggered_by', 'auto_resume_function'
    )
  FROM public.conversations c
  WHERE 
    c.ai_mode = 'AUTO'
    AND c.human_control = false
    AND c.ai_paused_until IS NULL
    AND c.status = 'open'
    AND c.updated_at > NOW() - INTERVAL '5 seconds';  -- Just updated
  
  RETURN QUERY SELECT _count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION resume_expired_ai_pauses() TO authenticated;
GRANT EXECUTE ON FUNCTION resume_expired_ai_pauses() TO service_role;

-- Comment
COMMENT ON FUNCTION resume_expired_ai_pauses() IS 
  'Checks for expired AI pauses and automatically resumes AI. Excludes suppliers (fornecedores). Should be called periodically via pg_cron.';
