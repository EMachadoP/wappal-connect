-- =====================================================
-- HARDEN IDENTITY RESOLUTION V5 (Fix Ambiguity)
-- =====================================================
-- Fixed "column reference 'chat_key' is ambiguous" error
-- by qualifying all database column references with 'c.'.

DROP FUNCTION IF EXISTS public.resolve_contact_identity(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.resolve_contact_identity(
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
  v_resolved_chat_key TEXT;

  v_digits_from_chat_id TEXT := regexp_replace(COALESCE(p_chat_id,''), '\D', '', 'g');
  v_digits_from_phone   TEXT := regexp_replace(COALESCE(p_phone,''),   '\D', '', 'g');

  v_candidates UUID[];
  v_variant1 TEXT;
  v_variant2 TEXT;

  v_name TEXT := NULLIF(BTRIM(COALESCE(p_name,'')), '');
  v_chat_lid TEXT := NULLIF(BTRIM(COALESCE(p_chat_lid,'')), '');
  v_lid TEXT := NULLIF(BTRIM(COALESCE(p_lid,'')), '');
BEGIN
  -- 0) Prefer exact LID matches (prioritize chat_lid as it's the specific ZAPI format)
  IF v_chat_lid IS NOT NULL THEN
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE c.chat_lid = v_chat_lid
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      SELECT c.chat_key INTO v_resolved_chat_key FROM public.contacts c WHERE c.id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_resolved_chat_key, v_resolved_chat_key, 'chat_lid'::text;
      RETURN;
    END IF;
  END IF;

  IF v_lid IS NOT NULL THEN
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE c.lid = v_lid
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      SELECT c.chat_key INTO v_resolved_chat_key FROM public.contacts c WHERE c.id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_resolved_chat_key, v_resolved_chat_key, 'lid'::text;
      RETURN;
    END IF;
  END IF;

  -- 1) Determine base chat_key from chat_id digits first, then phone digits
  v_resolved_chat_key := NULLIF(v_digits_from_chat_id, '');
  IF v_resolved_chat_key IS NULL THEN
    v_resolved_chat_key := NULLIF(v_digits_from_phone, '');
  END IF;

  -- Refuse too-short keys (prevents garbage contacts from partial/bad IDs)
  IF v_resolved_chat_key IS NOT NULL AND length(v_resolved_chat_key) < 10 THEN
    RETURN QUERY SELECT NULL::uuid, v_resolved_chat_key, v_resolved_chat_key, 'chat_key_too_short_refuse'::text;
    RETURN;
  END IF;

  -- 2) Try exact chat_key match
  IF v_resolved_chat_key IS NOT NULL THEN
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE c.chat_key = v_resolved_chat_key
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- update aliases and name if they provide better info
      UPDATE public.contacts c
      SET chat_lid = COALESCE(v_chat_lid, c.chat_lid),
          lid      = COALESCE(v_lid,      c.lid),
          name     = CASE WHEN c.name IS NULL OR c.name ~ '^\d+$' THEN COALESCE(v_name, c.name) ELSE c.name END,
          updated_at = now()
      WHERE c.id = v_existing_id;

      RETURN QUERY SELECT v_existing_id, v_resolved_chat_key, v_resolved_chat_key, 'chat_key_exact'::text;
      RETURN;
    END IF;

    -- 3) Brazil 12/13 digit safe variant match (only if result is UNIQUE)
    IF v_resolved_chat_key LIKE '55%' AND (length(v_resolved_chat_key)=12 OR length(v_resolved_chat_key)=13) THEN
      IF length(v_resolved_chat_key)=12 THEN
        v_variant1 := left(v_resolved_chat_key,4) || '9' || right(v_resolved_chat_key,8);  -- add 9
        v_variant2 := NULL;
      ELSE
        IF substr(v_resolved_chat_key,5,1)='9' THEN
          v_variant1 := left(v_resolved_chat_key,4) || right(v_resolved_chat_key,8);      -- remove 9
        ELSE
          v_variant1 := NULL;
        END IF;
        v_variant2 := NULL;
      END IF;

      -- Use DISTINCT and ANY with array filtering for maximum robustness
      SELECT ARRAY_AGG(DISTINCT c.id) INTO v_candidates
      FROM public.contacts c
      WHERE c.chat_key = ANY(
        ARRAY_REMOVE(ARRAY_REMOVE(ARRAY[v_resolved_chat_key, v_variant1, v_variant2]::text[], NULL), '')
      );

      IF array_length(v_candidates,1) = 1 THEN
        v_existing_id := v_candidates[1];
        SELECT c.chat_key INTO v_resolved_chat_key FROM public.contacts c WHERE c.id = v_existing_id;

        UPDATE public.contacts c
        SET chat_lid = COALESCE(v_chat_lid, c.chat_lid),
            lid      = COALESCE(v_lid,      c.lid),
            name     = CASE WHEN c.name IS NULL OR c.name ~ '^\d+$' THEN COALESCE(v_name, c.name) ELSE c.name END,
            updated_at = now()
        WHERE c.id = v_existing_id;

        RETURN QUERY SELECT v_existing_id, v_resolved_chat_key, v_resolved_chat_key, 'chat_key_variant_unique'::text;
        RETURN;
      ELSIF array_length(v_candidates,1) > 1 THEN
        -- Ambiguous: do NOT guess (prevents mixing contact histories)
        RETURN QUERY SELECT NULL::uuid, v_resolved_chat_key, v_resolved_chat_key, 'ambiguous_variant_refuse'::text;
        RETURN;
      END IF;
    END IF;

    -- 4) Create contact only when we have a stable chat_key (digits)
    INSERT INTO public.contacts (chat_key, chat_lid, lid, name, created_at, updated_at)
    VALUES (v_resolved_chat_key, v_chat_lid, v_lid, COALESCE(v_name, v_resolved_chat_key), now(), now())
    RETURNING id INTO v_existing_id;

    RETURN QUERY SELECT v_existing_id, v_resolved_chat_key, v_resolved_chat_key, 'created_by_chat_key'::text;
    RETURN;
  END IF;

  -- 5) No stable key available (refuse to create ghost contacts)
  RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text, 'no_stable_key_refuse'::text;
END;
$$;
