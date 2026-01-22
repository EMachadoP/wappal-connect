-- =====================================================
-- CONTACT ALIASES & ATOMIC IDENTITY RESOLUTION RPC
-- =====================================================
-- This migration implements atomic contact resolution to
-- prevent duplicate contacts/conversations caused by
-- LID vs Phone identity oscillation from Z-API

-- 1. Create contact_aliases table
CREATE TABLE IF NOT EXISTS public.contact_aliases (
  alias_key TEXT PRIMARY KEY,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_aliases_contact_id_idx 
ON public.contact_aliases(contact_id);

-- Enable RLS
ALTER TABLE public.contact_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view contact_aliases"
ON public.contact_aliases FOR SELECT
USING (true);

CREATE POLICY "Service role can manage contact_aliases"
ON public.contact_aliases FOR ALL
USING (true);

-- 2. Ensure unique index on chat_key (partial, non-empty)
CREATE UNIQUE INDEX IF NOT EXISTS contacts_chat_key_uidx
ON public.contacts(chat_key)
WHERE chat_key IS NOT NULL AND chat_key <> '';

-- 3. Create resolve_contact_identity RPC
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

  -- Canonical chat_key: prefer phone (more stable), then lid, then chatId
  v_final_chat_key := COALESCE(v_phone_key, v_lid_key, v_chat_key_local);
  
  IF v_final_chat_key IS NULL OR v_final_chat_key = '' THEN
    RAISE EXCEPTION 'Missing identity (lid/phone/chat_id)';
  END IF;

  -- 1) Resolve by aliases (most reliable)
  SELECT ca.contact_id INTO v_existing_id
  FROM public.contact_aliases ca
  WHERE ca.alias_key IN (v_final_chat_key, v_lid_key, v_phone_key, v_chat_key_local)
  LIMIT 1;

  -- 2) Resolve by contacts.chat_key
  IF v_existing_id IS NULL THEN
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE c.chat_key IN (v_final_chat_key, v_lid_key, v_phone_key, v_chat_key_local)
    LIMIT 1;
  END IF;

  -- 3) Resolve by contacts.lid / chat_lid
  IF v_existing_id IS NULL AND v_lid_key IS NOT NULL THEN
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE LOWER(c.lid) = REPLACE(v_lid_key, 'lid:', '')
       OR LOWER(c.chat_lid) = REPLACE(v_lid_key, 'lid:', '')
    LIMIT 1;
  END IF;

  -- 4) Resolve by phone (digits) as last resort
  IF v_existing_id IS NULL AND v_phone_digits <> '' THEN
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') = v_phone_digits
    ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  -- Safe name with fallback
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
    UPDATE public.contacts
    SET 
      chat_key = COALESCE(v_final_chat_key, chat_key),
      lid = COALESCE(NULLIF(REPLACE(COALESCE(v_lid_key, ''), 'lid:', ''), ''), lid),
      phone = COALESCE(NULLIF(v_phone_digits, ''), phone),
      chat_lid = COALESCE(NULLIF(v_chat_lid, ''), chat_lid),
      name = CASE WHEN name IS NULL OR name ~ '^\d+$' THEN COALESCE(v_safe_name, name) ELSE name END,
      updated_at = now()
    WHERE id = v_existing_id;
  END IF;

  -- Write aliases (idempotent)
  INSERT INTO public.contact_aliases(alias_key, contact_id)
  SELECT x.key, v_existing_id
  FROM (VALUES (v_final_chat_key), (v_lid_key), (v_phone_key), (v_chat_key_local)) AS x(key)
  WHERE x.key IS NOT NULL AND x.key <> ''
  ON CONFLICT (alias_key) DO UPDATE SET contact_id = excluded.contact_id;

  -- Return result
  contact_id := v_existing_id;
  chat_key := v_final_chat_key;
  used_key := v_final_chat_key;
  RETURN NEXT;
END;
$$;

-- Grant permissions
REVOKE ALL ON FUNCTION public.resolve_contact_identity(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_contact_identity(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

-- 4. Backfill existing contacts into aliases
INSERT INTO public.contact_aliases (alias_key, contact_id)
SELECT 'phone:' || regexp_replace(phone, '\D', '', 'g'), id
FROM public.contacts
WHERE phone IS NOT NULL AND phone <> ''
ON CONFLICT (alias_key) DO NOTHING;

INSERT INTO public.contact_aliases (alias_key, contact_id)
SELECT 'lid:' || LOWER(lid), id
FROM public.contacts
WHERE lid IS NOT NULL AND lid <> ''
ON CONFLICT (alias_key) DO NOTHING;

INSERT INTO public.contact_aliases (alias_key, contact_id)
SELECT chat_key, id
FROM public.contacts
WHERE chat_key IS NOT NULL AND chat_key <> ''
ON CONFLICT (alias_key) DO NOTHING;
