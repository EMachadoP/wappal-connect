-- Migration: Fix Planning Issues
-- Created: 2026-01-14
-- Purpose: Fix v_planning_week view to include condominium data

-- 1) Fix v_planning_week to include missing fields
DROP VIEW IF EXISTS v_planning_week;

CREATE VIEW v_planning_week AS
SELECT
  pi.id,
  pi.plan_date,
  pi.start_minute,
  pi.end_minute,
  pi.sequence,
  pi.assignment_group_id,
  pi.created_at as plan_created_at,
  
  pi.technician_id,
  t.name as technician_name,
  t.is_wildcard,

  wi.id as work_item_id,
  wi.title as work_item_title,
  wi.priority as work_item_priority,
  wi.category as work_item_category,
  wi.status as work_item_status,
  wi.estimated_minutes,
  wi.required_people,
  wi.required_skill_codes,

  p.id as protocol_id,
  p.protocol_code,
  p.conversation_id,
  p.status as protocol_status,
  p.summary as protocol_summary,
  p.priority as protocol_priority,
  p.category as protocol_category,

  c.id as condominium_id,
  c.name as condominium_name

FROM plan_items pi
JOIN technicians t ON t.id = pi.technician_id
JOIN protocol_work_items wi ON wi.id = pi.work_item_id
JOIN protocols p ON p.id = wi.protocol_id
LEFT JOIN condominiums c ON c.id = p.condominium_id;

COMMENT ON VIEW v_planning_week IS 'Rich view for the Planning grid - includes protocol and condominium info for cards (v5.2)';

-- 2) Create or update Aijolan technician
DO $$
DECLARE
    aijolan_id UUID;
    skill_ids UUID[];
    skill_code TEXT;
BEGIN
    -- Check if Aijolan exists
    SELECT id INTO aijolan_id FROM technicians WHERE name = 'Aijolan Amaro';
    
    -- If not, create him
    IF aijolan_id IS NULL THEN
        INSERT INTO technicians (name, is_active, dispatch_priority)
        VALUES ('Aijolan Amaro', true, 100)
        RETURNING id INTO aijolan_id;
        
        -- Add all his skills (from the UI screenshot)
        FOR skill_code IN 
            SELECT unnest(ARRAY[
                'ANTENACOLETIVA', 'CERCAELTRICA', 'CFTV', 'CONCERTINA', 
                'CONTROLEDEACESSOPEDESTRE', 'CONTROLEDEACESSOVEICULAR',
                'ENTREGADECONTROLE', 'ENTREGADEINTERFONE', 'INTERFONE',
                'PORTAO', 'PORTODEPEDESTREESSOVEICULAR'
            ])
        LOOP
            INSERT INTO technician_skills (technician_id, skill_id)
            SELECT aijolan_id, id FROM skills WHERE code = skill_code
            ON CONFLICT DO NOTHING;
        END LOOP;
    ELSE
        -- Ensure he's active
        UPDATE technicians SET is_active = true WHERE id = aijolan_id;
    END IF;
END $$;
