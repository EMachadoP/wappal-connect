-- Merge duplicate contacts: Erisson and Erison (558188962349)
-- Keep the contact with the phone number, merge data from the other

DO $$
DECLARE
  primary_contact_id uuid;
  duplicate_contact_id uuid;
  primary_conv_id uuid;
  duplicate_conv_id uuid;
BEGIN
  -- Find the contact with the phone number (Erison with 558188962349)
  SELECT id INTO primary_contact_id 
  FROM contacts 
  WHERE phone LIKE '%558188962349%' OR phone LIKE '%88962349%'
  LIMIT 1;
  
  -- Find the other contact (Erisson without phone)
  SELECT id INTO duplicate_contact_id 
  FROM contacts 
  WHERE (name ILIKE '%erisson%' OR name ILIKE '%erison%')
    AND id != COALESCE(primary_contact_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND (phone IS NULL OR phone = '' OR phone NOT LIKE '%88962349%')
  LIMIT 1;
  
  -- Exit if we don't have both contacts
  IF primary_contact_id IS NULL OR duplicate_contact_id IS NULL THEN
    RAISE NOTICE 'Could not find both contacts. Primary: %, Duplicate: %', primary_contact_id, duplicate_contact_id;
    RETURN;
  END IF;
  
  RAISE NOTICE 'Merging contacts: Primary=% (with phone), Duplicate=%', primary_contact_id, duplicate_contact_id;
  
  -- Get conversation IDs
  SELECT id INTO primary_conv_id FROM conversations WHERE contact_id = primary_contact_id LIMIT 1;
  SELECT id INTO duplicate_conv_id FROM conversations WHERE contact_id = duplicate_contact_id LIMIT 1;
  
  -- Update name on primary contact if it's better on duplicate
  UPDATE contacts 
  SET name = (SELECT name FROM contacts WHERE id = duplicate_contact_id)
  WHERE id = primary_contact_id 
    AND (name IS NULL OR name = '' OR name ~ '^\d+$');
  
  -- Move messages from duplicate conversation to primary
  IF primary_conv_id IS NOT NULL AND duplicate_conv_id IS NOT NULL THEN
    UPDATE messages SET conversation_id = primary_conv_id WHERE conversation_id = duplicate_conv_id;
    
    -- Move protocols
    UPDATE protocols SET conversation_id = primary_conv_id WHERE conversation_id = duplicate_conv_id;
    
    -- Move participants
    UPDATE participants SET contact_id = primary_contact_id WHERE contact_id = duplicate_contact_id;
    
    -- Delete duplicate conversation
    DELETE FROM conversations WHERE id = duplicate_conv_id;
  END IF;
  
  -- Delete duplicate contact
  DELETE FROM contacts WHERE id = duplicate_contact_id;
  
  RAISE NOTICE 'Merge completed successfully';
END $$;
