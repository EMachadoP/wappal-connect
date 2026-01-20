-- Migration: Align Identifiers (Prefix u:/g:)
-- Description: Prefix existing chat_key and thread_key with u: or g: to match Edge Function logic.
-- Date: 2026-01-19

BEGIN;

-- 1. Atualizar contatos (chat_key)
UPDATE public.contacts
SET chat_key = CASE 
    WHEN is_group = true AND NOT chat_key LIKE 'g:%' THEN 'g:' || chat_key
    WHEN is_group = false AND NOT chat_key LIKE 'u:%' THEN 'u:' || chat_key
    ELSE chat_key
END
WHERE chat_key IS NOT NULL AND chat_key <> '';

-- 2. Atualizar conversas (thread_key)
-- Primeiro identificamos se é grupo pelo thread_key ou pelo contato vinculado
UPDATE public.conversations c
SET thread_key = CASE 
    WHEN (thread_key LIKE '%@g.us' OR EXISTS (SELECT 1 FROM public.contacts ct WHERE ct.id = c.contact_id AND ct.is_group = true)) 
         AND NOT thread_key LIKE 'g:%' THEN 'g:' || thread_key
    WHEN NOT (thread_key LIKE '%@g.us' OR EXISTS (SELECT 1 FROM public.contacts ct WHERE ct.id = c.contact_id AND ct.is_group = true)) 
         AND NOT thread_key LIKE 'u:%' THEN 'u:' || thread_key
    ELSE thread_key
END
WHERE thread_key IS NOT NULL AND thread_key <> '';

-- 3. Atualizar a função de normalização SQL para ser consistente
CREATE OR REPLACE FUNCTION public.normalize_chat_key(chat_id text) 
RETURNS text AS $$
DECLARE
  clean_id text;
  numeric_id text;
BEGIN
  IF chat_id IS NULL THEN RETURN NULL; END IF;
  
  -- Já está prefixado?
  IF chat_id LIKE 'u:%' OR chat_id LIKE 'g:%' THEN
    RETURN lower(chat_id);
  END IF;

  -- Para grupos
  IF chat_id LIKE '%@g.us' THEN
    RETURN 'g:' || lower(chat_id);
  END IF;
  
  -- Extrair apenas dígitos do que vem antes do @
  numeric_id := regexp_replace(split_part(chat_id, '@', 1), '[^0-9]', '', 'g');
  
  IF numeric_id = '' THEN RETURN NULL; END IF;

  -- Lógica BR: 
  -- Se tem 10 ou 11 dígitos (DDD + Número), prefixa com 55
  IF length(numeric_id) IN (10, 11) THEN
    RETURN 'u:55' || numeric_id;
  END IF;

  -- Se tem 12 ou 13 dígitos e começa com 55, mantém
  IF (length(numeric_id) IN (12, 13)) AND numeric_id LIKE '55%' THEN
    RETURN 'u:' || numeric_id;
  END IF;

  -- Caso contrário, retorna os dígitos puros com prefixo u:
  RETURN 'u:' || numeric_id;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMIT;
