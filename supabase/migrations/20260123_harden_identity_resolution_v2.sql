-- =====================================================
-- HARDEN IDENTITY RESOLUTION V2 (Robust & Safe)
-- =====================================================
-- Refined by User feedback to prioritize chat_key and aliases 
-- over the phone field, ensuring strict determination.

CREATE OR REPLACE FUNCTION public.resolve_contact_identity(
  p_lid      TEXT,
  p_phone    TEXT,
  p_chat_lid TEXT,
  p_chat_id  TEXT,
  p_name     TEXT DEFAULT NULL
)
RETURNS TABLE(contact_id UUID, chat_key TEXT, used_key TEXT)
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

  v_name TEXT := NULLIF(BTRIM(COALESCE(p_name,'')), '');
BEGIN
  -- 0) Prefer exact LID matches (aliases) - never ambiguous
  IF p_chat_lid IS NOT NULL AND p_chat_lid <> '' THEN
    SELECT id INTO v_existing_id
    FROM public.contacts
    WHERE chat_lid = p_chat_lid
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      SELECT chat_key INTO v_chat_key FROM public.contacts WHERE id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_chat_key, 'chat_lid';
      RETURN;
    END IF;
  END IF;

  IF p_lid IS NOT NULL AND p_lid <> '' THEN
    SELECT id INTO v_existing_id
    FROM public.contacts
    WHERE lid = p_lid
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      SELECT chat_key INTO v_chat_key FROM public.contacts WHERE id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_chat_key, 'lid';
      RETURN;
    END IF;
  END IF;

  -- 1) Determine base chat_key from chat_id digits first, then phone digits
  v_chat_key := NULLIF(v_digits_from_chat_id, '');
  IF v_chat_key IS NULL THEN
    v_chat_key := NULLIF(v_digits_from_phone, '');
  END IF;

  -- 2) Try exact chat_key match
  IF v_chat_key IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.contacts
    WHERE chat_key = v_chat_key
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- update aliases if present (safe)
      UPDATE public.contacts
      SET chat_lid = COALESCE(NULLIF(p_chat_lid,''), chat_lid),
          lid      = COALESCE(NULLIF(p_lid,''),      lid),
          name     = COALESCE(v_name, name)
      WHERE id = v_existing_id;

      RETURN QUERY SELECT v_existing_id, v_chat_key, 'chat_key_exact';
      RETURN;
    END IF;

    -- 3) Brazil 12/13 digit safe variant match (only if UNIQUE)
    IF v_chat_key LIKE '55%' AND (length(v_chat_key)=12 OR length(v_chat_key)=13) THEN
      IF length(v_chat_key)=12 THEN
        v_variant1 := left(v_chat_key,4) || '9' || right(v_chat_key,8);  -- add 9
        v_variant2 := NULL;
      ELSE
        IF substr(v_chat_key,5,1)='9' THEN
          v_variant1 := left(v_chat_key,4) || right(v_chat_key,8);      -- remove 9
        ELSE
          v_variant1 := NULL;
        END IF;
        v_variant2 := NULL;
      END IF;

      SELECT ARRAY_AGG(id) INTO v_candidates
      FROM public.contacts
      WHERE chat_key IN (v_chat_key, v_variant1, v_variant2);

      IF array_length(v_candidates,1) = 1 THEN
        v_existing_id := v_candidates[1];
        SELECT chat_key INTO v_chat_key FROM public.contacts WHERE id = v_existing_id;

        UPDATE public.contacts
        SET chat_lid = COALESCE(NULLIF(p_chat_lid,''), chat_lid),
            lid      = COALESCE(NULLIF(p_lid,''),      lid),
            name     = COALESCE(v_name, name)
        WHERE id = v_existing_id;

        RETURN QUERY SELECT v_existing_id, v_chat_key, 'chat_key_variant_unique';
        RETURN;
      ELSIF array_length(v_candidates,1) > 1 THEN
        -- Ambiguous: do NOT guess (prevents mixing)
        RETURN QUERY SELECT NULL::uuid, v_chat_key, 'ambiguous_variant_refuse';
        RETURN;
      END IF;
    END IF;

    -- 4) Create contact only when we have a stable chat_key (digits)
    INSERT INTO public.contacts (chat_key, chat_lid, lid, name)
    VALUES (v_chat_key, NULLIF(p_chat_lid,''), NULLIF(p_lid,''), v_name)
    RETURNING id INTO v_existing_id;

    RETURN QUERY SELECT v_existing_id, v_chat_key, 'created_by_chat_key';
    RETURN;
  END IF;

  -- 5) No stable key available (e.g., only LID with no mapping): refuse to create
  RETURN QUERY SELECT NULL::uuid, NULL::text, 'no_stable_key_refuse';
END;
$$;
