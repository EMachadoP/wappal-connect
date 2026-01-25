-- Migration: Fix G7 Serv Duplicate Conversations
-- Date: 2026-01-25
-- Description: Consolidates duplicate conversations for 'G7 Serv' into a single canonical record and normalizes thread keys.

BEGIN;

DO $$ 
DECLARE
    canonical_id UUID;
    duplicate_record RECORD;
    v_new_thread_key TEXT;
    v_canonical_chat_id TEXT;
    v_old_ids UUID[];
BEGIN
    RAISE NOTICE 'Starting G7 Serv fix...';

    -- 1. Identify the Canonical Conversation (latest logic or manually selected if known)
    -- We look for the one that looks most "correct" (e.g. recent activity, or specific ID)
    -- Using the most recently updated one as the base survivor.
    SELECT id, chat_id INTO canonical_id, v_canonical_chat_id
    FROM conversations
    WHERE (contact_name ILIKE '%G7%Serv%' OR contact_name ILIKE '%Grupo%')
      AND chat_id ILIKE '%@g.us'
    ORDER BY updated_at DESC
    LIMIT 1;

    IF canonical_id IS NULL THEN
        RAISE NOTICE 'No G7 Serv conversation found. Skipping.';
        RETURN;
    END IF;

    -- Ensure the canonical one has the strict normalized key
    -- Re-implement simple normalization logic here for SQL
    v_canonical_chat_id := REPLACE(v_canonical_chat_id, '@gus', '@g.us');
    v_new_thread_key := 'group:' || v_canonical_chat_id;

    RAISE NOTICE 'Canonical ID: %, New Key: %', canonical_id, v_new_thread_key;

    -- 2. Find Duplicates (same chat_id base or known G7 variants)
    -- This matches conversations that ARE G7 Serv but NOT the canonical one
    SELECT ARRAY_AGG(id) INTO v_old_ids
    FROM conversations
    WHERE id != canonical_id
      AND (
          contact_name ILIKE '%G7%Serv%' 
          OR chat_id = v_canonical_chat_id 
          OR thread_key = v_new_thread_key
      );

    IF v_old_ids IS NOT NULL THEN
        RAISE NOTICE 'Found duplicates: %', v_old_ids;

        -- 3. Move Messages to Canonical
        UPDATE messages 
        SET conversation_id = canonical_id 
        WHERE conversation_id = ANY(v_old_ids);

        -- 4. Delete Duplicates
        DELETE FROM conversations 
        WHERE id = ANY(v_old_ids);
    ELSE
        RAISE NOTICE 'No duplicates found.';
    END IF;

    -- 5. Fix Canonical Record
    UPDATE conversations
    SET 
        thread_key = v_new_thread_key,
        chat_id = v_canonical_chat_id,
        contact_id = NULL, -- Groups don't have single contact_id usually
        title = 'G7 Serv' -- Force correct title if missing
    WHERE id = canonical_id;

    RAISE NOTICE 'Fix complete.';

END $$;

COMMIT;
