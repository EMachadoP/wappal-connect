ALTER TABLE public.conversation_participant_state
ADD COLUMN IF NOT EXISTS last_read_at timestamptz,
ADD COLUMN IF NOT EXISTS last_read_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_participant_state_conversation_id 
  ON public.conversation_participant_state(conversation_id);
