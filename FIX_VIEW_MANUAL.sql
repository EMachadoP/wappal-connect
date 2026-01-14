-- SOLUÇÃO: Recriar v_planning_week com as colunas corretas
-- Cole este SQL no Supabase SQL Editor e execute

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

-- Teste rápido
SELECT protocol_code, condominium_name
FROM v_planning_week
LIMIT 5;
