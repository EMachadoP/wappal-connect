-- AI Settings (singleton - configurações globais)
CREATE TABLE public.ai_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  enabled_global BOOLEAN NOT NULL DEFAULT false,
  timezone TEXT NOT NULL DEFAULT 'America/Recife',
  base_system_prompt TEXT NOT NULL DEFAULT 'Você é um assistente virtual profissional e prestativo. Responda de forma clara, educada e objetiva.',
  fallback_offhours_message TEXT NOT NULL DEFAULT 'Recebemos sua mensagem e retornaremos no próximo horário útil.',
  policies_json JSONB DEFAULT '{}',
  memory_message_count INTEGER NOT NULL DEFAULT 20,
  enable_auto_summary BOOLEAN NOT NULL DEFAULT false,
  anti_spam_seconds INTEGER NOT NULL DEFAULT 5,
  max_messages_per_hour INTEGER NOT NULL DEFAULT 6,
  human_request_pause_hours INTEGER NOT NULL DEFAULT 2,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- AI Team Settings (configurações por equipe)
CREATE TABLE public.ai_team_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  prompt_override TEXT,
  schedule_json JSONB NOT NULL DEFAULT '{
    "days": {
      "monday": {"enabled": true, "start": "08:00", "end": "18:00"},
      "tuesday": {"enabled": true, "start": "08:00", "end": "18:00"},
      "wednesday": {"enabled": true, "start": "08:00", "end": "18:00"},
      "thursday": {"enabled": true, "start": "08:00", "end": "18:00"},
      "friday": {"enabled": true, "start": "08:00", "end": "18:00"},
      "saturday": {"enabled": true, "start": "08:00", "end": "12:00"},
      "sunday": {"enabled": false, "start": "08:00", "end": "12:00"}
    },
    "exceptions": []
  }',
  throttling_json JSONB DEFAULT '{"anti_spam_seconds": null, "max_messages_per_hour": null}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(team_id)
);

-- AI Provider Configs (provedores de IA)
CREATE TABLE public.ai_provider_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'gemini', 'lovable')),
  model TEXT NOT NULL,
  temperature DECIMAL(3,2) DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 1024,
  top_p DECIMAL(3,2) DEFAULT 1.0,
  active BOOLEAN NOT NULL DEFAULT false,
  key_ref TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- AI Conversation State (estado por conversa)
CREATE TABLE public.ai_conversation_state (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  ai_paused_until TIMESTAMP WITH TIME ZONE,
  ai_disabled_reason TEXT,
  auto_msg_count_window INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  conversation_summary TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(conversation_id)
);

-- AI Logs (logs de chamadas)
CREATE TABLE public.ai_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_id TEXT,
  prompt_version TEXT,
  input_excerpt TEXT,
  output_text TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error', 'skipped')),
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_team_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_settings
CREATE POLICY "Admins can manage ai_settings" ON public.ai_settings
  FOR ALL USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can view ai_settings" ON public.ai_settings
  FOR SELECT USING (true);

-- RLS Policies for ai_team_settings
CREATE POLICY "Admins can manage ai_team_settings" ON public.ai_team_settings
  FOR ALL USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can view ai_team_settings" ON public.ai_team_settings
  FOR SELECT USING (true);

-- RLS Policies for ai_provider_configs
CREATE POLICY "Admins can manage ai_provider_configs" ON public.ai_provider_configs
  FOR ALL USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view ai_provider_configs" ON public.ai_provider_configs
  FOR SELECT USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for ai_conversation_state
CREATE POLICY "Authenticated can manage ai_conversation_state" ON public.ai_conversation_state
  FOR ALL USING (true);

-- RLS Policies for ai_logs
CREATE POLICY "Admins can manage ai_logs" ON public.ai_logs
  FOR ALL USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view ai_logs" ON public.ai_logs
  FOR SELECT USING (has_role(auth.uid(), 'admin'));

-- Triggers for updated_at
CREATE TRIGGER update_ai_settings_updated_at
  BEFORE UPDATE ON public.ai_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ai_team_settings_updated_at
  BEFORE UPDATE ON public.ai_team_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ai_provider_configs_updated_at
  BEFORE UPDATE ON public.ai_provider_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ai_conversation_state_updated_at
  BEFORE UPDATE ON public.ai_conversation_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default settings
INSERT INTO public.ai_settings (id) VALUES (gen_random_uuid());

-- Insert default Lovable AI provider (no key needed)
INSERT INTO public.ai_provider_configs (provider, model, active, key_ref)
VALUES ('lovable', 'google/gemini-2.5-flash', true, 'LOVABLE_API_KEY');