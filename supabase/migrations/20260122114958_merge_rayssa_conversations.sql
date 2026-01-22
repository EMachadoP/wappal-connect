-- Merge duplicate Rayssa conversations (558182575570)
-- This happens when the same contact has LID and phone as separate identities

DO $$
DECLARE
  target_phone TEXT := '558182575570';
  primary_contact_id uuid;
  primary_conv_id uuid;
  dup_contact_record RECORD;
  dup_conv_record RECORD;
BEGIN
  -- 1. Find the primary contact (with this phone)
  SELECT id INTO primary_contact_id 
  FROM contacts 
  WHERE phone LIKE '%' || target_phone || '%'
     OR chat_key LIKE '%' || target_phone || '%'
  ORDER BY created_at ASC
  LIMIT 1;
  
  IF primary_contact_id IS NULL THEN
    RAISE NOTICE 'No primary contact found for phone %', target_phone;
    RETURN;
  END IF;
  
  RAISE NOTICE 'Primary contact ID: %', primary_contact_id;
  
  -- 2. Find the primary conversation
  SELECT id INTO primary_conv_id 
  FROM conversations 
  WHERE contact_id = primary_contact_id
  ORDER BY last_message_at DESC NULLS LAST
  LIMIT 1;
  
  RAISE NOTICE 'Primary conversation ID: %', primary_conv_id;
  
  -- 3. Find duplicate contacts with same phone
  FOR dup_contact_record IN 
    SELECT id, name, phone, chat_key
    FROM contacts 
    WHERE id != primary_contact_id
      AND (phone LIKE '%' || target_phone || '%' 
           OR chat_key LIKE '%' || target_phone || '%'
           OR name ILIKE '%rayssa%')
  LOOP
    RAISE NOTICE 'Found duplicate contact: % (name: %, chat_key: %)', 
      dup_contact_record.id, dup_contact_record.name, dup_contact_record.chat_key;
    
    -- Find conversations of this duplicate contact
    FOR dup_conv_record IN
      SELECT id FROM conversations WHERE contact_id = dup_contact_record.id
    LOOP
      IF primary_conv_id IS NOT NULL THEN
        -- Move messages
        UPDATE messages SET conversation_id = primary_conv_id WHERE conversation_id = dup_conv_record.id;
        -- Move protocols
        UPDATE protocols SET conversation_id = primary_conv_id WHERE conversation_id = dup_conv_record.id;
        -- Delete duplicate conversation
        DELETE FROM conversations WHERE id = dup_conv_record.id;
        RAISE NOTICE 'Merged conversation % into %', dup_conv_record.id, primary_conv_id;
      ELSE
        -- First conversation becomes primary
        primary_conv_id := dup_conv_record.id;
        UPDATE conversations SET contact_id = primary_contact_id WHERE id = primary_conv_id;
        RAISE NOTICE 'Set conversation % as primary', primary_conv_id;
      END IF;
    END LOOP;
    
    -- Move participants
    UPDATE participants SET contact_id = primary_contact_id WHERE contact_id = dup_contact_record.id;
    
    -- Delete duplicate contact
    DELETE FROM contacts WHERE id = dup_contact_record.id;
    RAISE NOTICE 'Deleted duplicate contact %', dup_contact_record.id;
  END LOOP;
  
  RAISE NOTICE 'Merge completed for phone %', target_phone;
END $$;
