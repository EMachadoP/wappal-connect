-- Migration: Auto-pause AI when human takes control
-- Created: 2026-01-09
-- Purpose: Automatically pause AI for 30 minutes when human_control is set to true

-- Create function to auto-pause AI when human takes control
CREATE OR REPLACE FUNCTION auto_pause_ai_on_human_control()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger if human_control changed from false to true
  IF NEW.human_control = true AND (OLD.human_control IS NULL OR OLD.human_control = false) THEN
    -- Set AI to pause for 30 minutes
    NEW.ai_paused_until := NOW() + INTERVAL '30 minutes';
    
    -- Optionally set AI mode to OFF or keep current mode
    -- We'll keep the current mode but pause it
    
    -- Log the event
    INSERT INTO ai_events (conversation_id, event_type, message, metadata)
    VALUES (
      NEW.id,
      'ai_auto_paused',
      '⏸️ IA pausada automaticamente por 30min devido a intervenção humana.',
      jsonb_build_object(
        'paused_until', NEW.ai_paused_until,
        'triggered_by', 'human_control_trigger'
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on conversations table
DROP TRIGGER IF EXISTS trigger_auto_pause_ai ON public.conversations;

CREATE TRIGGER trigger_auto_pause_ai
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  WHEN (NEW.human_control IS DISTINCT FROM OLD.human_control)
  EXECUTE FUNCTION auto_pause_ai_on_human_control();

-- Comment
COMMENT ON FUNCTION auto_pause_ai_on_human_control() IS 
  'Automatically pauses AI for 30 minutes when human takes control of a conversation';
