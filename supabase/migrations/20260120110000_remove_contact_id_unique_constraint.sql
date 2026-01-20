-- Remove the incorrect unique constraint on conversations.contact_id
-- A single contact SHOULD be able to have multiple conversations

-- Drop the unique constraint if it exists
DO $$
BEGIN
    -- Try dropping the constraint by name
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'conversations_contact_id_unique'
    ) THEN
        ALTER TABLE public.conversations DROP CONSTRAINT conversations_contact_id_unique;
        RAISE NOTICE 'Dropped constraint conversations_contact_id_unique';
    END IF;
    
    -- Try dropping the index if it exists
    IF EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'conversations_contact_id_unique'
    ) THEN
        DROP INDEX IF EXISTS public.conversations_contact_id_unique;
        RAISE NOTICE 'Dropped index conversations_contact_id_unique';
    END IF;
END$$;

-- Ensure we have a regular (non-unique) index for performance
-- This allows fast lookups while permitting duplicates
CREATE INDEX IF NOT EXISTS idx_conversations_contact_id 
    ON public.conversations(contact_id);

COMMENT ON INDEX idx_conversations_contact_id IS 
    'Performance index for looking up all conversations for a contact. Non-unique to allow multiple conversations per contact.';
