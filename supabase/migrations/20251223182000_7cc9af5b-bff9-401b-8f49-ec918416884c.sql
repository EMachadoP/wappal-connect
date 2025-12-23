-- Adicionar campos de auditoria na tabela protocols
ALTER TABLE public.protocols 
ADD COLUMN IF NOT EXISTS created_by_type text DEFAULT 'ai',
ADD COLUMN IF NOT EXISTS created_by_agent_id uuid REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS customer_text text,
ADD COLUMN IF NOT EXISTS ai_summary text,
ADD COLUMN IF NOT EXISTS participant_id uuid REFERENCES public.participants(id);

-- Adicionar comentários explicativos
COMMENT ON COLUMN public.protocols.created_by_type IS 'Tipo de criador: ai ou human';
COMMENT ON COLUMN public.protocols.created_by_agent_id IS 'ID do agente se criado por humano';
COMMENT ON COLUMN public.protocols.customer_text IS 'Texto original do cliente para auditoria';
COMMENT ON COLUMN public.protocols.ai_summary IS 'Resumo gerado pela IA';
COMMENT ON COLUMN public.protocols.participant_id IS 'ID do participante identificado';