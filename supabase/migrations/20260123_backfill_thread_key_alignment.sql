-- =============================================================================
-- BACKFILL: Mesclar/Renomear conversas antigas (u:) para formato (dm:)
-- =============================================================================
-- CONTEXTO: Mensagens enviadas antes do fix usavam thread_key = u:55...
--           Webhook sempre usou thread_key = dm:UUID
-- ESTRATÉGIA: 
--   A) Se já existe dm: para o mesmo contact_id → mover mensagens e deletar u:
--   B) Se não existe dm: → renomear u: para dm:${contact_id}
-- =============================================================================

BEGIN;

-- PREVIEW: quantas conversas antigas u: existem?
SELECT COUNT(*) AS u_count
FROM public.conversations
WHERE thread_key LIKE 'u:%';

-- PREVIEW: quais são?
SELECT id, thread_key, contact_id, chat_id, created_at,
       (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as msg_count
FROM public.conversations c
WHERE thread_key LIKE 'u:%'
ORDER BY created_at DESC;

-- =============================================================================
-- A) MERGE: u: -> dm: quando já existe dm: para o mesmo contact_id
-- =============================================================================
WITH merge_map AS (
  SELECT
    u.id AS old_conv_id,
    d.id AS new_conv_id
  FROM public.conversations u
  JOIN public.conversations d
    ON d.contact_id = u.contact_id
   AND d.thread_key = ('dm:' || u.contact_id::text)
  WHERE u.thread_key LIKE 'u:%'
)
UPDATE public.messages m
SET conversation_id = mm.new_conv_id
FROM merge_map mm
WHERE m.conversation_id = mm.old_conv_id;

-- Apaga u: que ficaram sem mensagens após merge
DELETE FROM public.conversations c
WHERE c.thread_key LIKE 'u:%'
  AND NOT EXISTS (
    SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id
  );

-- =============================================================================
-- B) RENAME: u: -> dm:<contact_id> quando NÃO existe dm: ainda
-- =============================================================================
UPDATE public.conversations u
SET thread_key = 'dm:' || u.contact_id::text
WHERE u.thread_key LIKE 'u:%'
  AND u.contact_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.conversations d
    WHERE d.thread_key = ('dm:' || u.contact_id::text)
  );

COMMIT;

-- =============================================================================
-- VERIFICAÇÃO PÓS-BACKFILL
-- =============================================================================

-- Não deve existir mais u:
SELECT COUNT(*) AS remaining_u_conversations
FROM public.conversations 
WHERE thread_key LIKE 'u:%';

-- Não deve haver duplicatas por contact_id
SELECT contact_id, COUNT(*) AS count,
       STRING_AGG(thread_key, ', ') as thread_keys
FROM public.conversations
WHERE contact_id IS NOT NULL
GROUP BY contact_id
HAVING COUNT(*) > 1;

-- Não deve haver duplicatas por thread_key
SELECT thread_key, COUNT(*) as count
FROM public.conversations
WHERE thread_key IS NOT NULL AND thread_key <> ''
GROUP BY thread_key
HAVING COUNT(*) > 1;
