-- Migration: Add support for protocols without condominium_id
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

-- 3. Add constraint: must have EITHER condominium_id OR condominium_raw_name
ALTER TABLE public.protocols
ADD CONSTRAINT protocols_condo_present_chk
CHECK (condominium_id IS NOT NULL OR condominium_raw_name IS NOT NULL);

COMMENT ON CONSTRAINT protocols_condo_present_chk ON public.protocols IS
'Garante que o protocolo tenha pelo menos uma referência de condomínio (ID ou nome raw)';
