-- Migration: Canonicalize WhatsApp Identifiers (JID and Prefixed Keys)
-- Description: Unifies chat_id as Canonical JID and derives thread_key/chat_key from it.
-- Date: 2026-01-19

BEGIN;

-- 1) Canonicaliza JID (chat_id) sem prefixo
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

  left_part := split_part(v, '@', 1);

  -- Grupo: se já tem @g.us OU se tem '-' no id
  IF v LIKE '%@g.us' OR position('-' in left_part) > 0 THEN
    RETURN left_part || '@g.us';
  END IF;

  -- Usuário: só dígitos
  digits := regexp_replace(left_part, '[^0-9]', '', 'g');
  IF digits = '' THEN RETURN NULL; END IF;

  IF length(digits) IN (10, 11) THEN
    digits := '55' || digits;
  END IF;

  RETURN digits || '@s.whatsapp.net';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2) Chave canônica (com prefixo u:/g:)
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

  RETURN 'u:' || split_part(jid, '@', 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3) Corrige conversations.chat_id para JID canônico
UPDATE public.conversations
SET chat_id = public.normalize_chat_id(chat_id)
WHERE chat_id IS NOT NULL AND chat_id <> '';

-- 4) thread_key sempre derivado do chat_id canônico
UPDATE public.conversations
SET thread_key = public.normalize_chat_key(chat_id)
WHERE chat_id IS NOT NULL AND chat_id <> '';

-- 5) Re-normaliza contacts.chat_key (aproveita o que tem)
UPDATE public.contacts
SET chat_key = public.normalize_chat_key(chat_key)
WHERE chat_key IS NOT NULL AND chat_key <> '';

-- 6) (Opcional) alinhar is_group pelo prefixo
UPDATE public.contacts
SET is_group = (chat_key LIKE 'g:%')
WHERE chat_key IS NOT NULL AND chat_key <> '';

COMMIT;
