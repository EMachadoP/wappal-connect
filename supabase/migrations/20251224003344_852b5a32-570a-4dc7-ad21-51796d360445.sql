-- Fix UPDATE RLS policy for assignments: add WITH CHECK (required for UPDATE new-row validation)
DROP POLICY IF EXISTS "Agents can update any conversation" ON public.conversations;

CREATE POLICY "Agents can update any conversation"
ON public.conversations
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'agent'::public.app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'agent'::public.app_role)
);