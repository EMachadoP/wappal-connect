-- Migration: Ensure persistent manual mode
-- Created: 2026-01-27
-- Purpose: Adjust auto-pause logic to respect explicitly 'OFF' mode and prevent auto-resume

CREATE OR REPLACE FUNCTION auto_pause_ai_on_human_control()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger if human_control changed from false to true
  IF NEW.human_control = true AND (OLD.human_control IS NULL OR OLD.human_control = false) THEN
    -- If AI is explicitly OFF, do NOT set a timed pause (which would trigger auto-resume)
    IF NEW.ai_mode = 'OFF' THEN
      NEW.ai_paused_until := NULL;
    ELSE
      -- Set AI to pause for 30 minutes (allows auto-resume for COPILOT/AUTO)
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
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-apply trigger to ensure it's active
DROP TRIGGER IF EXISTS trigger_auto_pause_ai ON public.conversations;
CREATE TRIGGER trigger_auto_pause_ai
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  WHEN (NEW.human_control IS DISTINCT FROM OLD.human_control)
  EXECUTE FUNCTION auto_pause_ai_on_human_control();
