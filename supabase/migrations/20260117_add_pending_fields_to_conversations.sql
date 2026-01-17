-- =====================================================
-- Migration: Add pending fields for state machine
-- =====================================================

ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS pending_field text,
ADD COLUMN IF NOT EXISTS pending_payload jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS pending_set_at timestamptz;

CREATE INDEX IF NOT EXISTS conversations_pending_field_idx
ON public.conversations(pending_field)
WHERE pending_field IS NOT NULL;
