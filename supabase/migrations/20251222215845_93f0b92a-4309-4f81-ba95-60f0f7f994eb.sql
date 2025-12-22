-- Fix PUBLIC_DATA_EXPOSURE: Implement team-based RLS for conversations and messages

-- Helper function to get user's team_id
CREATE OR REPLACE FUNCTION public.get_user_team_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT team_id FROM public.profiles WHERE id = _user_id
$$;

-- Helper function to check if user can access a conversation
CREATE OR REPLACE FUNCTION public.can_access_conversation(_user_id uuid, _conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
    LEFT JOIN public.profiles assigned_profile ON c.assigned_to = assigned_profile.id
    WHERE c.id = _conversation_id
    AND (
      -- Admins can access all
      public.has_role(_user_id, 'admin') OR
      -- User is directly assigned
      c.assigned_to = _user_id OR
      -- Conversation is unassigned (available to all agents)
      c.assigned_to IS NULL OR
      -- User is on the same team as the assigned agent
      assigned_profile.team_id = public.get_user_team_id(_user_id)
    )
  )
$$;

-- Drop existing permissive policies on conversations
DROP POLICY IF EXISTS "Authenticated users can view conversations" ON public.conversations;
DROP POLICY IF EXISTS "Authenticated users can insert conversations" ON public.conversations;
DROP POLICY IF EXISTS "Authenticated users can update conversations" ON public.conversations;

-- Create team-based policies for conversations
CREATE POLICY "Users can view team conversations" 
  ON public.conversations FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    assigned_to = auth.uid() OR
    assigned_to IS NULL OR
    EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = assigned_to 
      AND p.team_id = public.get_user_team_id(auth.uid())
    )
  );

CREATE POLICY "Users can insert conversations" 
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'agent')
  );

CREATE POLICY "Users can update team conversations" 
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    assigned_to = auth.uid() OR
    assigned_to IS NULL OR
    EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = assigned_to 
      AND p.team_id = public.get_user_team_id(auth.uid())
    )
  );

-- Drop existing permissive policies on messages
DROP POLICY IF EXISTS "Authenticated users can view messages" ON public.messages;
DROP POLICY IF EXISTS "Authenticated users can insert messages" ON public.messages;
DROP POLICY IF EXISTS "Authenticated users can update messages" ON public.messages;

-- Create team-based policies for messages
CREATE POLICY "Users can view team messages" 
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    public.can_access_conversation(auth.uid(), conversation_id)
  );

CREATE POLICY "Users can insert team messages" 
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_access_conversation(auth.uid(), conversation_id)
  );

CREATE POLICY "Users can update team messages" 
  ON public.messages FOR UPDATE
  TO authenticated
  USING (
    public.can_access_conversation(auth.uid(), conversation_id)
  );

-- Drop existing permissive policies on conversation_labels
DROP POLICY IF EXISTS "Authenticated users can manage conversation_labels" ON public.conversation_labels;
DROP POLICY IF EXISTS "Authenticated users can view conversation_labels" ON public.conversation_labels;

-- Create team-based policies for conversation_labels
CREATE POLICY "Users can view team conversation_labels" 
  ON public.conversation_labels FOR SELECT
  TO authenticated
  USING (
    public.can_access_conversation(auth.uid(), conversation_id)
  );

CREATE POLICY "Users can manage team conversation_labels" 
  ON public.conversation_labels FOR ALL
  TO authenticated
  USING (
    public.can_access_conversation(auth.uid(), conversation_id)
  );

-- Drop existing permissive policies on contacts
DROP POLICY IF EXISTS "Authenticated users can view contacts" ON public.contacts;
DROP POLICY IF EXISTS "Authenticated users can insert contacts" ON public.contacts;
DROP POLICY IF EXISTS "Authenticated users can update contacts" ON public.contacts;

-- Create team-based policies for contacts (contacts visible if user can access their conversations)
CREATE POLICY "Users can view accessible contacts" 
  ON public.contacts FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    EXISTS (
      SELECT 1 FROM public.conversations c 
      WHERE c.contact_id = id 
      AND public.can_access_conversation(auth.uid(), c.id)
    )
  );

CREATE POLICY "Users can insert contacts" 
  ON public.contacts FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'agent')
  );

CREATE POLICY "Users can update accessible contacts" 
  ON public.contacts FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    EXISTS (
      SELECT 1 FROM public.conversations c 
      WHERE c.contact_id = id 
      AND public.can_access_conversation(auth.uid(), c.id)
    )
  );