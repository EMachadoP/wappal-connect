-- Migration: Auto-resume AI after pause timeout
-- Created: 2026-01-09
-- Purpose: Automatically resume AI when ai_paused_until time expires
-- Note: This runs as a scheduled check, not a real-time trigger

-- Create function that checks and resumes paused AI conversations
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
      AND ai_paused_until &lt;= NOW()
      AND status = 'open'  -- Only auto-resume open conversations
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
    AND updated_at &gt; NOW() - INTERVAL '5 seconds';  -- Just updated
  
  RETURN QUERY SELECT _count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION resume_expired_ai_pauses() TO authenticated;

-- Comment
COMMENT ON FUNCTION resume_expired_ai_pauses() IS 
  'Checks for expired AI pauses and automatically resumes AI. Should be called periodically.';

-- Note: Since Supabase doesn't have pg_cron by default, this function should be:
-- 1. Called from an Edge Function on a schedule (e.g., every 5 minutes)
-- 2. OR called from the frontend when a conversation is loaded
-- 3. OR use Supabase's pg_cron extension if available in your project
