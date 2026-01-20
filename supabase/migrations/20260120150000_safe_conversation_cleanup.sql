-- SAFE conversation deduplication - preserves protocols, merges messages
-- Strategy: Keep conversation with most data, delete only empty ones

DO $$
DECLARE
  dup RECORD;
  keeper_conv_id UUID;
  old_conv_ids UUID[];
  total_merged INTEGER := 0;
BEGIN
  RAISE NOTICE '🔍 Starting SAFE conversation cleanup...';
  
  FOR dup IN 
    SELECT 
      contact_id,
      ARRAY_AGG(id ORDER BY 
        -- Priority: conversation with protocols > most messages > most recent
        (SELECT COUNT(*) FROM protocols WHERE conversation_id = conversations.id) DESC,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id) DESC,
        last_message_at DESC NULLS LAST,
        updated_at DESC
      ) as conv_ids,
      COUNT(*) as conv_count
    FROM conversations
    WHERE contact_id IS NOT NULL
    GROUP BY contact_id
    HAVING COUNT(*) > 1
  LOOP
    keeper_conv_id := dup.conv_ids[1];
    old_conv_ids := dup.conv_ids[2:array_length(dup.conv_ids, 1)];
    
    RAISE NOTICE '📦 Merging % conversations for contact %', dup.conv_count, dup.contact_id;
    RAISE NOTICE '  ✅ Keeping: %', keeper_conv_id;
    RAISE NOTICE '  🗑️ Candidates for removal: %', old_conv_ids;
    
    -- Move messages from old to keeper
    UPDATE messages 
    SET conversation_id = keeper_conv_id
    WHERE conversation_id = ANY(old_conv_ids);
    
    -- Move outbox entries
    UPDATE message_outbox
    SET conversation_id = keeper_conv_id
    WHERE conversation_id = ANY(old_conv_ids);
    
    -- ✅ CRITICAL: Only delete conversations WITHOUT protocols
    -- This prevents constraint violations
    DELETE FROM conversations 
    WHERE id = ANY(old_conv_ids)
      AND id NOT IN (SELECT DISTINCT conversation_id FROM protocols WHERE conversation_id = ANY(old_conv_ids));
    
    GET DIAGNOSTICS total_merged = ROW_COUNT;
    
    -- Update keeper metadata
    UPDATE conversations
    SET 
      last_message_at = (SELECT MAX(sent_at) FROM messages WHERE conversation_id = keeper_conv_id),
      last_message = (SELECT content FROM messages WHERE conversation_id = keeper_conv_id ORDER BY sent_at DESC LIMIT 1),
      last_message_type = (SELECT message_type FROM messages WHERE conversation_id = keeper_conv_id ORDER BY sent_at DESC LIMIT 1),
      unread_count = (SELECT COUNT(*) FROM messages WHERE conversation_id = keeper_conv_id AND direction = 'inbound' AND read_at IS NULL)
    WHERE id = keeper_conv_id;
    
    RAISE NOTICE '  ✅ Deleted % empty conversations, messages merged to keeper', total_merged;
  END LOOP;
  
  RAISE NOTICE '✅ Cleanup complete! Any remaining duplicates have protocols and were preserved.';
END$$;
