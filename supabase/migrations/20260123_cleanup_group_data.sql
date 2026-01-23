-- =====================================================
-- CLEANUP GROUP DATA
-- =====================================================
-- Sanitize legacy group data and fix identity separation.
BEGIN;

-- 1) Para grupos: se contact_id estava preenchido, limpa (grupo não é pessoa)
UPDATE public.conversations
SET contact_id = NULL
WHERE (thread_key LIKE 'group:%' OR chat_id LIKE '%@g.us')
  AND contact_id IS NOT NULL;

-- 2) Garante que a flag is_group esteja correta
UPDATE public.conversations
SET is_group = TRUE
WHERE (thread_key LIKE 'group:%' OR chat_id LIKE '%@g.us')
  AND (is_group IS FALSE OR is_group IS NULL);

-- 3) Se o título estiver vazio ou contiver apenas números (provavel JID), tenta colocar um fallback
UPDATE public.conversations
SET title = COALESCE(NULLIF(title,''), 'Grupo')
WHERE is_group = TRUE
  AND (title IS NULL OR title = '' OR title ~ '^\d+$');

COMMIT;
