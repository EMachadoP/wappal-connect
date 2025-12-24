-- Drop current restrictive UPDATE policy
DROP POLICY IF EXISTS "Users can update team conversations" ON public.conversations;

-- Create new policy: any agent or admin can update any conversation
CREATE POLICY "Agents can update any conversation" 
ON public.conversations 
FOR UPDATE 
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'agent'::app_role)
);