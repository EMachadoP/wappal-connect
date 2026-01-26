-- =====================================================
-- V13 - FIX resolve_contact_identity_v6 (LID + dirty chat_id guardrails)
-- =====================================================

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

  v_name     TEXT := NULLIF(BTRIM(COALESCE(p_name,'')), '');
  v_chat_lid TEXT := NULLIF(BTRIM(COALESCE(p_chat_lid,'')), '');
  v_lid      TEXT := NULLIF(BTRIM(COALESCE(p_lid,'')), '');

  v_chat_id TEXT := NULLIF(BTRIM(COALESCE(p_chat_id,'')), '');
  v_is_lid_chat BOOLEAN := (v_chat_id IS NOT NULL AND v_chat_id LIKE '%@lid');

  -- JID base (antes do @)
  v_jid_base TEXT := split_part(COALESCE(v_chat_id,''), '@', 1);

  -- ⚠️ IMPORTANTE:
  -- - chat_id pode conter lixo numérico (ex: 5581...-1496...) -> pegamos só dígitos iniciais
  v_digits_from_chat_id TEXT := COALESCE(substring(v_jid_base from '^\d+'), '');
  v_digits_from_phone   TEXT := regexp_replace(COALESCE(p_phone,''), '\D', '', 'g');
BEGIN
  -- ===================================================
  -- 0) Match direto por chat_lid / lid (prioridade máxima)
  -- ===================================================
  IF v_chat_lid IS NOT NULL THEN
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE c.chat_lid = v_chat_lid
    ORDER BY c.created_at ASC
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      SELECT c.chat_key INTO v_chat_key FROM public.contacts c WHERE c.id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'chat_lid_match'::text;
      RETURN;
    END IF;
  END IF;

  IF v_lid IS NOT NULL THEN
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE c.lid = v_lid
    ORDER BY c.created_at ASC
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      SELECT c.chat_key INTO v_chat_key FROM public.contacts c WHERE c.id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'lid_match'::text;
      RETURN;
    END IF;
  END IF;

  -- ===================================================
  -- 1) Guard LID: quando chat é @lid, p_phone pode ser "número-LID" (não é telefone)
  -- ===================================================
  IF v_is_lid_chat THEN
    -- Não permita usar phone para derivar chat_key nesse cenário
    v_digits_from_phone := NULL;
    -- v_digits_from_chat_id aqui vira a base do LID (15 dígitos) e pode ser usado como chat_key interno,
    -- MAS não deve ser promovido a "phone" real.
  END IF;

  -- ===================================================
  -- 2) Define base chat_key (PHONE real primeiro; depois chat_id digits)
  -- ===================================================
  v_chat_key := NULLIF(v_digits_from_phone, '');
  IF v_chat_key IS NULL THEN
    v_chat_key := NULLIF(v_digits_from_chat_id, '');
  END IF;

  -- Guardrails de tamanho (bloqueia 22 dígitos etc.)
  IF v_chat_key IS NOT NULL AND (length(v_chat_key) < 10 OR length(v_chat_key) > 15) THEN
    RETURN QUERY SELECT NULL::uuid, v_chat_key, v_chat_key, 'chat_key_invalid_length_refuse'::text;
    RETURN;
  END IF;

  -- ===================================================
  -- 3) Tenta match por chat_key (e/ou phone normalizado)
  -- ===================================================
  IF v_chat_key IS NOT NULL THEN
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE c.chat_key = v_chat_key
       OR regexp_replace(COALESCE(c.phone,''), '\D', '', 'g') = v_chat_key
    ORDER BY (c.lid IS NOT NULL) DESC, (c.phone IS NOT NULL) DESC, c.created_at ASC
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- Atualiza metadados sem "inventar telefone" quando é @lid
      UPDATE public.contacts c
      SET
        chat_lid = COALESCE(v_chat_lid, c.chat_lid),
        lid      = COALESCE(v_lid,      c.lid),
        -- só seta phone se NÃO for chat @lid e se vier um phone plausível
        phone = CASE
          WHEN v_is_lid_chat THEN c.phone
          WHEN c.phone IS NOT NULL THEN c.phone
          WHEN v_digits_from_phone IS NOT NULL AND v_digits_from_phone <> '' THEN v_digits_from_phone
          ELSE c.phone
        END,
        name = CASE
          WHEN c.name IS NULL OR c.name ~ '^\d+$' THEN COALESCE(v_name, c.name)
          ELSE c.name
        END,
        updated_at = now()
      WHERE c.id = v_existing_id;

      SELECT c.chat_key INTO v_chat_key FROM public.contacts c WHERE c.id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'chat_key_match'::text;
      RETURN;
    END IF;

    -- ===================================================
    -- 4) Cria contato novo (garante não perder mensagem)
    -- ===================================================
    INSERT INTO public.contacts (chat_key, phone, lid, chat_lid, name, created_at, updated_at)
    VALUES (
      v_chat_key,
      CASE
        WHEN v_is_lid_chat THEN NULL                 -- ✅ não gravar phone fake de LID
        WHEN v_digits_from_phone IS NOT NULL AND v_digits_from_phone <> '' THEN v_digits_from_phone
        ELSE NULL
      END,
      v_lid,
      v_chat_lid,
      COALESCE(v_name, v_chat_key),
      now(),
      now()
    )
    RETURNING id INTO v_existing_id;

    RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, CASE WHEN v_is_lid_chat THEN 'created_lid' ELSE 'created' END;
    RETURN;
  END IF;

  RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text, 'refused_no_key'::text;
END;
$$;

-- Atualiza cache do PostgREST
NOTIFY pgrst, 'reload schema';
