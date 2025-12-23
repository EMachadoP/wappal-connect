-- Add agent identification fields to messages table
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS agent_name text;

-- Create index for agent lookups
CREATE INDEX IF NOT EXISTS idx_messages_agent_id ON public.messages(agent_id);