-- =====================================================
-- FIX: MESSAGE UNIQUE CONSTRAINT FOR MULTI-PROVIDER
-- =====================================================
-- Changes the uniqueness constraint from (provider_message_id) 
-- to (provider, provider_message_id) to support multiple providers.

-- 1. Drop old single-column unique indexes/constraints if they exist
DROP INDEX IF EXISTS public.messages_provider_message_id_key;
DROP INDEX IF EXISTS public.idx_messages_provider_message_id; -- Old manual index
DROP INDEX IF EXISTS public.idx_messages_provider_id_unique;  -- From 20260114 migration

-- 2. Ensure provider is NOT NULL (critical for the composite key)
-- If there are any null providers, default them to 'zapi' before locking
UPDATE public.messages 
SET provider = 'zapi' 
WHERE provider IS NULL;

ALTER TABLE public.messages 
ALTER COLUMN provider SET DEFAULT 'zapi',
ALTER COLUMN provider SET NOT NULL;

-- 3. Create the new composite unique index
-- We use an index instead of a constraint for better partial support if needed,
-- but a unique index acts as a unique constraint.
CREATE UNIQUE INDEX messages_provider_provider_message_id_idx
ON public.messages(provider, provider_message_id);

-- Optional: Add a named constraint using the index for cleaner error messages
ALTER TABLE public.messages
ADD CONSTRAINT messages_provider_id_uq 
UNIQUE USING INDEX messages_provider_provider_message_id_idx;
