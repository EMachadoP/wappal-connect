-- Migration V2: Robust Contact & Participant Merging
-- This script fixes "unidentified sender" issues by merging duplicate contacts more aggressively
-- and ensuring participants are correctly linked.

DO $$
DECLARE
    rec RECORD;
    target_id UUID;
    v_chat_lid TEXT;
BEGIN
    -- 1. Normalize all contacts first (strip @c.us etc)
    UPDATE public.contacts 
    SET chat_lid = split_part(chat_lid, '@', 1),
        lid = split_part(lid, '@', 1)
    WHERE chat_lid LIKE '%@%' OR lid LIKE '%@%';

    -- 2. Identify duplicates by chat_lid
    FOR rec IN 
        SELECT chat_lid, count(*) 
        FROM public.contacts 
        WHERE chat_lid IS NOT NULL AND chat_lid <> ''
        GROUP BY chat_lid 
        HAVING count(*) > 1
    LOOP
        -- For each duplicate group, pick the "best" contact
        -- Priority: 1. Has participants, 2. Has conversations, 3. Oldest
        SELECT c.id INTO target_id
        FROM public.contacts c
        LEFT JOIN public.participants p ON p.contact_id = c.id
        LEFT JOIN public.conversations conv ON conv.contact_id = c.id
        WHERE c.chat_lid = rec.chat_lid
        ORDER BY 
            (SELECT count(*) FROM public.participants WHERE contact_id = c.id) DESC,
            (SELECT count(*) FROM public.conversations WHERE contact_id = c.id) DESC,
            c.created_at ASC
        LIMIT 1;

        -- Move everything to target_id
        -- Move conversations
        UPDATE public.conversations 
        SET contact_id = target_id 
        WHERE contact_id <> target_id 
        AND contact_id IN (SELECT id FROM public.contacts WHERE chat_lid = rec.chat_lid);

        -- Move protocols
        UPDATE public.protocols 
        SET contact_id = target_id 
        WHERE contact_id <> target_id 
        AND contact_id IN (SELECT id FROM public.contacts WHERE chat_lid = rec.chat_lid);

        -- Move participants
        UPDATE public.participants 
        SET contact_id = target_id 
        WHERE contact_id <> target_id 
        AND contact_id IN (SELECT id FROM public.contacts WHERE chat_lid = rec.chat_lid)
        AND NOT EXISTS (
            -- Avoid duplicate names on the same contact
            SELECT 1 FROM public.participants p2 
            WHERE p2.contact_id = target_id 
            AND p2.name = participants.name
        );

        -- Delete orphaned contacts in this group
        DELETE FROM public.contacts 
        WHERE id <> target_id 
        AND chat_lid = rec.chat_lid;
    END LOOP;

    -- 3. Ensure every contact with participants has exactly one 'is_primary' if none exists
    UPDATE public.participants p
    SET is_primary = true
    WHERE id IN (
        SELECT id FROM (
            SELECT id, row_number() OVER (PARTITION BY contact_id ORDER BY confidence DESC, created_at ASC) as rn
            FROM public.participants
            WHERE contact_id NOT IN (SELECT contact_id FROM public.participants WHERE is_primary = true)
        ) sub
        WHERE rn = 1
    );

    -- 4. Sync name back to contact if it's missing but we have a primary participant
    UPDATE public.contacts c
    SET name = p.name
    FROM public.participants p
    WHERE p.contact_id = c.id
    AND p.is_primary = true
    AND (c.name IS NULL OR c.name = '' OR c.name = c.chat_lid);

END $$;
