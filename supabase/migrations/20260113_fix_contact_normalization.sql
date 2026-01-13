-- Migration logic to fix duplicate contacts and normalize LIDs
-- 1. Identify and normalize contacts with suffixes
-- 2. Merge duplicates if they exist, moving data to the oldest record (usually the one with identified participants)

DO $$ 
DECLARE
    contact_rec RECORD;
    target_id UUID;
    normalized_lid TEXT;
BEGIN
    -- For each contact with a legacy LID format
    FOR contact_rec IN 
        SELECT id, chat_lid, created_at 
        FROM public.contacts 
        WHERE chat_lid LIKE '%@c.us' OR chat_lid LIKE '%@s.whatsapp.net'
    LOOP
        -- Calculate normalized LID
        normalized_lid := split_part(contact_rec.chat_lid, '@', 1);
        
        -- Check if a contact with the normalized LID already exists
        SELECT id INTO target_id 
        FROM public.contacts 
        WHERE chat_lid = normalized_lid 
        LIMIT 1;
        
        IF target_id IS NOT NULL AND target_id <> contact_rec.id THEN
            -- DUPLICATE EXISTS: Merge data from the duplicate back to the original (or vice versa)
            -- We'll move everything from the 'normalized' one (target_id) to the 'legacy' one (contact_rec.id)
            -- because the legacy one likely has the participants/identifications
            
            -- Move conversations
            UPDATE public.conversations 
            SET contact_id = contact_rec.id 
            WHERE contact_id = target_id;
            
            -- Move protocols
            UPDATE public.protocols
            SET contact_id = contact_rec.id
            WHERE contact_id = target_id;
            
            -- Move participants (if target has any and legacy doesn't)
            INSERT INTO public.participants (contact_id, entity_id, name, role_type, confidence, is_primary)
            SELECT contact_rec.id, p.entity_id, p.name, p.role_type, p.confidence, p.is_primary
            FROM public.participants p
            WHERE p.contact_id = target_id
            AND NOT EXISTS (
                SELECT 1 FROM public.participants p2 
                WHERE p2.contact_id = contact_rec.id 
                AND p2.entity_id = p.entity_id
            );
            
            -- Delete the duplicate contact (references are now updated or deleted)
            DELETE FROM public.participants WHERE contact_id = target_id;
            -- Protocols and conversations were updated above
            DELETE FROM public.contacts WHERE id = target_id;
            
            -- Now normalize the original contact
            UPDATE public.contacts 
            SET chat_lid = normalized_lid, lid = normalized_lid 
            WHERE id = contact_rec.id;
        ELSE
            -- NO DUPLICATE: Just normalize the existing contact
            UPDATE public.contacts 
            SET chat_lid = normalized_lid, lid = normalized_lid 
            WHERE id = contact_rec.id;
        END IF;
    END LOOP;
END $$;
