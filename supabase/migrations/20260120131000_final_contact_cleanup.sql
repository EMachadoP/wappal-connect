-- Final cleanup: Merge duplicate contacts by phone OR lid
-- Keeps the most recent contact and consolidates all references

DO $$
DECLARE
  dup RECORD;
  keeper_contact_id UUID;
  old_contact_ids UUID[];
BEGIN
  RAISE NOTICE 'Starting contact cleanup...';
  
  -- Step 1: Merge contacts with duplicate phones
  FOR dup IN 
    SELECT 
      phone,
      ARRAY_AGG(id ORDER BY updated_at DESC, created_at DESC) as contact_ids,
      COUNT(*) as contact_count
    FROM contacts
    WHERE phone IS NOT NULL
    GROUP BY phone
    HAVING COUNT(*) > 1
  LOOP
    keeper_contact_id := dup.contact_ids[1];
    old_contact_ids := dup.contact_ids[2:array_length(dup.contact_ids, 1)];
    
    RAISE NOTICE 'Merging % contacts for phone %: keeping %, removing %', 
      dup.contact_count, dup.phone, keeper_contact_id, old_contact_ids;
    
    -- Update all conversations
    UPDATE conversations 
    SET contact_id = keeper_contact_id
    WHERE contact_id = ANY(old_contact_ids);
    
    -- Update keeper's lid if any old contact had one
    UPDATE contacts
    SET lid = COALESCE(lid, (
      SELECT lid FROM contacts 
      WHERE id = ANY(old_contact_ids) AND lid IS NOT NULL 
      LIMIT 1
    ))
    WHERE id = keeper_contact_id AND lid IS NULL;
    
    -- Delete old contacts
    DELETE FROM contacts WHERE id = ANY(old_contact_ids);
    
    RAISE NOTICE 'Merged phone duplicates: deleted % old contacts', 
      array_length(old_contact_ids, 1);
  END LOOP;
  
  -- Step 2: Merge contacts with duplicate LIDs (after phone merge)
  FOR dup IN 
    SELECT 
      lid,
      ARRAY_AGG(id ORDER BY updated_at DESC, created_at DESC) as contact_ids,
      COUNT(*) as contact_count
    FROM contacts
    WHERE lid IS NOT NULL
    GROUP BY lid
    HAVING COUNT(*) > 1
  LOOP
    keeper_contact_id := dup.contact_ids[1];
    old_contact_ids := dup.contact_ids[2:array_length(dup.contact_ids, 1)];
    
    RAISE NOTICE 'Merging % contacts for LID %: keeping %, removing %', 
      dup.contact_count, dup.lid, keeper_contact_id, old_contact_ids;
    
    -- Update all conversations
    UPDATE conversations 
    SET contact_id = keeper_contact_id
    WHERE contact_id = ANY(old_contact_ids);
    
    -- Update keeper's phone if any old contact had one
    UPDATE contacts
    SET phone = COALESCE(phone, (
      SELECT phone FROM contacts 
      WHERE id = ANY(old_contact_ids) AND phone IS NOT NULL 
      LIMIT 1
    ))
    WHERE id = keeper_contact_id AND phone IS NULL;
    
    -- Delete old contacts
    DELETE FROM contacts WHERE id = ANY(old_contact_ids);
    
    RAISE NOTICE 'Merged LID duplicates: deleted % old contacts', 
      array_length(old_contact_ids, 1);
  END LOOP;
  
  RAISE NOTICE 'Contact cleanup complete!';
END$$;
