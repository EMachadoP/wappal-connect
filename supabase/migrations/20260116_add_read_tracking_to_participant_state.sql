-- Add read tracking columns to conversation_participant_state
ALTER TABLE public.conversation_participant_state
ADD COLUMN IF NOT EXISTS last_read_at timestamptz,
ADD COLUMN IF NOT EXISTS last_read_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_conversation_participant_state_conversation_id 
  ON public.conversation_participant_state(conversation_id);

COMMENT ON COLUMN public.conversation_participant_state.last_read_at IS 'Timestamp when the user last read messages in this conversation';
COMMENT ON COLUMN public.conversation_participant_state.last_read_message_id IS 'ID of the last message the user read in this conversation';
