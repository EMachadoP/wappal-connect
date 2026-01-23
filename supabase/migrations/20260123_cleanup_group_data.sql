-- =====================================================
-- ROBUST GROUP CLEANUP SCRIPT (CRASH PROOF)
-- =====================================================
-- Ensures schema exists before updating data.
-- Handles: is_group column, title column, nullable contact_id.

DO $$
BEGIN
    -- 1. Ensure 'is_group' column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conversations' AND column_name='is_group') THEN
        ALTER TABLE public.conversations ADD COLUMN is_group BOOLEAN DEFAULT FALSE;
    END IF;

    -- 2. Ensure 'title' column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conversations' AND column_name='title') THEN
        ALTER TABLE public.conversations ADD COLUMN title TEXT;
    END IF;

    -- 3. Ensure 'contact_id' can be NULL (critical for groups)
    ALTER TABLE public.conversations ALTER COLUMN contact_id DROP NOT NULL;

END $$;

-- 4. Clean up legacy groups (remove fake contacts)
UPDATE public.conversations
SET contact_id = NULL
WHERE (thread_key LIKE 'group:%' OR chat_id LIKE '%@g.us')
  AND contact_id IS NOT NULL;

-- 5. Set is_group flag
UPDATE public.conversations
SET is_group = TRUE
WHERE (thread_key LIKE 'group:%' OR chat_id LIKE '%@g.us');

-- 6. Ensure groups have a title fallback
UPDATE public.conversations
SET title = COALESCE(NULLIF(title,''), 'Grupo')
WHERE is_group = TRUE
  AND (title IS NULL OR title = '' OR title ~ '^\d+$');
