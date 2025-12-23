-- Fix RLS policy for contacts table - the condition was comparing c.contact_id = c.id instead of contacts.id
DROP POLICY IF EXISTS "Users can view accessible contacts" ON public.contacts;
DROP POLICY IF EXISTS "Users can update accessible contacts" ON public.contacts;

-- Recreate with correct condition
CREATE POLICY "Users can view accessible contacts" 
ON public.contacts 
FOR SELECT 
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'agent'::app_role)
  OR EXISTS (
    SELECT 1 FROM conversations c 
    WHERE c.contact_id = contacts.id 
    AND can_access_conversation(auth.uid(), c.id)
  )
);

CREATE POLICY "Users can update accessible contacts" 
ON public.contacts 
FOR UPDATE 
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'agent'::app_role)
  OR EXISTS (
    SELECT 1 FROM conversations c 
    WHERE c.contact_id = contacts.id 
    AND can_access_conversation(auth.uid(), c.id)
  )
);