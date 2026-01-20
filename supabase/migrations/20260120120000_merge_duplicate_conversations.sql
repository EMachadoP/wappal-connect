-- Merge duplicate conversations for the same contact
-- Keeps the most recent conversation and moves all messages to it

DO $$
DECLARE
  dup RECORD;
  keeper_conv_id UUID;
  old_conv_ids UUID[];
BEGIN
  -- Find contacts with multiple conversations
  FOR dup IN 
    SELECT 
      contact_id,
      ARRAY_AGG(id ORDER BY updated_at DESC, created_at DESC) as conv_ids,
      COUNT(*) as conv_count
    FROM conversations
    GROUP BY contact_id
    HAVING COUNT(*) > 1
  LOOP
    -- Keep the most recent conversation (first in array)
    keeper_conv_id := dup.conv_ids[1];
    
    -- Get array of old conversation IDs to merge
    old_conv_ids := dup.conv_ids[2:array_length(dup.conv_ids, 1)];
    
    RAISE NOTICE 'Merging % conversations for contact %: keeping %, removing %', 
      dup.conv_count, dup.contact_id, keeper_conv_id, old_conv_ids;
    
    -- Move all messages from old conversations to the keeper
    UPDATE messages 
    SET conversation_id = keeper_conv_id
    WHERE conversation_id = ANY(old_conv_ids);
    
    -- Move message_outbox entries to the keeper conversation
    UPDATE message_outbox
    SET conversation_id = keeper_conv_id
    WHERE conversation_id = ANY(old_conv_ids);
    
    -- Update the keeper conversation's last_message_at to reflect all messages
    UPDATE conversations
    SET 
      last_message_at = (
        SELECT MAX(sent_at) 
        FROM messages 
        WHERE conversation_id = keeper_conv_id
      ),
      last_message = (
        SELECT content 
        FROM messages 
        WHERE conversation_id = keeper_conv_id 
        ORDER BY sent_at DESC 
        LIMIT 1
      ),
      last_message_type = (
        SELECT message_type 
        FROM messages 
        WHERE conversation_id = keeper_conv_id 
        ORDER BY sent_at DESC 
        LIMIT 1
      ),
      unread_count = (
        SELECT COUNT(*) 
        FROM messages 
        WHERE conversation_id = keeper_conv_id 
          AND direction = 'inbound' 
          AND read_at IS NULL
      )
    WHERE id = keeper_conv_id;
    
    -- Delete the old conversations (now safe after moving outbox entries)
    DELETE FROM conversations 
    WHERE id = ANY(old_conv_ids);
    
    RAISE NOTICE 'Merged successfully: moved messages and deleted % old conversations', 
      array_length(old_conv_ids, 1);
  END LOOP;
  
  RAISE NOTICE 'Cleanup complete!';
END$$;
