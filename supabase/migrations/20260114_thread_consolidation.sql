-- =====================================================
-- 1. ESTRUTURA PARA AUDITORIA DE MERGE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.contact_merge_map (
  dropped_contact_id uuid PRIMARY KEY,
  kept_contact_id uuid NOT NULL REFERENCES public.contacts(id),
  merged_at timestamptz NOT NULL DEFAULT now(),
  chat_key text
);

-- =====================================================
-- 2. NORMALIZAÇÃO ROBUSTA (BR-FRIENDLY)
-- =====================================================
CREATE OR REPLACE FUNCTION public.normalize_chat_key(chat_id text) 
RETURNS text AS $$
DECLARE
  clean_id text;
  numeric_id text;
BEGIN
  IF chat_id IS NULL THEN RETURN NULL; END IF;
  
  -- Para grupos, mantemos o ID original como chave canônica
  IF chat_id LIKE '%@g.us' THEN
    RETURN lower(chat_id);
  END IF;
  
  -- Extrair apenas dígitos do que vem antes do @
  numeric_id := regexp_replace(split_part(chat_id, '@', 1), '[^0-9]', '', 'g');
  
  IF numeric_id = '' THEN RETURN NULL; END IF;

  -- Lógica BR: 
  -- Se tem 10 ou 11 dígitos (DDD + Número), prefixa com 55
  IF length(numeric_id) IN (10, 11) THEN
    RETURN '55' || numeric_id;
  END IF;

  -- Se tem 12 ou 13 dígitos e começa com 55, mantém
  IF (length(numeric_id) IN (12, 13)) AND numeric_id LIKE '55%' THEN
    RETURN numeric_id;
  END IF;

  -- Caso contrário, retorna os dígitos puros
  RETURN numeric_id;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- 3. SCHEMA HARDENING
-- =====================================================

-- Adiciona chat_key se não existir
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS chat_key text;

-- Índice único para pessoas (Impede duplicidade futura)
-- Aplicamos apenas para IDs com comprimento de número de telefone comum para evitar conflitos em IDs curtos estranhos
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_chat_key_unique 
ON public.contacts (chat_key) 
WHERE (chat_key IS NOT NULL AND chat_key <> '' AND length(chat_key) >= 10);

-- Idempotência de mensagens (Impede replays do webhook)
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_provider_id_unique
ON public.messages (provider_message_id)
WHERE provider_message_id IS NOT NULL;

-- =====================================================
-- 4. BACKFILL & LIMPEZA AUTOMÁTICA (FAXINA GLOBAL)
-- =====================================================
DO $$
DECLARE
    r RECORD;
    v_keep_id UUID;
    v_drop_id UUID;
    v_keep_conv UUID;
    v_drop_conv UUID;
