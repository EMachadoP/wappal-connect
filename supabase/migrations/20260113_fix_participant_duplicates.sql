-- Migration to fix duplicate conversation_participant_state and reinforce UNIQUE constraint
-- Created: 2026-01-13

DO $$ 
BEGIN
    -- 1. Clean up duplicates (keep only the most recent updated_at)
    DELETE FROM public.conversation_participant_state a
    USING public.conversation_participant_state b
    WHERE a.id < b.id 
      AND a.conversation_id = b.conversation_id;

    -- 2. Ensure UNIQUE constraint exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'conversation_participant_state_conversation_id_key'
    ) THEN
        ALTER TABLE public.conversation_participant_state 
        ADD CONSTRAINT conversation_participant_state_conversation_id_key UNIQUE (conversation_id);
    END IF;
END $$;
