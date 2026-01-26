-- =====================================================
-- MERGE DUPLICATE: Eldon Machado (LID Identity Case)
-- =====================================================
-- Moves all data from the ghost LID contact to the real Eldon Machado.
-- Links the new LID as an alias to prevent future duplicates.

BEGIN;

DO $$ 
DECLARE
    keeper_id UUID := '50d3c381-d62c-494a-932b-f29801ca7736'; -- ELDON MACHADO (Real)
    ghost_id UUID  := 'ca980871-b70f-4491-b287-4fca6327fb2a'; -- 187144761036949 (Ghost)
    new_lid TEXT   := '107144761036949@lid';
    new_key TEXT   := '107144761036949';
    duplicate_record RECORD;
BEGIN
    RAISE NOTICE 'Merging ghost contact % into keeper %...', ghost_id, keeper_id;

    -- 1. Move Messages (via Conversations)
    -- As mensagens pertencem a conversas. Ao mover a conversa para o contato oficial, 
    -- as mensagens "vão junto". Mas se houver duas conversas, precisamos mover as mensagens da ghost para a keeper.
    
    DECLARE
        v_keeper_conv_id UUID;
        v_ghost_conv_id UUID;
    BEGIN
        -- Localiza a conversa oficial do Eldon (pode ser pelo chat_id real ou thread_key)
        SELECT id INTO v_keeper_conv_id FROM public.conversations WHERE contact_id = keeper_id ORDER BY created_at ASC LIMIT 1;
        
        -- Localiza a conversa fantasma
        SELECT id INTO v_ghost_conv_id FROM public.conversations WHERE contact_id = ghost_id ORDER BY created_at ASC LIMIT 1;

        IF v_ghost_conv_id IS NOT NULL THEN
            IF v_keeper_conv_id IS NOT NULL THEN
                -- Move as mensagens da conversa fantasma para a oficial
                UPDATE public.messages SET conversation_id = v_keeper_conv_id WHERE conversation_id = v_ghost_conv_id;
                
                -- Move os protocolos
                UPDATE public.protocols SET conversation_id = v_keeper_conv_id WHERE conversation_id = v_ghost_conv_id;

                -- Deleta a conversa fantasma
                DELETE FROM public.conversations WHERE id = v_ghost_conv_id;
            ELSE
                -- Se o keeper não tinha conversa, apenas vincula a conversa fantasma ao keeper (vira a conversa oficial)
                UPDATE public.conversations SET contact_id = keeper_id WHERE id = v_ghost_conv_id;
            END IF;
        END IF;
    END;

    -- 2. Move Protocolos e Participantes remanescentes (se houver órfãos)
    UPDATE public.protocols SET contact_id = keeper_id WHERE contact_id = ghost_id;
    UPDATE public.participants SET contact_id = keeper_id WHERE contact_id = ghost_id;

    -- 5. Add Aliases (Ensures future messages from this LID go to Eldon)
    INSERT INTO public.contact_aliases (alias_key, contact_id)
    VALUES 
        ('lid:' || new_lid, keeper_id),
        (new_key, keeper_id)
    ON CONFLICT (alias_key) DO UPDATE SET contact_id = EXCLUDED.contact_id;

    -- 6. Update keeper's LID if missing
    UPDATE public.contacts SET lid = new_lid WHERE id = keeper_id AND lid IS NULL;

    -- 7. DELETE GHOST
    DELETE FROM public.contacts WHERE id = ghost_id;

    RAISE NOTICE 'Merge complete.';
END $$;

COMMIT;
