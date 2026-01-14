-- 1. Add chat_key column to contacts
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS chat_key text;

-- 2. Create index for faster key-based lookups
CREATE INDEX IF NOT EXISTS idx_contacts_chat_key ON public.contacts(chat_key);

-- 3. Normalization function (canonical key)
CREATE OR REPLACE FUNCTION public.normalize_chat_key(chat_id text) 
RETURNS text AS $$
BEGIN
  IF chat_id IS NULL THEN RETURN NULL; END IF;
  -- Extract numeric part from @lid, @s.whatsapp.net, @c.us or raw numbers
  -- This ignores @g.us as groups are unique canonical IDs themselves
  IF chat_id LIKE '%@g.us' THEN
    RETURN chat_id;
  END IF;
  
  -- Remove any suffix and non-numeric characters (except for groups)
  RETURN regexp_replace(split_part(chat_id, '@', 1), '[^0-9]', '', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4. Initial population of chat_key
UPDATE public.contacts 
SET chat_key = normalize_chat_key(COALESCE(chat_id, lid, chat_lid, phone))
WHERE chat_key IS NULL;

-- 5. CONSOLIDATION: Merge "Sandro" case (as identified by user)
DO $$
DECLARE
  v_keep_contact uuid := 'f9d5d6ae-66bb-46fa-a802-4b8820609f71'; -- The one with phone and @lid
  v_drop_contact uuid := '1cf73b3e-0fde-4179-baf9-e56ffc694fed'; -- The duplicate one
  v_keep_conv uuid := '80a8559c-dfb1-431c-bf80-b6ace98b8e6a';
  v_drop_conv uuid := 'ce104f5c-564b-4730-8900-d23534a07b09';
BEGIN
  -- We check if they exist before merging to avoid errors if already merged
  IF EXISTS (SELECT 1 FROM public.conversations WHERE id = v_drop_conv) THEN
    -- Move messages from DROP to KEEP
    UPDATE public.messages
    SET conversation_id = v_keep_conv
    WHERE conversation_id = v_drop_conv;

    -- Update any references in other tables (safe-guard)
    UPDATE public.protocols SET conversation_id = v_keep_conv WHERE conversation_id = v_drop_conv;
    UPDATE public.ai_events SET conversation_id = v_keep_conv WHERE conversation_id = v_drop_conv;

    -- Delete the duplicate conversation and contact
    DELETE FROM public.conversations WHERE id = v_drop_conv;
    DELETE FROM public.contacts WHERE id = v_drop_contact;
  END IF;
END $$;

-- 6. Backfill missing messages.chat_id for outbound messages
UPDATE public.messages m
SET chat_id = c.chat_id
FROM public.conversations c
WHERE m.conversation_id = c.id
  AND m.chat_id IS NULL
  AND c.chat_id IS NOT NULL;
