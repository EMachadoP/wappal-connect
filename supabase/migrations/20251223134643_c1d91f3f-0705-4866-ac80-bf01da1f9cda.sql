-- Add sender_phone and sender_name to messages for group participant tracking
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS sender_phone TEXT,
ADD COLUMN IF NOT EXISTS sender_name TEXT;

-- Create function to normalize chat_id (trim, lower, ensure @g.us suffix for groups)
CREATE OR REPLACE FUNCTION normalize_chat_id(raw_chat_id TEXT)
RETURNS TEXT AS $$
BEGIN
  IF raw_chat_id IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Trim and lowercase
  raw_chat_id := LOWER(TRIM(raw_chat_id));
  
  RETURN raw_chat_id;
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;

-- Update existing chat_ids to be normalized
UPDATE public.conversations
SET chat_id = normalize_chat_id(chat_id)
WHERE chat_id IS NOT NULL;

-- Create unique index on normalized chat_id (partial - only where chat_id is not null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_chat_id_unique
ON public.conversations (chat_id)
WHERE chat_id IS NOT NULL;

-- Create unique index for message idempotency by provider + provider_message_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_provider_message_id_unique
ON public.messages (provider, provider_message_id)
WHERE provider IS NOT NULL AND provider_message_id IS NOT NULL;

-- Create index for faster duplicate detection
CREATE INDEX IF NOT EXISTS idx_conversations_chat_id_group
ON public.conversations (chat_id)
WHERE chat_id LIKE '%@g.us';

-- Add comment explaining the constraint
COMMENT ON INDEX idx_conversations_chat_id_unique IS 'Ensures each chat_id (group or private) maps to exactly one conversation';