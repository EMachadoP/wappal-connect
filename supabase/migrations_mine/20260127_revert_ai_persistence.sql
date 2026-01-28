-- Migration: Revert persistent manual mode
-- Created: 2026-01-27
-- Purpose: Restore original auto-pause logic that allows auto-resume after 30 minutes

CREATE OR REPLACE FUNCTION auto_pause_ai_on_human_control()
RETURNS TRIGGER AS $$
BEGIN
  -- Always set AI to pause for 30 minutes when human_control changes to true
  IF NEW.human_control = true AND (OLD.human_control IS NULL OR OLD.human_control = false) THEN
    NEW.ai_paused_until := NOW() + INTERVAL '30 minutes';
    
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

-- Re-apply trigger
DROP TRIGGER IF EXISTS trigger_auto_pause_ai ON public.conversations;
CREATE TRIGGER trigger_auto_pause_ai
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  WHEN (NEW.human_control IS DISTINCT FROM OLD.human_control)
  EXECUTE FUNCTION auto_pause_ai_on_human_control();
