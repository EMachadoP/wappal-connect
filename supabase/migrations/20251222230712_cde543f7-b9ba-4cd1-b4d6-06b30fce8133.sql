
-- Add whatsapp_display_name and tags to contacts
ALTER TABLE public.contacts 
ADD COLUMN IF NOT EXISTS whatsapp_display_name text,
ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

-- Create entities table (condomínios, empresas, etc)
CREATE TABLE public.entities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'condominio', -- condominio, empresa, administradora, etc
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view entities" 
ON public.entities FOR SELECT 
USING (true);

CREATE POLICY "Admins can manage entities" 
ON public.entities FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create participants table (identidades de pessoas)
CREATE TABLE public.participants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  name text NOT NULL,
  role_type text, -- sindico, porteiro, morador, administrador, etc
  entity_id uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view participants" 
ON public.participants FOR SELECT 
USING (true);

CREATE POLICY "Agents can manage participants" 
ON public.participants FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'agent'::app_role));

-- Create conversation_participant_state table
CREATE TABLE public.conversation_participant_state (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  current_participant_id uuid REFERENCES public.participants(id) ON DELETE SET NULL,
  last_confirmed_at timestamp with time zone,
  identification_asked boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(conversation_id)
);

ALTER TABLE public.conversation_participant_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view accessible conversation_participant_state" 
ON public.conversation_participant_state FOR SELECT 
USING (can_access_conversation(auth.uid(), conversation_id));

CREATE POLICY "Users can manage accessible conversation_participant_state" 
ON public.conversation_participant_state FOR ALL 
USING (can_access_conversation(auth.uid(), conversation_id));

-- Create function to detect display name type
CREATE OR REPLACE FUNCTION public.detect_display_name_type(display_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  entity_terms text[] := ARRAY['condomínio', 'condominio', 'portaria', 'residencial', 'edifício', 'edificio', 'administração', 'administracao', 'ltda', 'eireli', 'me', 's/a', 's.a', 'síndico', 'sindico', 'zeladoria', 'recepção', 'recepcao', 'guarita', 'prédio', 'predio', 'bloco', 'torre'];
  term text;
  lower_name text;
BEGIN
  IF display_name IS NULL OR display_name = '' THEN
    RETURN 'UNKNOWN';
  END IF;
  
  lower_name := lower(display_name);
  
  FOREACH term IN ARRAY entity_terms LOOP
    IF lower_name LIKE '%' || term || '%' THEN
      RETURN 'ENTITY_NAME';
    END IF;
  END LOOP;
  
  RETURN 'PERSON_NAME';
END;
$$;

-- Create trigger to update updated_at
CREATE TRIGGER update_entities_updated_at
  BEFORE UPDATE ON public.entities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_participants_updated_at
  BEFORE UPDATE ON public.participants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_conversation_participant_state_updated_at
  BEFORE UPDATE ON public.conversation_participant_state
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participant_state;
