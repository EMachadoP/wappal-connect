-- ============================================
-- MIGRATION: Employee Phones Mapping
-- Maps employee WhatsApp phones to profiles
-- ============================================

CREATE TABLE IF NOT EXISTS employee_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_phones_phone_uq
  ON employee_phones(phone)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS employee_phones_profile_idx
  ON employee_phones(profile_id);

-- ============================================
-- MIGRATION: Protocol Notifications Deduplication
-- Prevents duplicate notifications per protocol
-- ============================================

CREATE TABLE IF NOT EXISTS protocol_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id uuid NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  channel text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS protocol_notifications_uq
  ON protocol_notifications(protocol_id, channel);

-- ============================================
-- MIGRATION: Conversation Thread Key (LID-First)
-- Ensures single conversation per contact
-- ============================================

-- Add thread_key column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'thread_key'
  ) THEN
    ALTER TABLE conversations ADD COLUMN thread_key text;
  END IF;
END $$;

-- Backfill existing conversations with thread_key from chat_id
UPDATE conversations
SET thread_key = chat_id
WHERE thread_key IS NULL AND chat_id IS NOT NULL;

-- Create unique index
CREATE UNIQUE INDEX IF NOT EXISTS conversations_thread_key_uq
  ON conversations(thread_key)
  WHERE thread_key IS NOT NULL;
