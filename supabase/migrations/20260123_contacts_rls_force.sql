
-- =====================================================
-- NUCLEAR FIX: CONTACTS RLS (FORCE RESET)
-- =====================================================
-- Drops existing policies to clear any "bad state" and re-applies correct ones.

BEGIN;

-- 1. Drop existing policies (force clean slate)
DROP POLICY IF EXISTS "enable_read_for_authenticated" ON public.contacts;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.contacts;
DROP POLICY IF EXISTS "Allow authenticated read" ON public.contacts;

-- 2. Create the correct policy
CREATE POLICY "enable_read_for_authenticated"
ON public.contacts
FOR SELECT
TO authenticated
USING (true);

-- 3. Ensure RLS is enabled
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- 4. Grant explicit permissions (just in case)
GRANT SELECT ON public.contacts TO authenticated;
GRANT SELECT ON public.contacts TO service_role;

COMMIT;
