-- =====================================================
-- SAFE CONTACT NORMALIZATION & DEEP MERGE (V10)
-- =====================================================

DO $$
DECLARE
    r RECORD;
    p RECORD;
    v_target_participant_id UUID;
BEGIN
    RAISE NOTICE 'Iniciando detecção e resolução de conflitos de chat_key...';

    -- 1) Resolver conflitos: Casos onde existe 'u:X' e 'X' simultaneamente
    FOR r IN (
        SELECT 
            c1.id as source_id, -- o com 'u:'
            c2.id as target_id, -- o limpo
            SUBSTRING(c1.chat_key FROM 3) as clean_key
        FROM public.contacts c1
        JOIN public.contacts c2 ON SUBSTRING(c1.chat_key FROM 3) = c2.chat_key
        WHERE c1.chat_key LIKE 'u:%'
    ) LOOP
        RAISE NOTICE 'Conflito encontrado para %: Mesclando % para %', r.clean_key, r.source_id, r.target_id;

        -- A) Mesclar PARTICIPANTES antes de deletar o contato
        -- Para cada participante do contato redundante
        FOR p IN (SELECT * FROM public.participants WHERE contact_id = r.source_id) LOOP
            -- Tenta achar participante equivalente no contato destino (mesmo condomínio/entidade)
            SELECT id INTO v_target_participant_id 
            FROM public.participants 
            WHERE contact_id = r.target_id 
              AND entity_id = p.entity_id 
            LIMIT 1;

            IF v_target_participant_id IS NOT NULL THEN
                -- Se já existe um participante pra esse condomínio no contato novo, migra as referências
                UPDATE public.protocols SET participant_id = v_target_participant_id WHERE participant_id = p.id;
                UPDATE public.tasks SET participant_id = v_target_participant_id WHERE participant_id = p.id;
                -- Deleta o participante redundante
                DELETE FROM public.participants WHERE id = p.id;
            ELSE
                -- Se não existe, simplesmente move o participante para o contato novo
                UPDATE public.participants SET contact_id = r.target_id WHERE id = p.id;
            END IF;
        END LOOP;

        -- B) Transferir referências diretas do contato
        UPDATE public.protocols SET contact_id = r.target_id WHERE contact_id = r.source_id;
        UPDATE public.conversations SET contact_id = r.target_id WHERE contact_id = r.source_id;
        UPDATE public.messages SET sender_id = r.target_id WHERE sender_id = r.source_id AND sender_type = 'contact';

        -- C) Deletar o contato duplicado com prefixo 'u:'
        DELETE FROM public.contacts WHERE id = r.source_id;
    END LOOP;

    -- 2) Normalizar chaves dos que sobraram (sem conflitos)
    UPDATE public.contacts
    SET chat_key = CASE 
        WHEN chat_key LIKE 'u:%' THEN SUBSTRING(chat_key FROM 3)
        WHEN chat_key LIKE 'g:%' THEN SUBSTRING(chat_key FROM 3)
        ELSE chat_key
      END
    WHERE chat_key LIKE 'u:%' OR chat_key LIKE 'g:%';

    -- 3) Limpeza extra de telefones
    UPDATE public.contacts SET phone = regexp_replace(phone, '\D', '', 'g') WHERE phone ~ '\D';

    RAISE NOTICE 'Normalização concluída.';
END $$;

-- 4) Upgrade RPC resolve_contact_identity_v6 (v7 logic)
-- 4) Upgrade RPC resolve_contact_identity_v6 (Refined Logic)
CREATE OR REPLACE FUNCTION public.resolve_contact_identity_v6(
  p_lid      TEXT,
  p_phone    TEXT,
  p_chat_lid TEXT,
  p_chat_id  TEXT,
  p_name     TEXT DEFAULT NULL
)
RETURNS TABLE(contact_id UUID, chat_key TEXT, out_chat_key TEXT, used_key TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing_id UUID;
  v_chat_key TEXT;
  v_digits_from_chat_id TEXT := regexp_replace(COALESCE(p_chat_id,''), '\D', '', 'g');
  v_digits_from_phone   TEXT := regexp_replace(COALESCE(p_phone,''),   '\D', '', 'g');
  v_chat_lid TEXT := NULLIF(BTRIM(COALESCE(p_chat_lid,'')), '');
  v_lid      TEXT := NULLIF(BTRIM(COALESCE(p_lid,'')), '');
  v_name     TEXT := NULLIF(BTRIM(COALESCE(p_name,'')), '');
BEGIN
  -- 1) Tentar match por LID/ChatLID (Alta Prioridade)
  IF v_chat_lid IS NOT NULL OR v_lid IS NOT NULL THEN
    SELECT id INTO v_existing_id 
    FROM public.contacts 
    WHERE chat_lid IN (v_chat_lid, v_lid) 
       OR lid IN (v_chat_lid, v_lid) 
    ORDER BY created_at ASC LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      SELECT c.chat_key INTO v_chat_key FROM public.contacts c WHERE c.id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'lid_match'::text;
      RETURN;
    END IF;
  END IF;

  -- 2) Tentar match por ChatId exato (@s.whatsapp.net ou @g.us)
  IF p_chat_id IS NOT NULL AND p_chat_id ~ '@' THEN
    SELECT id INTO v_existing_id 
    FROM public.contacts 
    WHERE chat_id = p_chat_id 
    ORDER BY created_at ASC LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      SELECT c.chat_key INTO v_chat_key FROM public.contacts c WHERE c.id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'chat_id_match'::text;
      RETURN;
    END IF;
  END IF;

  -- 3) Normalizar Key (Dígitos) e tentar match por chat_key ou phone
  v_chat_key := NULLIF(v_digits_from_chat_id, '');
  IF v_chat_key IS NULL THEN v_chat_key := NULLIF(v_digits_from_phone, ''); END IF;

  IF v_chat_key IS NOT NULL THEN
    -- Desempate: LID > Phone > Oldest
    SELECT id INTO v_existing_id
    FROM public.contacts
    WHERE chat_key = v_chat_key 
       OR regexp_replace(COALESCE(phone,''), '\D', '', 'g') = v_chat_key
       OR chat_key = 'u:' || v_chat_key -- fallback para chaves legadas ainda não normalizadas
    ORDER BY (lid IS NOT NULL) DESC, (phone IS NOT NULL) DESC, created_at ASC
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.contacts SET 
        chat_id = COALESCE(chat_id, p_chat_id),
        chat_lid = COALESCE(chat_lid, v_chat_lid),
        lid = COALESCE(lid, v_lid),
        phone = COALESCE(phone, v_chat_key),
        name = CASE WHEN name IS NULL OR name ~ '^\d+$' THEN COALESCE(v_name, name) ELSE name END,
        updated_at = now()
      WHERE id = v_existing_id;
      
      SELECT c.chat_key INTO v_chat_key FROM public.contacts c WHERE c.id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'chat_key_match'::text;
      RETURN;
    END IF;
    
    -- 4) Criar se não existir
    INSERT INTO public.contacts (chat_key, chat_id, chat_lid, lid, phone, name, created_at, updated_at)
    VALUES (v_chat_key, p_chat_id, v_chat_lid, v_lid, v_chat_key, COALESCE(v_name, v_chat_key), now(), now())
    RETURNING id INTO v_existing_id;
    RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'created'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text, 'refused_no_key'::text;
END;
$$;

-- 5) Prevenção de duplicidade por chat_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_chat_id_unique 
ON conversations (chat_id) 
WHERE chat_id IS NOT NULL;
