-- Fix PUBLIC_DATA_EXPOSURE: Restrict overly permissive RLS policies

-- 1. Restrict profiles visibility to same team, admin, or own profile
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;

CREATE POLICY "Users can view team profiles"
ON public.profiles FOR SELECT
USING (
  public.has_role(auth.uid(), 'admin') OR
  id = auth.uid() OR
  team_id IS NULL OR
  team_id = public.get_user_team_id(auth.uid())
);

-- 2. Restrict protocols to accessible conversations or admin
DROP POLICY IF EXISTS "Authenticated users can view protocols" ON public.protocols;

CREATE POLICY "Users can view accessible protocols"
ON public.protocols FOR SELECT
USING (
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'agent') AND (
    conversation_id IS NULL OR
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = protocols.conversation_id
      AND public.can_access_conversation(auth.uid(), c.id)
    )
  )
);

-- 3. Restrict participants to accessible contacts
DROP POLICY IF EXISTS "Authenticated users can view participants" ON public.participants;

CREATE POLICY "Users can view accessible participants"
ON public.participants FOR SELECT
USING (
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'agent') AND EXISTS (
    SELECT 1 FROM contacts
    WHERE contacts.id = participants.contact_id
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.contact_id = contacts.id
      AND public.can_access_conversation(auth.uid(), c.id)
    )
  )
);

-- 4. Restrict integrations_settings to admins only (remove authenticated view)
DROP POLICY IF EXISTS "Authenticated users can view integrations_settings" ON public.integrations_settings;

CREATE POLICY "Admins can view integrations_settings"
ON public.integrations_settings FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- 5. Restrict entities to admins and agents (already low risk but tighten)
DROP POLICY IF EXISTS "Authenticated users can view entities" ON public.entities;

CREATE POLICY "Agents can view entities"
ON public.entities FOR SELECT
USING (
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'agent')
);