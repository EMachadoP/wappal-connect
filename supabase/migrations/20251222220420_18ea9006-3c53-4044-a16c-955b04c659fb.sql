-- Fix ai_conversation_state RLS: restrict access to conversations user can access
DROP POLICY IF EXISTS "Authenticated can manage ai_conversation_state" ON public.ai_conversation_state;

CREATE POLICY "Users can view own conversation ai_state"
  ON public.ai_conversation_state FOR SELECT
  TO authenticated
  USING (
    public.can_access_conversation(auth.uid(), conversation_id)
  );

CREATE POLICY "Users can update own conversation ai_state"
  ON public.ai_conversation_state FOR UPDATE
  TO authenticated
  USING (
    public.can_access_conversation(auth.uid(), conversation_id)
  );

CREATE POLICY "Users can insert conversation ai_state"
  ON public.ai_conversation_state FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_access_conversation(auth.uid(), conversation_id)
  );

-- Allow service role to manage all (for edge functions)
CREATE POLICY "Service role can manage all ai_conversation_state"
  ON public.ai_conversation_state FOR ALL
  TO service_role
  USING (true);