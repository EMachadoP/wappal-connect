-- Migration: Merge duplicate group conversations (dash vs no-dash)
-- Created: 2026-01-24

DO $$
DECLARE
    target_conv_id UUID := 'c6399bc0-f0bc-4d86-8a10-827f7a71a3af'; -- The one with dash
    source_conv_id UUID := 'cf2338de-a135-496b-9c91-367941fad487'; -- The one without dash
BEGIN
    -- Check if both actually exist before proceeding
    IF EXISTS (SELECT 1 FROM conversations WHERE id = target_conv_id) AND 
       EXISTS (SELECT 1 FROM conversations WHERE id = source_conv_id) THEN
        
        RAISE NOTICE 'Merging group messages from % to %', source_conv_id, target_conv_id;

        -- 1. Move messages
        UPDATE messages 
        SET conversation_id = target_conv_id 
        WHERE conversation_id = source_conv_id;

        -- 2. Move protocols (if any)
        UPDATE protocols 
        SET conversation_id = target_conv_id 
        WHERE conversation_id = source_conv_id;

        -- 3. Delete the duplicate conversation
        DELETE FROM conversations 
        WHERE id = source_conv_id;
        
    ELSIF EXISTS (SELECT 1 FROM conversations WHERE id = source_conv_id) THEN
        -- If only the "wrong" one exists, we shouldn't just delete it.
        -- We should update its thread_key to the correct one if possible.
        -- But in this specific case, both exist.
        RAISE NOTICE 'Only source conversation exists. No merge needed, but normalization advised.';
    END IF;
END $$;
