-- Migration to enforce unique indices for LID, Phone and Conversation Thread Key
-- This prevents duplication at the database level.

-- Indices for contacts
CREATE UNIQUE INDEX IF NOT EXISTS contacts_unique_lid 
ON public.contacts (account_id, lid) 
WHERE (lid IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS contacts_unique_phone 
ON public.contacts (account_id, phone_e164) 
WHERE (phone_e164 IS NOT NULL);

-- Index for conversations thread_key
CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_thread 
ON public.conversations (account_id, thread_key)
WHERE (thread_key IS NOT NULL);
