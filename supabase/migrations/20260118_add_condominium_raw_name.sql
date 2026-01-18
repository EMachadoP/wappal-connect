-- Migration: Add support for protocols without condominium_id (production-safe)
-- This allows protocols to be created when the condominium name is provided
-- but not found in the database, avoiding infinite loops

-- 1. Add column for raw condominium name (when ID not found)
ALTER TABLE public.protocols
ADD COLUMN IF NOT EXISTS condominium_raw_name TEXT;

COMMENT ON COLUMN protocols.condominium_raw_name IS 
'Nome do condomínio informado pelo usuário quando não foi possível resolver para um ID existente. Permite criação de protocolo sem loop infinito.';

-- 2. Relax NOT NULL constraint on condominium_id (if it exists)
ALTER TABLE public.protocols
ALTER COLUMN condominium_id DROP NOT NULL;

-- 3. Add constraint safely with NOT VALID (doesn't check existing rows initially)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'protocols_condo_present_chk'
  ) THEN
    ALTER TABLE public.protocols
    ADD CONSTRAINT protocols_condo_present_chk
    CHECK (condominium_id IS NOT NULL OR condominium_raw_name IS NOT NULL)
    NOT VALID; -- ✅ Doesn't validate existing rows immediately
  END IF;

  -- 4. Validate only if no violating rows exist
  IF NOT EXISTS (
    SELECT 1 FROM public.protocols
    WHERE condominium_id IS NULL AND condominium_raw_name IS NULL
  ) THEN
    ALTER TABLE public.protocols VALIDATE CONSTRAINT protocols_condo_present_chk;
  END IF;
END $$;

COMMENT ON CONSTRAINT protocols_condo_present_chk ON public.protocols IS
'Garante que o protocolo tenha pelo menos uma referência de condomínio (ID ou nome raw). Production-safe: usa NOT VALID para não quebrar dados históricos.';
