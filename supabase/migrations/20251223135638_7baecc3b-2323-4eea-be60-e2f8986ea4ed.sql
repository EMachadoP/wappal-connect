-- Create ai_usage_logs table for tracking AI consumption
CREATE TABLE public.ai_usage_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  user_id UUID,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'AUTO',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  cost_usd NUMERIC(10, 6),
  latency_ms INTEGER,
  estimated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Admins can view all ai_usage_logs"
ON public.ai_usage_logs FOR SELECT
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Agents can view team ai_usage_logs"
ON public.ai_usage_logs FOR SELECT
USING (
  team_id IS NULL 
  OR team_id = get_user_team_id(auth.uid())
);

CREATE POLICY "Service role can insert ai_usage_logs"
ON public.ai_usage_logs FOR INSERT
WITH CHECK (true);

-- Indexes for efficient querying
CREATE INDEX idx_ai_usage_logs_created_at ON public.ai_usage_logs(created_at DESC);
CREATE INDEX idx_ai_usage_logs_conversation_id ON public.ai_usage_logs(conversation_id);
CREATE INDEX idx_ai_usage_logs_team_id ON public.ai_usage_logs(team_id);
CREATE INDEX idx_ai_usage_logs_model ON public.ai_usage_logs(model);

-- Add comment
COMMENT ON TABLE public.ai_usage_logs IS 'Tracks AI token usage and costs per message/conversation';