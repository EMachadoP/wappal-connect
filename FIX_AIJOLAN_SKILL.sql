-- Fix: Add missing PORTAO skill to Aijolan
-- All work_items require [PORTAO, CFTV, INTERFONE]
-- Aijolan currently has all EXCEPT PORTAO

DO $$
DECLARE
    aijolan_id UUID;
    portao_skill_id UUID;
BEGIN
    -- Get Aijolan's ID
    SELECT id INTO aijolan_id 
    FROM technicians 
    WHERE name ILIKE '%Aijolan%' 
    LIMIT 1;
    
    -- Get PORTAO skill ID
    SELECT id INTO portao_skill_id 
    FROM skills 
    WHERE code = 'PORTAO' 
    LIMIT 1;
    
    IF aijolan_id IS NOT NULL AND portao_skill_id IS NOT NULL THEN
        -- Add PORTAO if not already there
        INSERT INTO technician_skills (technician_id, skill_id)
        VALUES (aijolan_id, portao_skill_id)
        ON CONFLICT DO NOTHING;
        
        RAISE NOTICE 'Added PORTAO skill to Aijolan';
    ELSE
        RAISE NOTICE 'Aijolan or PORTAO skill not found';
    END IF;
END $$;

-- Validation
SELECT 
    t.name,
    array_agg(s.code ORDER BY s.code) as skills
FROM technicians t
LEFT JOIN technician_skills ts ON ts.technician_id = t.id
LEFT JOIN skills s ON s.id = ts.skill_id
WHERE t.name ILIKE '%Aijolan%'
GROUP BY t.name;
