-- Migration: Add audio configuration columns to conversations table
-- Created: 2026-01-02
-- Description: Add audio_enabled and audio_auto_transcribe columns to control audio behavior per conversation

-- Add audio configuration columns
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS audio_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS audio_auto_transcribe BOOLEAN DEFAULT true;

-- Add comments for documentation
COMMENT ON COLUMN conversations.audio_enabled IS 'Allow audio messages in this conversation (true = allow, false = block)';
COMMENT ON COLUMN conversations.audio_auto_transcribe IS 'Automatically transcribe audio messages (true = auto-transcribe, false = manual only)';

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_conversations_audio_settings 
ON conversations(audio_enabled, audio_auto_transcribe) 
WHERE audio_enabled = false OR audio_auto_transcribe = false;
