-- Add INSERT policy for condominiums table (agents and admins can create)
CREATE POLICY "Agents and admins can create condominiums" 
ON public.condominiums 
FOR INSERT 
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'agent'::app_role)
);