BEGIN
    -- Primeiro, garante que todos os chat_key estão populados com a nova lógica
    -- PRIORIDADE: Phone > Lid > Chat_Lid > Name
    UPDATE public.contacts 
    SET chat_key = normalize_chat_key(COALESCE(phone, lid, chat_lid, name))
    WHERE chat_key IS NULL OR chat_key = '';

    -- Loop por grupos duplicados
    FOR r IN (
        SELECT chat_key 
        FROM public.contacts 
        WHERE chat_key IS NOT NULL AND chat_key <> '' 
        GROUP BY chat_key 
        HAVING COUNT(*) > 1
    ) LOOP
        -- Define o cadastro principal (Prioridade: LID > Telefone > Antiguidade)
        SELECT id INTO v_keep_id
        FROM public.contacts
        WHERE chat_key = r.chat_key
        ORDER BY (chat_lid LIKE '%@lid') DESC, (phone IS NOT NULL) DESC, created_at ASC
        LIMIT 1;

        -- Mescla todos os outros contatos vinculados a esta chave
        FOR v_drop_id IN (
            SELECT id FROM public.contacts 
            WHERE chat_key = r.chat_key AND id != v_keep_id
        ) LOOP
            -- Registra o merge para auditoria
            INSERT INTO public.contact_merge_map (dropped_contact_id, kept_contact_id, chat_key)
            VALUES (v_drop_id, v_keep_id, r.chat_key)
            ON CONFLICT (dropped_contact_id) DO NOTHING;

            -- 1. Move Protocolos
            UPDATE public.protocols SET contact_id = v_keep_id WHERE contact_id = v_drop_id;
            
            -- 2. Move Participantes
            UPDATE public.participants SET contact_id = v_keep_id WHERE contact_id = v_drop_id;

            -- 3. Move Condomínios (Lida com duplicatas)
            BEGIN
                UPDATE public.contact_condominiums SET contact_id = v_keep_id WHERE contact_id = v_drop_id;
            EXCEPTION WHEN unique_violation THEN
                DELETE FROM public.contact_condominiums WHERE contact_id = v_drop_id;
            END;

            -- 4. Unifica Conversas
            SELECT id INTO v_keep_conv FROM public.conversations WHERE contact_id = v_keep_id LIMIT 1;
            SELECT id INTO v_drop_conv FROM public.conversations WHERE contact_id = v_drop_id LIMIT 1;

            IF v_drop_conv IS NOT NULL THEN
                IF v_keep_conv IS NULL THEN
                    UPDATE public.conversations SET contact_id = v_keep_id WHERE id = v_drop_conv;
                    v_keep_conv := v_drop_conv;
                ELSE
                    UPDATE public.messages SET conversation_id = v_keep_conv WHERE conversation_id = v_drop_conv;
                    UPDATE public.protocols SET conversation_id = v_keep_conv WHERE conversation_id = v_drop_conv;
                    UPDATE public.ai_events SET conversation_id = v_keep_conv WHERE conversation_id = v_drop_conv;
                    DELETE FROM public.conversations WHERE id = v_drop_conv;
                END IF;
            END IF;

            -- 5. Atualiza dados no contato que ficou
            UPDATE public.contacts c_keep
            SET 
                phone = COALESCE(c_keep.phone, c_drop.phone),
                name = CASE WHEN (c_keep.name ~ '^[0-9]+$') AND NOT (c_drop.name ~ '^[0-9]+$') THEN c_drop.name ELSE c_keep.name END
            FROM public.contacts c_drop
            WHERE c_keep.id = v_keep_id AND c_drop.id = v_drop_id;

            -- 6. Remove o rastro
            DELETE FROM public.contacts WHERE id = v_drop_id;
        END LOOP;

        -- 7. Recalcula ponteiros da conversa vencedora
        IF v_keep_conv IS NOT NULL THEN
            UPDATE public.conversations c
            SET 
                last_message_at = (SELECT MAX(sent_at) FROM public.messages WHERE conversation_id = c.id),
                unread_count = (SELECT COUNT(*) FROM public.messages WHERE conversation_id = c.id AND sender_type = 'contact' AND read_at IS NULL),
                thread_key = r.chat_key
            WHERE id = v_keep_conv;
        END IF;

    END LOOP;
END $$;

-- =====================================================
-- 5. CONSISTÊNCIA DE MENSAGENS (BACKLOG)
-- =====================================================
-- Vincula mensagens de saída que ficaram sem chat_id
UPDATE public.messages m
SET chat_id = c.chat_id
FROM public.conversations c
WHERE m.conversation_id = c.id
  AND (m.chat_id IS NULL OR m.chat_id = '')
  AND c.chat_id IS NOT NULL;

-- Vincula mensagens inbound que ficaram sem contact_id (Caso A do log)
-- Isso garante que mensagens "fantasmas" apareçam no Inbox
UPDATE public.messages m
SET contact_id = c.contact_id
FROM public.conversations c
WHERE m.conversation_id = c.id
  AND m.direction = 'inbound'
  AND m.contact_id IS NULL;
