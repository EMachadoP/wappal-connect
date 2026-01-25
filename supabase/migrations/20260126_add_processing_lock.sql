-- Add concurrency locking columns to conversations
-- For ai-maybe-reply debounce mechanism

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS processing_until timestamptz;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS processing_token uuid;

CREATE INDEX IF NOT EXISTS conversations_processing_until_idx
  ON public.conversations (processing_until);
