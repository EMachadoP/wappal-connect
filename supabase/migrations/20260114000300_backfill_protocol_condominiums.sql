-- Migration: Backfill condominium_id in protocols
-- Created: 2026-01-14
-- Purpose: Fill missing condominium_id using conversations.active_condominium_id and contact history

-- This migration is idempotent and safe to run multiple times

DO $$
DECLARE
    missing_before INT;
    missing_after_step1 INT;
    missing_after_step2 INT;
    missing_final INT;
    with_condo_final INT;
BEGIN
    -- 0) Diagnóstico inicial
    SELECT count(*) INTO missing_before
    FROM protocols
    WHERE condominium_id IS NULL;
    
    RAISE NOTICE 'Initial protocols missing condominium_id: %', missing_before;
    
    -- 1) Preencher via conversations.active_condominium_id
    --    com confidence >= 0.70 (razoavelmente confiável)
    UPDATE protocols p
    SET condominium_id = c.active_condominium_id
    FROM conversations c
    WHERE p.condominium_id IS NULL
      AND p.conversation_id = c.id
      AND c.active_condominium_id IS NOT NULL
      AND (c.active_condominium_confidence IS NULL OR c.active_condominium_confidence >= 0.70);
    
    SELECT count(*) INTO missing_after_step1
    FROM protocols
    WHERE condominium_id IS NULL;
    
    RAISE NOTICE 'After step 1 (conversation active_condo): % still missing', missing_after_step1;
    
    -- 2) Preencher via histórico do contact_id:
    --    pega o último protocolo do mesmo contact que já tem condominium_id
    WITH latest_known AS (
        SELECT DISTINCT ON (p2.contact_id)
            p2.contact_id,
            p2.condominium_id
        FROM protocols p2
        WHERE p2.contact_id IS NOT NULL
          AND p2.condominium_id IS NOT NULL
        ORDER BY p2.contact_id, p2.created_at DESC
    )
    UPDATE protocols p
    SET condominium_id = lk.condominium_id
    FROM latest_known lk
    WHERE p.condominium_id IS NULL
      AND p.contact_id = lk.contact_id;
    
    SELECT count(*) INTO missing_after_step2
    FROM protocols
    WHERE condominium_id IS NULL;
    
    RAISE NOTICE 'After step 2 (contact history): % still missing', missing_after_step2;
    
    -- 3) Marcar os que ainda ficaram sem condomínio com tag "condo_missing"
    UPDATE protocols p
    SET tags = CASE
        WHEN p.tags IS NULL THEN ARRAY['condo_missing']
        WHEN NOT ('condo_missing' = ANY(p.tags)) THEN array_append(p.tags, 'condo_missing')
        ELSE p.tags
    END
    WHERE p.condominium_id IS NULL;
    
    -- Relatório final
    SELECT
        count(*) FILTER (WHERE condominium_id IS NULL),
        count(*) FILTER (WHERE condominium_id IS NOT NULL)
    INTO missing_final, with_condo_final
    FROM protocols;
    
    RAISE NOTICE 'FINAL: % protocols with condominium, % still missing (tagged)', with_condo_final, missing_final;
END $$;
