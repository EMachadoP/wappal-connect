
-- Migration to add unique constraint to conversations(chat_id)
-- This is required for upsert operations in the zapi-webhook

DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'conversations_chat_id_key'
    ) THEN
        ALTER TABLE public.conversations ADD CONSTRAINT conversations_chat_id_key UNIQUE (chat_id);
    END IF;
END $$;
