-- Drop existing policy and create a more permissive one for agents
DROP POLICY IF EXISTS "Users can view team profiles" ON public.profiles;

-- Allow all authenticated users to view all active profiles (needed for agent assignment)
CREATE POLICY "Users can view all profiles" 
ON public.profiles 
FOR SELECT 
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'agent'::app_role)
  OR id = auth.uid()
);