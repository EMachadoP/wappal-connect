-- Add group support and additional conversation fields

-- Add is_group and group_name to contacts
ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS group_name text;

-- Add priority and snooze fields to conversations
ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal',
ADD COLUMN IF NOT EXISTS snoozed_until timestamp with time zone,
ADD COLUMN IF NOT EXISTS marked_unread boolean DEFAULT false;