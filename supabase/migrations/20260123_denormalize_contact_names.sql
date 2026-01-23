
-- =====================================================
-- DENORMALIZE CONTACT NAMES TO CONVERSATIONS (FALLBACK)
-- =====================================================
-- Copies contact names to conversation titles for DMs.
-- This ensures 'Sem Nome' is fixed even if the Contacts join fails (RLS/Permissions).

BEGIN;

-- Update conversations titles with contact names
UPDATE public.conversations c
SET title = ct.name
FROM public.contacts ct
WHERE c.contact_id = ct.id
  AND (c.title IS NULL OR c.title = '' OR c.title = 'Sem Nome')
  AND c.is_group IS FALSE;

COMMIT;
