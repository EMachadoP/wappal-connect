BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_chat_id(chat_id text)
RETURNS text AS $$
DECLARE
  v text;
  left_part text;
  digits text;
BEGIN
  IF chat_id IS NULL OR btrim(chat_id) = '' THEN
    RETURN NULL;
  END IF;

  v := lower(btrim(chat_id));
  v := replace(v, '@gus', '@g.us');

  -- ✅ PRESERVA @lid
  IF v LIKE '%@lid' THEN
    RETURN v;
  END IF;

  left_part := split_part(v, '@', 1);

  -- Grupo: @g.us ou hífen
  IF v LIKE '%@g.us' OR position('-' in left_part) > 0 THEN
    RETURN left_part || '@g.us';
  END IF;

  digits := regexp_replace(left_part, '[^0-9]', '', 'g');
  IF digits = '' THEN RETURN NULL; END IF;

  IF length(digits) IN (10, 11) THEN
    digits := '55' || digits;
  END IF;

  RETURN digits || '@s.whatsapp.net';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.normalize_chat_key(any_id text)
RETURNS text AS $$
DECLARE
  jid text;
BEGIN
  jid := public.normalize_chat_id(any_id);
  IF jid IS NULL THEN RETURN NULL; END IF;

  IF jid LIKE '%@g.us' THEN
    RETURN 'g:' || jid;
  END IF;

  -- ✅ lid e usuário viram u:<left_part>
  RETURN 'u:' || split_part(jid, '@', 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
