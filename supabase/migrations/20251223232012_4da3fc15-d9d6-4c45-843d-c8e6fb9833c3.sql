-- Step 1: Add thread_key column
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS thread_key text;

-- Step 2: Set REPLICA IDENTITY FULL on messages for better realtime updates
ALTER TABLE public.messages REPLICA IDENTITY FULL;

-- Step 3: Populate thread_key for existing conversations
-- For groups: use chat_id
-- For individuals: use chat_id if exists, otherwise generate from contact's phone/lid
UPDATE public.conversations c
SET thread_key = CASE 
  WHEN EXISTS (SELECT 1 FROM contacts ct WHERE ct.id = c.contact_id AND ct.is_group = true) THEN 
    COALESCE(c.chat_id, (SELECT ct.chat_lid FROM contacts ct WHERE ct.id = c.contact_id))
  ELSE 
    COALESCE(
      c.chat_id, 
      (SELECT COALESCE(ct.phone, ct.lid, ct.chat_lid) FROM contacts ct WHERE ct.id = c.contact_id)
    )
END
WHERE c.thread_key IS NULL;

-- Step 4: Find and merge duplicate conversations (keep the oldest, move messages, delete others)
-- First, create a temp table to track duplicates
CREATE TEMP TABLE duplicate_conversations AS
SELECT 
  thread_key,
  MIN(created_at) as oldest_created,
  array_agg(id ORDER BY created_at) as all_ids,
  (array_agg(id ORDER BY created_at))[1] as keep_id
FROM public.conversations 
WHERE thread_key IS NOT NULL
GROUP BY thread_key 
HAVING COUNT(*) > 1;

-- Move messages from duplicate conversations to the primary one
UPDATE public.messages m
SET conversation_id = d.keep_id
FROM duplicate_conversations d
WHERE m.conversation_id = ANY(d.all_ids[2:])
AND NOT EXISTS (
  SELECT 1 FROM public.messages existing 
  WHERE existing.conversation_id = d.keep_id 
  AND existing.provider_message_id = m.provider_message_id
  AND m.provider_message_id IS NOT NULL
);

-- Move protocols from duplicate conversations
UPDATE public.protocols p
SET conversation_id = d.keep_id
FROM duplicate_conversations d
WHERE p.conversation_id = ANY(d.all_ids[2:]);

-- Move ai_events from duplicate conversations  
UPDATE public.ai_events e
SET conversation_id = d.keep_id
FROM duplicate_conversations d
WHERE e.conversation_id = ANY(d.all_ids[2:]);

-- Move ai_conversation_state (delete duplicates first since it has unique constraint)
DELETE FROM public.ai_conversation_state a
USING duplicate_conversations d
WHERE a.conversation_id = ANY(d.all_ids[2:]);

-- Move conversation_labels
UPDATE public.conversation_labels cl
SET conversation_id = d.keep_id
FROM duplicate_conversations d
WHERE cl.conversation_id = ANY(d.all_ids[2:])
AND NOT EXISTS (
  SELECT 1 FROM public.conversation_labels existing 
  WHERE existing.conversation_id = d.keep_id 
  AND existing.label_id = cl.label_id
);

-- Delete remaining duplicate labels
DELETE FROM public.conversation_labels cl
USING duplicate_conversations d
WHERE cl.conversation_id = ANY(d.all_ids[2:]);

-- Move conversation_participant_state (delete duplicates since unique constraint)
DELETE FROM public.conversation_participant_state cps
USING duplicate_conversations d
WHERE cps.conversation_id = ANY(d.all_ids[2:]);

-- Move notifications
UPDATE public.notifications n
SET conversation_id = d.keep_id
FROM duplicate_conversations d
WHERE n.conversation_id = ANY(d.all_ids[2:]);

-- Update the kept conversation with the latest info from all duplicates
UPDATE public.conversations c
SET 
  last_message_at = (
    SELECT MAX(last_message_at) 
    FROM public.conversations c2 
    WHERE c2.thread_key = c.thread_key
  ),
  unread_count = (
    SELECT COALESCE(SUM(unread_count), 0) 
    FROM public.conversations c2 
    WHERE c2.thread_key = c.thread_key
  )
FROM duplicate_conversations d
WHERE c.id = d.keep_id;

-- Delete the duplicate conversations (not the primary one)
DELETE FROM public.conversations c
USING duplicate_conversations d
WHERE c.id = ANY(d.all_ids[2:]);

-- Drop temp table
DROP TABLE duplicate_conversations;

-- Step 5: Make thread_key NOT NULL and add unique constraint
UPDATE public.conversations SET thread_key = id::text WHERE thread_key IS NULL;
ALTER TABLE public.conversations ALTER COLUMN thread_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_thread_key_idx ON public.conversations(thread_key);

-- Step 6: Create index on chat_id for faster lookups
CREATE INDEX IF NOT EXISTS conversations_chat_id_idx ON public.conversations(chat_id) WHERE chat_id IS NOT NULL;