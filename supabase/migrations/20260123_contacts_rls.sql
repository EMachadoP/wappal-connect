
-- =====================================================
-- FIX CONTACTS RLS
-- =====================================================
-- Allows authenticated users (agents) to read all contacts.

DO $$
BEGIN
    -- Check if policy exists before creating to prevent error
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'contacts' 
        AND policyname = 'enable_read_for_authenticated'
    ) THEN
        CREATE POLICY "enable_read_for_authenticated"
        ON public.contacts
        FOR SELECT
        TO authenticated
        USING (true);
    END IF;
END $$;

-- Ensure RLS is enabled (safe operation)
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
