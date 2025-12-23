
-- First, clean up duplicate conversations based on chat_id
-- Keep the oldest conversation and merge others into it

-- Create a temp table to track which conversations to keep
CREATE TEMP TABLE conversations_to_keep AS
WITH ranked_conversations AS (
  SELECT 
    c.id,
    ct.chat_lid,
    ROW_NUMBER() OVER (PARTITION BY ct.chat_lid ORDER BY c.created_at ASC) as rn
  FROM conversations c
  JOIN contacts ct ON c.contact_id = ct.id
  WHERE ct.chat_lid IS NOT NULL
)
SELECT id, chat_lid FROM ranked_conversations WHERE rn = 1;

-- Update messages to point to the kept conversation
UPDATE messages m
SET conversation_id = ktk.id
FROM conversations c
JOIN contacts ct ON c.contact_id = ct.id
JOIN conversations_to_keep ktk ON ct.chat_lid = ktk.chat_lid
WHERE m.conversation_id = c.id
  AND c.id != ktk.id;

-- Update conversation_labels to point to the kept conversation
UPDATE conversation_labels cl
SET conversation_id = ktk.id
FROM conversations c
JOIN contacts ct ON c.contact_id = ct.id
JOIN conversations_to_keep ktk ON ct.chat_lid = ktk.chat_lid
WHERE cl.conversation_id = c.id
  AND c.id != ktk.id;

-- Update ai_conversation_state to point to the kept conversation
UPDATE ai_conversation_state acs
SET conversation_id = ktk.id
FROM conversations c
JOIN contacts ct ON c.contact_id = ct.id
JOIN conversations_to_keep ktk ON ct.chat_lid = ktk.chat_lid
WHERE acs.conversation_id = c.id
  AND c.id != ktk.id;

-- Update conversation_participant_state to point to the kept conversation
UPDATE conversation_participant_state cps
SET conversation_id = ktk.id
FROM conversations c
JOIN contacts ct ON c.contact_id = ct.id
JOIN conversations_to_keep ktk ON ct.chat_lid = ktk.chat_lid
WHERE cps.conversation_id = c.id
  AND c.id != ktk.id;

-- Update notifications to point to the kept conversation
UPDATE notifications n
SET conversation_id = ktk.id
FROM conversations c
JOIN contacts ct ON c.contact_id = ct.id
JOIN conversations_to_keep ktk ON ct.chat_lid = ktk.chat_lid
WHERE n.conversation_id = c.id
  AND c.id != ktk.id;

-- Update conversation_resolution to point to the kept conversation
UPDATE conversation_resolution cr
SET conversation_id = ktk.id
FROM conversations c
JOIN contacts ct ON c.contact_id = ct.id
JOIN conversations_to_keep ktk ON ct.chat_lid = ktk.chat_lid
WHERE cr.conversation_id = c.id
  AND c.id != ktk.id;

-- Delete duplicate conversations (keep only the oldest one per chat_lid)
DELETE FROM conversations c
USING contacts ct, conversations_to_keep ktk
WHERE c.contact_id = ct.id
  AND ct.chat_lid = ktk.chat_lid
  AND c.id != ktk.id;

-- Drop temp table
DROP TABLE conversations_to_keep;

-- Add chat_id to conversations if not exists
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS chat_id TEXT;

-- Populate chat_id from contacts.chat_lid
UPDATE conversations c
SET chat_id = ct.chat_lid
FROM contacts ct
WHERE c.contact_id = ct.id
  AND ct.chat_lid IS NOT NULL
  AND c.chat_id IS NULL;

-- Create unique index on chat_id (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_chat_id_unique ON conversations(chat_id) WHERE chat_id IS NOT NULL;

-- Add new fields to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'zapi';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_message_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS chat_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS direction TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'sent';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS raw_payload JSONB;

-- Migrate existing whatsapp_message_id to provider_message_id
UPDATE messages 
SET provider_message_id = whatsapp_message_id 
WHERE whatsapp_message_id IS NOT NULL 
  AND provider_message_id IS NULL;

-- Set direction based on sender_type
UPDATE messages
SET direction = CASE 
  WHEN sender_type = 'contact' THEN 'inbound'
  ELSE 'outbound'
END
WHERE direction IS NULL;

-- Populate chat_id from conversation
UPDATE messages m
SET chat_id = c.chat_id
FROM conversations c
WHERE m.conversation_id = c.id
  AND c.chat_id IS NOT NULL
  AND m.chat_id IS NULL;

-- Create unique indexes for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_provider_message_id 
ON messages(provider, provider_message_id) 
WHERE provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_message_id 
ON messages(client_message_id) 
WHERE client_message_id IS NOT NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id) WHERE chat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
