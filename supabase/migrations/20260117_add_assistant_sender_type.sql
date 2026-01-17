-- =====================================================
-- Migration: Add 'assistant' to sender_type enum
-- =====================================================
-- This fixes the error: "invalid input value for enum sender_type: assistant"
-- The AI should be identified as 'assistant', distinct from 'agent' (human agents)

-- Add 'assistant' to the sender_type enum if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'assistant'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'sender_type')
    ) THEN
        ALTER TYPE sender_type ADD VALUE 'assistant';
    END IF;
END $$;
