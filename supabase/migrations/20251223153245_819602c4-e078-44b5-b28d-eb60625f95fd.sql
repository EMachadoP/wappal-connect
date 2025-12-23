-- Add columns for agent assignment tracking
ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS assigned_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES auth.users(id);

-- Add 'system' value to sender_type enum if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'system' AND enumtypid = 'public.sender_type'::regtype) THEN
    ALTER TYPE public.sender_type ADD VALUE 'system';
  END IF;
END $$;

-- Add 'system' value to message_type enum if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'system' AND enumtypid = 'public.message_type'::regtype) THEN
    ALTER TYPE public.message_type ADD VALUE 'system';
  END IF;
END $$;