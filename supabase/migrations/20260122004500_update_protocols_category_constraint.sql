-- Migration: Update protocols category constraint
-- Date: 2026-01-22
-- Purpose: Include all technical and administrative categories in the protocols table constraint

ALTER TABLE public.protocols DROP CONSTRAINT IF EXISTS protocols_category_check;

ALTER TABLE public.protocols 
ADD CONSTRAINT protocols_category_check 
CHECK (category IN (
    'operational', 
    'financial', 
    'support', 
    'admin', 
    'commercial',
    'cftv',
    'interfone',
    'antena_coletiva',
    'portao_veicular',
    'porta_pedestre',
    'controle_acesso_pedestre',
    'controle_acesso_veicular',
    'infraestrutura',
    'cerca_eletrica',
    'alarme',
    'concertina',
    'infra' -- for compatibility with older templates
));

-- Ensure existing templates align with these categories
-- (Optional cleaning if needed, but the constraint allows them now)
