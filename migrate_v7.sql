-- =====================================================
-- HARDEN IDENTITY & NORMALIZE CONTACTS (V7)
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE 'Iniciando normalização de contatos...';

  -- 1) Normalizar CHAT_KEY: Remover prefixos u: e g:
  UPDATE public.contacts
  SET chat_key = CASE 
      WHEN chat_key LIKE 'u:%' THEN SUBSTRING(chat_key FROM 3)
      WHEN chat_key LIKE 'g:%' THEN SUBSTRING(chat_key FROM 3)
      ELSE chat_key
    END
  WHERE chat_key LIKE 'u:%' OR chat_key LIKE 'g:%';

  -- 2) Normalizar PHONE: Garantir apenas dígitos
  UPDATE public.contacts
  SET phone = regexp_replace(phone, '\D', '', 'g')
  WHERE phone ~ '\D';

  RAISE NOTICE 'Limpeza de chaves concluída.';
END $$;

-- 3) Upgrade RPC resolve_contact_identity_v6 para ser mais robusto
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

  v_name     TEXT := NULLIF(BTRIM(COALESCE(p_name,'')), '');
  v_chat_lid TEXT := NULLIF(BTRIM(COALESCE(p_chat_lid,'')), '');
  v_lid      TEXT := NULLIF(BTRIM(COALESCE(p_lid,'')), '');
BEGIN
  -- 0) Prioridade 1: LID exato (único e estável)
  IF v_chat_lid IS NOT NULL THEN
    SELECT c.id INTO v_existing_id FROM public.contacts c WHERE c.chat_lid = v_chat_lid OR c.lid = v_chat_lid LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      SELECT c.chat_key INTO v_chat_key FROM public.contacts c WHERE c.id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'chat_lid_match'::text;
      RETURN;
    END IF;
  END IF;

  -- 1) Determinar chave numérica base
  v_chat_key := NULLIF(v_digits_from_chat_id, '');
  IF v_chat_key IS NULL THEN v_chat_key := NULLIF(v_digits_from_phone, ''); END IF;

  -- Recusar lixo
  IF v_chat_key IS NOT NULL AND length(v_chat_key) < 10 THEN
    RETURN QUERY SELECT NULL::uuid, v_chat_key, v_chat_key, 'refused_too_short'::text;
    RETURN;
  END IF;

  IF v_chat_key IS NOT NULL THEN
    -- 2) Busca profunda por dígitos (chave ou telefone)
    SELECT c.id INTO v_existing_id
    FROM public.contacts c
    WHERE c.chat_key = v_chat_key 
       OR regexp_replace(COALESCE(c.phone,''), '\D', '', 'g') = v_chat_key
       OR c.chat_key = 'u:' || v_chat_key -- Legado (compatibilidade)
    ORDER BY c.updated_at DESC NULLS LAST
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.contacts c SET 
        chat_lid = COALESCE(v_chat_lid, c.chat_lid),
        lid      = COALESCE(v_lid,      c.lid),
        phone    = COALESCE(v_chat_key,  c.phone),
        name     = CASE WHEN c.name IS NULL OR c.name ~ '^\d+$' THEN COALESCE(v_name, c.name) ELSE c.name END,
        updated_at = now()
      WHERE c.id = v_existing_id;
      RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'chat_key_or_phone_match'::text;
      RETURN;
    END IF;

    -- 3) BR 12/13 variant match
    IF v_chat_key LIKE '55%' AND (length(v_chat_key)=12 OR length(v_chat_key)=13) THEN
      IF length(v_chat_key)=12 THEN v_variant1 := left(v_chat_key,4) || '9' || right(v_chat_key,8);
      ELSE IF substr(v_chat_key,5,1)='9' THEN v_variant1 := left(v_chat_key,4) || right(v_chat_key,8); END IF;
      END IF;

      SELECT ARRAY_AGG(DISTINCT c.id) INTO v_candidates
      FROM public.contacts c
      WHERE c.chat_key IN (v_chat_key, v_variant1)
         OR regexp_replace(COALESCE(c.phone,''), '\D', '', 'g') IN (v_chat_key, v_variant1);

      IF array_length(v_candidates,1) = 1 THEN
        v_existing_id := v_candidates[1];
        SELECT c.chat_key INTO v_chat_key FROM public.contacts c WHERE c.id = v_existing_id;
        UPDATE public.contacts c SET chat_lid = COALESCE(v_chat_lid, c.chat_lid), lid = COALESCE(v_lid, c.lid), updated_at = now() WHERE c.id = v_existing_id;
        RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'variant_match'::text;
        RETURN;
      END IF;
    END IF;

    -- 4) Criar contato (chave limpa)
    INSERT INTO public.contacts (chat_key, chat_lid, lid, phone, name, created_at, updated_at)
    VALUES (v_chat_key, v_chat_lid, v_lid, v_chat_key, COALESCE(v_name, v_chat_key), now(), now())
    RETURNING id INTO v_existing_id;
    RETURN QUERY SELECT v_existing_id, v_chat_key, v_chat_key, 'created'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text, 'refused_no_key'::text;
END;
$$;

-- 4) MERGE DEFINITIVO G7 SERV (Portaria/Alameda)
DO $$
DECLARE
  v_manter_contact_id UUID := '388c4413-9543-4d12-a72b-8eab6782013f'; -- ALAMEDA IMPERIAL
  v_remover_contact_id UUID := '230d835b-061a-4c8f-b5b9-4156a2cdd697'; -- 558191657140 (Duplicate)
  v_manter_conv_id UUID := '0785bc74-8392-4a8a-bb93-608ca38e5878'; -- ALAMEDA IMPERIAL (Conv)
  v_remover_conv_id UUID := '7b258b67-dc95-4332-8d95-ccee782a38d8'; -- 558191657140 (Conv)
BEGIN
  -- Unificar Mensagens (da conv duplicada para a principal)
  UPDATE public.messages SET conversation_id = v_manter_conv_id WHERE conversation_id = v_remover_conv_id;
  
  -- Unificar Protocolos
  UPDATE public.protocols SET conversation_id = v_manter_conv_id, contact_id = v_manter_contact_id WHERE conversation_id = v_remover_conv_id;
  UPDATE public.protocols SET contact_id = v_manter_contact_id WHERE contact_id = v_remover_contact_id;

  -- Deletar conversa duplicada
  DELETE FROM public.conversations WHERE id = v_remover_conv_id;

  -- Deletar contato duplicado
  DELETE FROM public.contacts WHERE id = v_remover_contact_id;

  RAISE NOTICE 'Merge ALAMEDA IMPERIAL concluído com sucesso.';
END $$;

-- 5) Prevenção definitiva de duplicados por chat_id
-- (O merge acima garante que não haverá conflito durante a criação do índice)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_chat_id_unique 
ON conversations (chat_id) 
WHERE chat_id IS NOT NULL;
