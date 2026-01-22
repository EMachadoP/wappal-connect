-- =====================================================
-- UNIQUE INDEX para conversations.thread_key
-- Necessário para UPSERT atômico funcionar corretamente
-- =====================================================

-- 1. Verifica e remove duplicados existentes ANTES de criar o índice
DO $$
DECLARE
    r RECORD;
    v_keep_id UUID;
    v_drop_id UUID;
BEGIN
    -- Loop por grupos duplicados de thread_key
    FOR r IN (
        SELECT thread_key 
        FROM public.conversations 
        WHERE thread_key IS NOT NULL AND thread_key <> '' 
        GROUP BY thread_key 
        HAVING COUNT(*) > 1
    ) LOOP
        -- Define a conversa principal (mais recente last_message_at)
        SELECT id INTO v_keep_id
        FROM public.conversations
        WHERE thread_key = r.thread_key
        ORDER BY last_message_at DESC NULLS LAST, created_at DESC
        LIMIT 1;

        -- Merge e remove duplicados
        FOR v_drop_id IN (
            SELECT id FROM public.conversations 
            WHERE thread_key = r.thread_key AND id != v_keep_id
        ) LOOP
            -- Mover mensagens
            UPDATE public.messages SET conversation_id = v_keep_id WHERE conversation_id = v_drop_id;
            
            -- Mover protocolos
            UPDATE public.protocols SET conversation_id = v_keep_id WHERE conversation_id = v_drop_id;
            
            -- Mover ai_events (se existir)
            UPDATE public.ai_events SET conversation_id = v_keep_id WHERE conversation_id = v_drop_id;
            
            -- Deletar conversa duplicada
            DELETE FROM public.conversations WHERE id = v_drop_id;
            
            RAISE NOTICE 'Merged conversation % into %', v_drop_id, v_keep_id;
        END LOOP;
    END LOOP;
END $$;

-- 2. Criar índice único para thread_key (mesma lógica do chat_key)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_thread_key_unique 
ON public.conversations (thread_key) 
WHERE (thread_key IS NOT NULL AND thread_key <> '' AND length(thread_key) >= 5);

-- 3. Index para participant_state para evitar duplicação visual
CREATE UNIQUE INDEX IF NOT EXISTS idx_cps_conv_participant_unique
ON public.conversation_participant_state (conversation_id, current_participant_id)
WHERE (conversation_id IS NOT NULL AND current_participant_id IS NOT NULL);
