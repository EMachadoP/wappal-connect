-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Knowledge Base Snippets
CREATE TABLE public.kb_snippets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  problem_text TEXT NOT NULL,
  solution_text TEXT NOT NULL,
  tags JSONB DEFAULT '[]'::jsonb,
  source TEXT DEFAULT 'manual',
  approved BOOLEAN NOT NULL DEFAULT false,
  confidence_score NUMERIC DEFAULT 0.5,
  used_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Knowledge Base Embeddings
CREATE TABLE public.kb_embeddings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  snippet_id UUID REFERENCES public.kb_snippets(id) ON DELETE CASCADE,
  embedding extensions.vector(768),
  model_name TEXT NOT NULL DEFAULT 'text-embedding-004',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Message Feedback
CREATE TABLE public.message_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  reason TEXT,
  save_as_procedure BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Conversation Resolution (for learning from resolved conversations)
CREATE TABLE public.conversation_resolution (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE UNIQUE,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  category TEXT,
  resolution_summary TEXT,
  resolution_steps JSONB DEFAULT '[]'::jsonb,
  snippet_generated BOOLEAN DEFAULT false,
  approved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.kb_snippets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_resolution ENABLE ROW LEVEL SECURITY;

-- RLS Policies for kb_snippets
CREATE POLICY "Admins can manage kb_snippets"
  ON public.kb_snippets FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Agents can view approved kb_snippets"
  ON public.kb_snippets FOR SELECT
  USING (approved = true OR has_role(auth.uid(), 'admin'));

-- RLS Policies for kb_embeddings
CREATE POLICY "Admins can manage kb_embeddings"
  ON public.kb_embeddings FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Agents can view kb_embeddings"
  ON public.kb_embeddings FOR SELECT
  USING (true);

-- RLS Policies for message_feedback
CREATE POLICY "Users can insert own feedback"
  ON public.message_feedback FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can view team feedback"
  ON public.message_feedback FOR SELECT
  USING (has_role(auth.uid(), 'admin') OR created_by = auth.uid());

CREATE POLICY "Admins can manage all feedback"
  ON public.message_feedback FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for conversation_resolution
CREATE POLICY "Admins can manage conversation_resolution"
  ON public.conversation_resolution FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Agents can view conversation_resolution"
  ON public.conversation_resolution FOR SELECT
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'agent'));

-- Create indexes for performance
CREATE INDEX idx_kb_snippets_category ON public.kb_snippets(category);
CREATE INDEX idx_kb_snippets_approved ON public.kb_snippets(approved);
CREATE INDEX idx_kb_snippets_team_id ON public.kb_snippets(team_id);
CREATE INDEX idx_kb_embeddings_snippet_id ON public.kb_embeddings(snippet_id);
CREATE INDEX idx_message_feedback_message_id ON public.message_feedback(message_id);
CREATE INDEX idx_conversation_resolution_conversation_id ON public.conversation_resolution(conversation_id);

-- Triggers for updated_at
CREATE TRIGGER update_kb_snippets_updated_at
  BEFORE UPDATE ON public.kb_snippets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to search similar embeddings
CREATE OR REPLACE FUNCTION public.match_kb_snippets(
  query_embedding extensions.vector(768),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5,
  filter_team_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  snippet_id UUID,
  title TEXT,
  problem_text TEXT,
  solution_text TEXT,
  category TEXT,
  tags JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    s.id as snippet_id,
    s.title,
    s.problem_text,
    s.solution_text,
    s.category,
    s.tags,
    1 - (e.embedding <=> query_embedding) as similarity
  FROM kb_embeddings e
  JOIN kb_snippets s ON e.snippet_id = s.id
  WHERE s.approved = true
    AND (filter_team_id IS NULL OR s.team_id = filter_team_id OR s.team_id IS NULL)
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;