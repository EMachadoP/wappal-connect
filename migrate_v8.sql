-- =====================================================
-- SAFE CONTACT NORMALIZATION & CONFLICT RESOLUTION (V8)
-- =====================================================

DO $$
DECLARE
    r RECORD;
    v_target_id UUID;
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

        -- Transferir Mensagens
        UPDATE public.messages SET contact_id = r.target_id WHERE contact_id = r.source_id;
        
        -- Transferir Protocolos
        UPDATE public.protocols SET contact_id = r.target_id WHERE contact_id = r.source_id;
        
        -- Transferir Conversas (chat_id costuma ser o mesmo, mas contact_id pode variar)
        UPDATE public.conversations SET contact_id = r.target_id WHERE contact_id = r.source_id;

        -- Deletar o contato duplicado com prefixo 'u:'
        DELETE FROM public.contacts WHERE id = r.source_id;
    END LOOP;

    -- 2) Agora sim: Normalizar chaves dos que sobraram (não há mais conflitos)
    UPDATE public.contacts
    SET chat_key = CASE 
        WHEN chat_key LIKE 'u:%' THEN SUBSTRING(chat_key FROM 3)
        WHEN chat_key LIKE 'g:%' THEN SUBSTRING(chat_key FROM 3)
        ELSE chat_key
      END
    WHERE chat_key LIKE 'u:%' OR chat_key LIKE 'g:%';

    -- 3) Limpeza extra de telefones
    UPDATE public.contacts SET phone = regexp_replace(phone, '\D', '', 'g') WHERE phone ~ '\D';

    RAISE NOTICE 'Normalização concluída com sucesso.';
END $$;

-- 4) Upgrade RPC resolve_contact_identity_v6 (v7 logic)
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
  v_candidates UUID[];
  v_variant1 TEXT;
  v_name     TEXT := NULLIF(BTRIM(COALESCE(p_name,'')), '');
  v_chat_lid TEXT := NULLIF(BTRIM(COALESCE(p_chat_lid,'')), '');
  v_lid      TEXT := NULLIF(BTRIM(COALESCE(p_lid,'')), '');
BEGIN
  IF v_chat_lid IS NOT NULL THEN
    SELECT c.id INTO v_existing_id FROM public.contacts c WHERE c.chat_lid = v_chat_lid OR c.lid = v_chat_lid LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      SELECT c.chat_key INTO v_chat_key FROM public.contacts c WHERE c.id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'chat_lid_match'::text;
      RETURN;
    END IF;
  END IF;

  v_chat_key := NULLIF(v_digits_from_chat_id, '');
  IF v_chat_key IS NULL THEN v_chat_key := NULLIF(v_digits_from_phone, ''); END IF;

  IF v_chat_key IS NOT NULL AND length(v_chat_key) < 10 THEN
    RETURN QUERY SELECT NULL::uuid, v_chat_key, v_chat_key, 'refused_too_short'::text;
    RETURN;
  END IF;

  IF v_chat_key IS NOT NULL THEN
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE c.chat_key = v_chat_key 
       OR regexp_replace(COALESCE(c.phone,''), '\D', '', 'g') = v_chat_key
       OR c.chat_key = 'u:' || v_chat_key -- Sobra de compatibilidade
    ORDER BY c.updated_at DESC NULLS LAST
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.contacts c SET 
        chat_lid = COALESCE(v_chat_lid, c.chat_lid),
        lid      = COALESCE(v_lid,      c.lid),
        phone    = COALESCE(v_chat_key,  c.phone),
        name     = CASE WHEN c.name IS NULL OR c.name ~ '^\d+$' THEN COALESCE(v_name, c.name) ELSE c.name END,
        updated_at = now()
      WHERE c.id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'chat_key_or_phone_match'::text;
      RETURN;
    END IF;

    IF v_chat_key LIKE '55%' AND (length(v_chat_key)=12 OR length(v_chat_key)=13) THEN
      IF length(v_chat_key)=12 THEN v_variant1 := left(v_chat_key,4) || '9' || right(v_chat_key,8);
      ELSE IF substr(v_chat_key,5,1)='9' THEN v_variant1 := left(v_chat_key,4) || right(v_chat_key,8); END IF;
      END IF;

      SELECT ARRAY_AGG(DISTINCT c.id) INTO v_candidates
      FROM public.contacts c
      WHERE c.chat_key IN (v_chat_key, v_variant1)
         OR regexp_replace(COALESCE(c.phone,''), '\D', '', 'g') IN (v_chat_key, v_variant1);

      IF array_length(v_candidates,1) = 1 THEN
        v_existing_id := v_candidates[1];
        SELECT c.chat_key INTO v_chat_key FROM public.contacts c WHERE c.id = v_existing_id;
        UPDATE public.contacts c SET chat_lid = COALESCE(v_chat_lid, c.chat_lid), lid = COALESCE(v_lid, c.lid), updated_at = now() WHERE c.id = v_existing_id;
        RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'variant_match'::text;
        RETURN;
      END IF;
    END IF;

    INSERT INTO public.contacts (chat_key, chat_lid, lid, phone, name, created_at, updated_at)
    VALUES (v_chat_key, v_chat_lid, v_lid, v_chat_key, COALESCE(v_name, v_chat_key), now(), now())
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
