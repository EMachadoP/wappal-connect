-- =====================================================
-- TABELA: protocols (tickets/protocolos)
-- =====================================================
CREATE TABLE public.protocols (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  protocol_code TEXT NOT NULL UNIQUE,
  conversation_id UUID REFERENCES public.conversations(id),
  contact_id UUID REFERENCES public.contacts(id),
  condominium_id UUID REFERENCES public.condominiums(id),
  
  -- Status e prioridade
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'critical')),
  category TEXT DEFAULT 'operational' CHECK (category IN ('operational', 'financial', 'support', 'admin')),
  
  -- Resumo
  summary TEXT,
  requester_name TEXT,
  requester_role TEXT,
  
  -- Integrações
  asana_task_gid TEXT UNIQUE,
  whatsapp_group_message_id TEXT,
  
  -- Resolução
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by_agent_id UUID,
  resolved_by_name TEXT,
  
  -- Timestamps
  due_date DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.protocols ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view protocols"
  ON public.protocols FOR SELECT
  USING (true);

CREATE POLICY "Agents can manage protocols"
  ON public.protocols FOR ALL
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'agent'));

-- Trigger for updated_at
CREATE TRIGGER update_protocols_updated_at
  BEFORE UPDATE ON public.protocols
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index
CREATE INDEX idx_protocols_status ON public.protocols(status);
CREATE INDEX idx_protocols_conversation_id ON public.protocols(conversation_id);
CREATE INDEX idx_protocols_protocol_code ON public.protocols(protocol_code);

-- =====================================================
-- TABELA: agents (para controle de permissões)
-- =====================================================
CREATE TABLE public.agents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES public.profiles(id),
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  role TEXT DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'tech', 'manager')),
  can_close_protocols BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view agents"
  ON public.agents FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage agents"
  ON public.agents FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index
CREATE INDEX idx_agents_phone ON public.agents(phone);

-- =====================================================
-- TABELA: integrations_settings (configurações de integrações)
-- =====================================================
CREATE TABLE public.integrations_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- WhatsApp
  whatsapp_group_id TEXT,
  whatsapp_notifications_enabled BOOLEAN NOT NULL DEFAULT false,
  
  -- Asana
  asana_enabled BOOLEAN NOT NULL DEFAULT false,
  asana_project_id TEXT,
  asana_section_operacional TEXT,
  asana_section_financeiro TEXT,
  asana_section_support TEXT,
  asana_section_admin TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.integrations_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view integrations_settings"
  ON public.integrations_settings FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage integrations_settings"
  ON public.integrations_settings FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_integrations_settings_updated_at
  BEFORE UPDATE ON public.integrations_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default row
INSERT INTO public.integrations_settings (id) VALUES (gen_random_uuid());

-- Enable realtime for protocols
ALTER PUBLICATION supabase_realtime ADD TABLE public.protocols;