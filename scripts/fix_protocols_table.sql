-- =============================================
-- FIX: Add missing columns to protocols table
-- Execute this in Supabase SQL Editor
-- =============================================

-- 1. Add missing AI classification columns
ALTER TABLE public.protocols 
ADD COLUMN IF NOT EXISTS ai_classified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(3,2) DEFAULT NULL;

-- 2. Ensure tags column exists and is the right type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' 
                 AND table_name = 'protocols' 
                 AND column_name = 'tags') THEN
    ALTER TABLE public.protocols ADD COLUMN tags TEXT[] DEFAULT '{}';
  END IF;
END $$;

-- 3. Add comments
COMMENT ON COLUMN public.protocols.ai_classified IS 'Whether this protocol was automatically classified by AI';
COMMENT ON COLUMN public.protocols.ai_confidence IS 'AI confidence score (0-1) for the classification';
COMMENT ON COLUMN public.protocols.tags IS 'Tags assigned to this protocol (may be AI-generated)';

-- 4. Verify the fix
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'protocols'
AND column_name IN ('ai_classified', 'ai_confidence', 'tags');
