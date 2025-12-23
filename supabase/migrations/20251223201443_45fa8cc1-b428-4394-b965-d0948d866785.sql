-- Add audio transcription columns to messages table
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS transcript text,
ADD COLUMN IF NOT EXISTS transcribed_at timestamptz,
ADD COLUMN IF NOT EXISTS transcript_provider text;

-- Add index for finding messages needing transcription
CREATE INDEX IF NOT EXISTS idx_messages_audio_no_transcript 
ON public.messages (conversation_id, sent_at DESC) 
WHERE message_type = 'audio' AND transcript IS NULL;

-- Comment for documentation
COMMENT ON COLUMN public.messages.transcript IS 'Transcribed text content from audio messages';
COMMENT ON COLUMN public.messages.transcribed_at IS 'Timestamp when the audio was transcribed';
COMMENT ON COLUMN public.messages.transcript_provider IS 'Provider used for transcription (e.g., gemini, whisper)';