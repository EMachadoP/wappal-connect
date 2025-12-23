-- Create condominiums table
CREATE TABLE public.condominiums (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.condominiums ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Authenticated users can view condominiums" 
ON public.condominiums 
FOR SELECT 
USING (true);

CREATE POLICY "Admins can manage condominiums" 
ON public.condominiums 
FOR ALL 
USING (has_role(auth.uid(), 'admin'));

-- Create contact_condominiums junction table
CREATE TABLE public.contact_condominiums (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  condominium_id UUID NOT NULL REFERENCES public.condominiums(id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(contact_id, condominium_id)
);

-- Enable RLS
ALTER TABLE public.contact_condominiums ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Authenticated users can view contact_condominiums" 
ON public.contact_condominiums 
FOR SELECT 
USING (true);

CREATE POLICY "Agents can manage contact_condominiums" 
ON public.contact_condominiums 
FOR ALL 
USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'agent'));

-- Add columns to conversations table
ALTER TABLE public.conversations 
ADD COLUMN active_condominium_id UUID REFERENCES public.condominiums(id),
ADD COLUMN active_condominium_confidence INTEGER,
ADD COLUMN active_condominium_set_by TEXT CHECK (active_condominium_set_by IN ('ai', 'human', 'contact')),
ADD COLUMN active_condominium_set_at TIMESTAMP WITH TIME ZONE;

-- Create trigger for updated_at on condominiums
CREATE TRIGGER update_condominiums_updated_at
BEFORE UPDATE ON public.condominiums
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for performance
CREATE INDEX idx_contact_condominiums_contact_id ON public.contact_condominiums(contact_id);
CREATE INDEX idx_conversations_active_condominium ON public.conversations(active_condominium_id);