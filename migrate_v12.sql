-- =====================================================
-- ADD HUMAN CONTROL TRACKING COLUMNS (V12)
-- =====================================================

ALTER TABLE public.conversations 
  ADD COLUMN IF NOT EXISTS human_control_at TIMESTAMPTZ;

ALTER TABLE public.conversations 
  ADD COLUMN IF NOT EXISTS last_human_message_at TIMESTAMPTZ;

-- Backfill: se human_control=true, usa updated_at como fallback
UPDATE public.conversations
SET
  human_control_at = COALESCE(human_control_at, updated_at),
  last_human_message_at = COALESCE(last_human_message_at, updated_at)
WHERE human_control = true;

NOTIFY pgrst, 'reload schema';
