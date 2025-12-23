-- Add AI control fields to conversations table
ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS ai_mode TEXT DEFAULT 'AUTO' CHECK (ai_mode IN ('AUTO', 'COPILOT', 'OFF')),
ADD COLUMN IF NOT EXISTS ai_paused_until TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS human_control BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS typing_lock_until TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS typing_by_user_id UUID REFERENCES auth.users(id);

-- Add bot detection fields to ai_conversation_state
ALTER TABLE public.ai_conversation_state
ADD COLUMN IF NOT EXISTS bot_likelihood DECIMAL(3,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS consecutive_auto_msgs INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_human_inbound_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS bot_detection_triggered BOOLEAN DEFAULT FALSE;

-- Add 'fornecedor' to role_types (extend participants functionality)
-- Update ROLE_TYPES constant will be done in code

-- Create table for AI system messages/events
CREATE TABLE IF NOT EXISTS public.ai_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Create index for ai_events
CREATE INDEX IF NOT EXISTS idx_ai_events_conversation ON public.ai_events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_events_type ON public.ai_events(event_type);

-- Enable RLS on ai_events
ALTER TABLE public.ai_events ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for ai_events (viewable by authenticated users who can access conversation)
CREATE POLICY "Users can view ai_events for accessible conversations"
ON public.ai_events
FOR SELECT
USING (public.can_access_conversation(auth.uid(), conversation_id));

-- Create policy for system inserts (service role)
CREATE POLICY "Service role can insert ai_events"
ON public.ai_events
FOR INSERT
WITH CHECK (true);

-- Add bot_suspected tag to contacts if detected
-- This will be done via code update

-- Create function to check and set human control when agent sends message
CREATE OR REPLACE FUNCTION public.set_human_control_on_agent_message()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger for outbound agent messages with a sender_id (human agent)
  IF NEW.sender_type = 'agent' AND NEW.sender_id IS NOT NULL AND NEW.direction = 'outbound' THEN
    UPDATE public.conversations
    SET 
      human_control = TRUE,
      ai_paused_until = NOW() + INTERVAL '30 minutes',
      ai_mode = CASE WHEN ai_mode = 'AUTO' THEN 'COPILOT' ELSE ai_mode END
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for human control
DROP TRIGGER IF EXISTS trigger_human_control_on_message ON public.messages;
CREATE TRIGGER trigger_human_control_on_message
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.set_human_control_on_agent_message();

-- Enable realtime for ai_events
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_events;