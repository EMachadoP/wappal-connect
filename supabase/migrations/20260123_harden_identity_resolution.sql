-- =====================================================
-- HARDEN IDENTITY RESOLUTION (12/13 digits safe variation)
-- =====================================================
-- This migration updates resolve_contact_identity to safely 
-- handle Brazilian phone variations (missing 9) without
-- mixing contacts unless a unique match is found.

CREATE OR REPLACE FUNCTION public.resolve_contact_identity(
  p_lid TEXT,
  p_phone TEXT,
  p_chat_lid TEXT,
  p_chat_id TEXT,
  p_name TEXT DEFAULT NULL
)
RETURNS TABLE(contact_id UUID, chat_key TEXT, used_key TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lid TEXT := LOWER(TRIM(COALESCE(p_lid, '')));
  v_chat_lid TEXT := LOWER(TRIM(COALESCE(p_chat_lid, '')));
  v_chat_id TEXT := LOWER(TRIM(COALESCE(p_chat_id, '')));
  v_phone_raw TEXT := LOWER(TRIM(COALESCE(p_phone, '')));
  v_phone_digits TEXT := regexp_replace(v_phone_raw, '\D', '', 'g');

  v_lid_key TEXT;
  v_phone_key TEXT;
  v_chat_key_local TEXT;
  v_final_chat_key TEXT;

  v_existing_id UUID;
  v_safe_name TEXT;
  v_candidates UUID[];
BEGIN
  -- Build canonical keys
  IF v_lid <> '' AND (RIGHT(v_lid, 4) = '@lid' OR LENGTH(v_lid) >= 14) THEN
    v_lid_key := 'lid:' || v_lid;
  ELSIF v_chat_lid <> '' AND (RIGHT(v_chat_lid, 4) = '@lid' OR LENGTH(v_chat_lid) >= 14) THEN
    v_lid_key := 'lid:' || v_chat_lid;
  END IF;

  IF v_phone_digits <> '' AND LENGTH(v_phone_digits) >= 10 THEN
    v_phone_key := 'phone:' || v_phone_digits;
  END IF;

  IF v_chat_id <> '' THEN
    v_chat_key_local := 'chat:' || v_chat_id;
  END IF;

  v_final_chat_key := COALESCE(v_phone_key, v_lid_key, v_chat_key_local);
  
  -- 1) Try exact match in aliases or contacts.chat_key
  SELECT ca.contact_id INTO v_existing_id
  FROM public.contact_aliases ca
  WHERE ca.alias_key IN (v_final_chat_key, v_lid_key, v_phone_key, v_chat_key_local)
  LIMIT 1;

  IF v_existing_id IS NULL THEN
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE c.chat_key IN (v_final_chat_key, v_lid_key, v_phone_key, v_chat_key_local)
    LIMIT 1;
  END IF;

  -- 2) Try LID direct match
  IF v_existing_id IS NULL AND v_lid_key IS NOT NULL THEN
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE LOWER(c.lid) = REPLACE(v_lid_key, 'lid:', '')
       OR LOWER(c.chat_lid) = REPLACE(v_lid_key, 'lid:', '')
    LIMIT 1;
  END IF;

  -- 3) Try safe variation match for Brazil (12/13 digits)
  IF v_existing_id IS NULL AND v_phone_digits LIKE '55%' AND (LENGTH(v_phone_digits) = 12 OR LENGTH(v_phone_digits) = 13) THEN
    SELECT ARRAY_AGG(DISTINCT id) INTO v_candidates
    FROM (
      -- Match exact digits
      SELECT id FROM public.contacts WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = v_phone_digits
      UNION
      -- Match variant (12 -> 13)
      SELECT id FROM public.contacts 
      WHERE (LENGTH(v_phone_digits) = 12 AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = (left(v_phone_digits, 4) || '9' || right(v_phone_digits, 8)))
      UNION
      -- Match variant (13 -> 12)
      SELECT id FROM public.contacts 
      WHERE (LENGTH(v_phone_digits) = 13 AND substr(v_phone_digits, 5, 1) = '9' AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = (left(v_phone_digits, 4) || right(v_phone_digits, 8)))
    ) tmp;

    -- ONLY accept if there is exactly ONE unique contact candidate
    IF array_length(v_candidates, 1) = 1 THEN
      v_existing_id := v_candidates[1];
    ELSIF array_length(v_candidates, 1) > 1 THEN
      -- Log non-fatal warning but don't pick any
      RAISE WARNING 'Ambiguity detected for phone %: multiple candidates %', v_phone_digits, v_candidates;
    END IF;
  END IF;

  -- Fallback: standard phone match if not Brazil or variation fail
  IF v_existing_id IS NULL AND v_phone_digits <> '' THEN
     SELECT c.id INTO v_existing_id
     FROM public.contacts c
     WHERE regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') = v_phone_digits
     ORDER BY c.updated_at DESC NULLS LAST
     LIMIT 1;
  END IF;

  -- Safe name
  v_safe_name := NULLIF(TRIM(COALESCE(p_name, '')), '');
  IF v_safe_name IS NULL OR v_safe_name ~ '^\d+$' THEN
    v_safe_name := COALESCE(v_phone_digits, v_lid, 'Contato Desconhecido');
  END IF;

  -- UPSERT / UPDATE
  IF v_existing_id IS NULL THEN
    INSERT INTO public.contacts (id, chat_key, lid, phone, chat_lid, name, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      v_final_chat_key,
      NULLIF(REPLACE(COALESCE(v_lid_key, ''), 'lid:', ''), ''),
      NULLIF(v_phone_digits, ''),
      NULLIF(v_chat_lid, ''),
      v_safe_name,
      now(), now()
    )
    ON CONFLICT (chat_key) WHERE chat_key IS NOT NULL AND chat_key <> ''
    DO UPDATE SET
      lid = COALESCE(NULLIF(REPLACE(COALESCE(v_lid_key, ''), 'lid:', ''), ''), public.contacts.lid),
      phone = COALESCE(NULLIF(v_phone_digits, ''), public.contacts.phone),
      chat_lid = COALESCE(NULLIF(v_chat_lid, ''), public.contacts.chat_lid),
      name = CASE WHEN public.contacts.name IS NULL OR public.contacts.name ~ '^\d+$' THEN v_safe_name ELSE public.contacts.name END,
      updated_at = now()
    RETURNING id INTO v_existing_id;
  ELSE
    UPDATE public.contacts c
    SET 
      chat_key = COALESCE(v_final_chat_key, c.chat_key),
      lid = COALESCE(NULLIF(REPLACE(COALESCE(v_lid_key, ''), 'lid:', ''), ''), c.lid),
      phone = COALESCE(NULLIF(v_phone_digits, ''), c.phone),
      chat_lid = COALESCE(NULLIF(v_chat_lid, ''), c.chat_lid),
      name = CASE WHEN c.name IS NULL OR c.name ~ '^\d+$' THEN COALESCE(v_safe_name, c.name) ELSE c.name END,
      updated_at = now()
    WHERE c.id = v_existing_id;
  END IF;

  INSERT INTO public.contact_aliases(alias_key, contact_id)
  SELECT x.key, v_existing_id
  FROM (VALUES (v_final_chat_key), (v_lid_key), (v_phone_key), (v_chat_key_local)) AS x(key)
  WHERE x.key IS NOT NULL AND x.key <> ''
  ON CONFLICT (alias_key) DO UPDATE SET contact_id = excluded.contact_id;

  contact_id := v_existing_id;
  chat_key := v_final_chat_key;
  used_key := v_final_chat_key;
  RETURN NEXT;
END;
$$;
