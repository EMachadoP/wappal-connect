-- Migration: SLA Fields and Protocol Tags
-- Created: 2026-01-11
-- Purpose: Add fields for tracking SLA metrics (first response time, resolution time)
--          and protocol categorization with tags

-- =====================================================
-- 1. Add assigned_at to conversations (for FRT calculation)
-- =====================================================
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

-- Update trigger to set assigned_at when assigned_to changes
CREATE OR REPLACE FUNCTION set_conversation_assigned_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND OLD.assigned_to IS NULL THEN
    NEW.assigned_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_assigned_at ON public.conversations;
CREATE TRIGGER trigger_set_assigned_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  WHEN (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)
  EXECUTE FUNCTION set_conversation_assigned_at();

COMMENT ON COLUMN public.conversations.assigned_at IS 'Timestamp when conversation was first assigned to an agent';

-- =====================================================
-- 2. Add SLA fields to protocols
-- =====================================================
ALTER TABLE public.protocols 
ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS ai_classified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(3,2) DEFAULT 0;

COMMENT ON COLUMN public.protocols.first_response_at IS 'Timestamp of first agent response after protocol creation';
COMMENT ON COLUMN public.protocols.tags IS 'Array of tags for granular categorization';
COMMENT ON COLUMN public.protocols.ai_classified IS 'Whether category/tags were auto-classified by AI';
COMMENT ON COLUMN public.protocols.ai_confidence IS 'AI classification confidence score (0-1)';

-- Index for tag queries
CREATE INDEX IF NOT EXISTS idx_protocols_tags ON public.protocols USING GIN(tags);

-- =====================================================
-- 3. Create protocol_tags table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.protocol_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL, -- Portuguese display name
  category TEXT CHECK (category IN ('financial', 'support', 'admin', 'operational')),
  color TEXT DEFAULT '#6366f1',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.protocol_tags ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view tags" ON public.protocol_tags 
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage tags" ON public.protocol_tags 
  FOR ALL USING (has_role(auth.uid(), 'admin'));

-- =====================================================
-- 4. Insert default tags
-- =====================================================
INSERT INTO public.protocol_tags (name, label, category, color) VALUES
  -- Financial
  ('orcamento', 'Orçamento', 'financial', '#10b981'),
  ('cobranca', 'Cobrança', 'financial', '#f59e0b'),
  ('2via_boleto', '2ª Via Boleto', 'financial', '#f59e0b'),
  ('pagamento', 'Pagamento', 'financial', '#10b981'),
  
  -- Operational
  ('manutencao', 'Manutenção', 'operational', '#3b82f6'),
  ('reserva_area', 'Reserva de Área', 'operational', '#8b5cf6'),
  ('limpeza', 'Limpeza', 'operational', '#3b82f6'),
  ('portaria', 'Portaria', 'operational', '#6366f1'),
  
  -- Support
  ('reclamacao', 'Reclamação', 'support', '#ef4444'),
  ('duvida', 'Dúvida', 'support', '#f97316'),
  ('elogio', 'Elogio', 'support', '#22c55e'),
  ('sugestao', 'Sugestão', 'support', '#14b8a6'),
  
  -- Admin
  ('cadastro', 'Cadastro', 'admin', '#64748b'),
  ('documentos', 'Documentos', 'admin', '#64748b'),
  ('assembleia', 'Assembleia', 'admin', '#7c3aed'),
  ('comunicado', 'Comunicado', 'admin', '#0ea5e9')
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- 5. Create view for SLA metrics
-- =====================================================
CREATE OR REPLACE VIEW public.protocol_sla_metrics AS
SELECT 
  p.id,
  p.protocol_code,
  p.category,
  p.priority,
  p.status,
  p.tags,
  p.created_at,
  p.first_response_at,
  p.resolved_at,
  p.resolved_by_agent_id,
  pr.name as resolved_by_name,
  
  -- First Response Time (in minutes)
  CASE 
    WHEN p.first_response_at IS NOT NULL 
    THEN EXTRACT(EPOCH FROM (p.first_response_at - p.created_at)) / 60
    ELSE NULL
  END as frt_minutes,
  
  -- Resolution Time (in hours)
  CASE 
    WHEN p.resolved_at IS NOT NULL 
    THEN EXTRACT(EPOCH FROM (p.resolved_at - p.created_at)) / 3600
    ELSE NULL
  END as resolution_hours,
  
  -- SLA Status (based on priority)
  CASE
    WHEN p.status = 'open' AND p.priority = 'critical' 
         AND p.created_at < NOW() - INTERVAL '24 hours' THEN 'breached'
    WHEN p.status = 'open' AND p.priority = 'normal' 
         AND p.created_at < NOW() - INTERVAL '48 hours' THEN 'breached'
    WHEN p.status = 'open' AND p.priority = 'critical' 
         AND p.created_at < NOW() - INTERVAL '12 hours' THEN 'at_risk'
    WHEN p.status = 'open' AND p.priority = 'normal' 
         AND p.created_at < NOW() - INTERVAL '24 hours' THEN 'at_risk'
    WHEN p.status = 'resolved' THEN 'met'
    ELSE 'on_track'
  END as sla_status

FROM public.protocols p
LEFT JOIN public.profiles pr ON p.resolved_by_agent_id = pr.id;

-- Grant access
GRANT SELECT ON public.protocol_sla_metrics TO authenticated;
