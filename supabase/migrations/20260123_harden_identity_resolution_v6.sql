-- =====================================================
-- RPC V6 - HARDEN IDENTITY RESOLUTION (Safe + Compatible)
-- =====================================================
-- Cria nova função para evitar "cannot change return type"
-- Retorno: (contact_id, chat_key, out_chat_key, used_key)
-- Regras:
-- 1) Prioriza chat_lid/lid (quando existe)
-- 2) Depois usa chat_key por dígitos (chat_id > phone)
-- 3) BR 12/13: só aceita se resultar em 1 único contato
-- 4) Se ambíguo: recusa (não mistura históricos)
-- 5) Se não existir, cria contato por chat_key (se for estável)

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
  v_variant2 TEXT;

  v_name     TEXT := NULLIF(BTRIM(COALESCE(p_name,'')), '');
  v_chat_lid TEXT := NULLIF(BTRIM(COALESCE(p_chat_lid,'')), '');
  v_lid      TEXT := NULLIF(BTRIM(COALESCE(p_lid,'')), '');
BEGIN
  -- 0) Prefer exact LID matches (never ambiguous)
  IF v_chat_lid IS NOT NULL THEN
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE c.chat_lid = v_chat_lid
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      SELECT c.chat_key INTO v_chat_key FROM public.contacts c WHERE c.id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'chat_lid'::text;
      RETURN;
    END IF;
  END IF;

  IF v_lid IS NOT NULL THEN
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE c.lid = v_lid
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      SELECT c.chat_key INTO v_chat_key FROM public.contacts c WHERE c.id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'lid'::text;
      RETURN;
    END IF;
  END IF;

  -- 1) Determine base chat_key from chat_id digits first, then phone digits
  v_chat_key := NULLIF(v_digits_from_chat_id, '');
  IF v_chat_key IS NULL THEN
    v_chat_key := NULLIF(v_digits_from_phone, '');
  END IF;

  -- Refuse too-short (avoid garbage)
  IF v_chat_key IS NOT NULL AND length(v_chat_key) < 10 THEN
    RETURN QUERY SELECT NULL::uuid, v_chat_key, v_chat_key, 'chat_key_too_short_refuse'::text;
    RETURN;
  END IF;

  IF v_chat_key IS NOT NULL THEN
    -- 2) Exact chat_key match
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE c.chat_key = v_chat_key
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- ✅ FIX: Use 'c.' to avoid ambiguity
      UPDATE public.contacts c
      SET chat_lid = COALESCE(v_chat_lid, c.chat_lid),
          lid      = COALESCE(v_lid,      c.lid),
          name     = CASE WHEN c.name IS NULL OR c.name ~ '^\d+$' THEN COALESCE(v_name, c.name) ELSE c.name END,
          updated_at = now()
      WHERE c.id = v_existing_id;

      RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'chat_key_exact'::text;
      RETURN;
    END IF;

    -- 3) BR 12/13 variant match (ONLY if unique)
    IF v_chat_key LIKE '55%' AND (length(v_chat_key)=12 OR length(v_chat_key)=13) THEN
      IF length(v_chat_key)=12 THEN
        v_variant1 := left(v_chat_key,4) || '9' || right(v_chat_key,8);  -- add 9
      ELSE
        IF substr(v_chat_key,5,1)='9' THEN
          v_variant1 := left(v_chat_key,4) || right(v_chat_key,8);       -- remove 9
        END IF;
      END IF;

      SELECT ARRAY_AGG(DISTINCT c.id) INTO v_candidates
      FROM public.contacts c
      WHERE c.chat_key = ANY(
        ARRAY_REMOVE(ARRAY_REMOVE(ARRAY[v_chat_key, v_variant1, v_variant2]::text[], NULL), '')
      );

      IF array_length(v_candidates,1) = 1 THEN
        v_existing_id := v_candidates[1];
        SELECT c.chat_key INTO v_chat_key FROM public.contacts c WHERE c.id = v_existing_id;

        UPDATE public.contacts c
        SET chat_lid = COALESCE(v_chat_lid, c.chat_lid),
            lid      = COALESCE(v_lid,      c.lid),
            name     = CASE WHEN c.name IS NULL OR c.name ~ '^\d+$' THEN COALESCE(v_name, c.name) ELSE c.name END,
            updated_at = now()
        WHERE c.id = v_existing_id;

        RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'chat_key_variant_unique'::text;
        RETURN;
      ELSIF array_length(v_candidates,1) > 1 THEN
        RETURN QUERY SELECT NULL::uuid, v_chat_key, v_chat_key, 'ambiguous_variant_refuse'::text;
        RETURN;
      END IF;
    END IF;

    -- 4) Create contact (stable chat_key)
    INSERT INTO public.contacts (chat_key, chat_lid, lid, name, created_at, updated_at)
    VALUES (v_chat_key, v_chat_lid, v_lid, COALESCE(v_name, v_chat_key), now(), now())
    RETURNING id INTO v_existing_id;

    RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'created_by_chat_key'::text;
    RETURN;
  END IF;

  -- 5) Refuse to create ghost
  RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text, 'no_stable_key_refuse'::text;
END;
$$;
