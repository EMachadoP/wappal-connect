-- ============================================================
-- FIX FINAL: resolve_contact_identity - Proteção contra 23505
-- ============================================================
-- Adiciona proteção para lid E chat_lid no UPDATE

DROP FUNCTION IF EXISTS public.resolve_contact_identity(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.resolve_contact_identity(
  p_lid TEXT,
  p_phone TEXT,
  p_chat_lid TEXT,
  p_chat_id TEXT,
  p_name TEXT DEFAULT NULL
)
RETURNS TABLE(contact_id UUID, out_chat_key TEXT, used_key TEXT)
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

  v_final_key TEXT;
  v_existing_id UUID;
  v_safe_name TEXT;

  v_owner_chat_lid UUID;
  v_owner_lid UUID;
  v_lid_value TEXT;
BEGIN
  -- monta chaves
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

  v_final_key := COALESCE(v_phone_key, v_lid_key, v_chat_key_local);

  IF v_final_key IS NULL OR v_final_key = '' THEN
    RAISE EXCEPTION 'Missing identity (lid/phone/chat_id)';
  END IF;

  -- Extrair valor limpo do lid (sem prefixo)
  v_lid_value := NULLIF(REPLACE(COALESCE(v_lid_key, ''), 'lid:', ''), '');

  -- 1) tenta resolver por aliases
  SELECT ca.contact_id
    INTO v_existing_id
  FROM public.contact_aliases ca
  WHERE ca.alias_key IN (v_final_key, v_lid_key, v_phone_key, v_chat_key_local)
  LIMIT 1;

  -- 2) tenta resolver por contacts.chat_key
  IF v_existing_id IS NULL THEN
    SELECT c.id
      INTO v_existing_id
    FROM public.contacts c
    WHERE c.chat_key IN (v_final_key, v_lid_key, v_phone_key, v_chat_key_local)
    LIMIT 1;
  END IF;

  -- 3) resolve por UNIQUE (chat_lid) para evitar 23505
  IF v_chat_lid <> '' THEN
    SELECT c.id INTO v_owner_chat_lid
    FROM public.contacts c
    WHERE c.chat_lid = v_chat_lid
    LIMIT 1;
  END IF;

  -- 4) resolve por UNIQUE (lid) para evitar 23505
  IF v_lid_value IS NOT NULL THEN
    SELECT c.id INTO v_owner_lid
    FROM public.contacts c
    WHERE c.lid = v_lid_value
    LIMIT 1;
  END IF;

  -- Se lid/chat_lid já pertencem a alguém, esse alguém vira o "vencedor"
  IF v_owner_chat_lid IS NOT NULL THEN
    v_existing_id := v_owner_chat_lid;
  ELSIF v_owner_lid IS NOT NULL THEN
    v_existing_id := v_owner_lid;
  END IF;

  -- nome seguro
  v_safe_name := NULLIF(TRIM(COALESCE(p_name, '')), '');
  IF v_safe_name IS NULL OR v_safe_name ~ '^\d+$' THEN
    v_safe_name := COALESCE(NULLIF(v_phone_digits,''), NULLIF(v_lid,''), 'Contato Desconhecido');
  END IF;

  -- cria/atualiza contato
  IF v_existing_id IS NULL THEN
    INSERT INTO public.contacts (id, chat_key, lid, phone, chat_lid, name, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      v_final_key,
      v_lid_value,
      NULLIF(v_phone_digits, ''),
      NULLIF(v_chat_lid, ''),
      v_safe_name,
      now(), now()
    )
    ON CONFLICT (chat_key) DO UPDATE SET
      -- ✅ Proteção para lid
      lid = CASE
        WHEN EXCLUDED.lid IS NULL THEN public.contacts.lid
        WHEN public.contacts.lid = EXCLUDED.lid THEN public.contacts.lid
        WHEN EXISTS (
          SELECT 1 FROM public.contacts c2
          WHERE c2.lid = EXCLUDED.lid AND c2.id <> public.contacts.id
        ) THEN public.contacts.lid  -- NÃO sobrescreve se já pertence a outro
        ELSE EXCLUDED.lid
      END,
      phone = COALESCE(EXCLUDED.phone, public.contacts.phone),
      -- ✅ Proteção para chat_lid
      chat_lid = CASE
        WHEN EXCLUDED.chat_lid IS NULL THEN public.contacts.chat_lid
        WHEN public.contacts.chat_lid = EXCLUDED.chat_lid THEN public.contacts.chat_lid
        WHEN EXISTS (
          SELECT 1 FROM public.contacts c2
          WHERE c2.chat_lid = EXCLUDED.chat_lid AND c2.id <> public.contacts.id
        ) THEN public.contacts.chat_lid
        ELSE EXCLUDED.chat_lid
      END,
      name = CASE
        WHEN public.contacts.name IS NULL OR public.contacts.name ~ '^\d+$'
        THEN EXCLUDED.name
        ELSE public.contacts.name
      END,
      updated_at = now()
    RETURNING public.contacts.id INTO v_existing_id;
  ELSE
    UPDATE public.contacts c SET
      chat_key = COALESCE(v_final_key, c.chat_key),
      -- ✅ Proteção para lid no UPDATE
      lid = CASE
        WHEN v_lid_value IS NULL THEN c.lid
        WHEN c.lid = v_lid_value THEN c.lid
        WHEN EXISTS (
          SELECT 1 FROM public.contacts c2
          WHERE c2.lid = v_lid_value AND c2.id <> c.id
        ) THEN c.lid  -- NÃO sobrescreve se já pertence a outro
        ELSE v_lid_value
      END,
      phone = COALESCE(NULLIF(v_phone_digits,''), c.phone),
      -- ✅ Proteção para chat_lid no UPDATE
      chat_lid = CASE
        WHEN NULLIF(v_chat_lid,'') IS NULL THEN c.chat_lid
        WHEN c.chat_lid = v_chat_lid THEN c.chat_lid
        WHEN EXISTS (
          SELECT 1 FROM public.contacts c2
          WHERE c2.chat_lid = v_chat_lid AND c2.id <> c.id
        ) THEN c.chat_lid  -- NÃO sobrescreve se já pertence a outro
        ELSE v_chat_lid
      END,
      name = CASE
        WHEN c.name IS NULL OR c.name ~ '^\d+$' THEN COALESCE(v_safe_name, c.name)
        ELSE c.name
      END,
      updated_at = now()
    WHERE c.id = v_existing_id;
  END IF;

  -- ✅ deduplica chaves antes do INSERT (evita 21000)
  WITH keys AS (
    SELECT DISTINCT unnest(ARRAY[
      v_final_key,
      v_lid_key,
      v_phone_key,
      v_chat_key_local
    ]) AS key
  )
  INSERT INTO public.contact_aliases(alias_key, contact_id)
  SELECT key, v_existing_id
  FROM keys
  WHERE key IS NOT NULL AND key <> ''
  ON CONFLICT (alias_key) DO UPDATE
    SET contact_id = EXCLUDED.contact_id;

  contact_id := v_existing_id;
  out_chat_key := v_final_key;
  used_key := v_final_key;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_contact_identity(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_contact_identity(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
