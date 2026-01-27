-- =====================================================
-- MIGRATION: Vínculo formal de condomínio em plan_items
-- =====================================================

-- 1. Adicionar coluna condominium_id em plan_items
ALTER TABLE plan_items 
ADD COLUMN IF NOT EXISTS condominium_id UUID REFERENCES condominiums(id);

-- 2. Criar índice para performance
CREATE INDEX IF NOT EXISTS idx_plan_items_condominium_id ON plan_items(condominium_id);

-- 3. Atualizar a view v_planning_week para priorizar o vínculo formal
DROP VIEW IF EXISTS v_planning_week CASCADE;
CREATE OR REPLACE VIEW v_planning_week AS
SELECT 
  pi.id,
  pi.plan_date,
  pi.start_minute,
  pi.end_minute,
  pi.sequence,
  pi.technician_id,
  t.name as technician_name,
  pi.work_item_id,
  pi.assignment_group_id,
  pi.source,
  pi.manual_title,
  pi.manual_notes,
  pi.is_fixed,
  pi.condominium_id,
  -- Work item fields (NULL para manuais)
  pwi.title as work_item_title,
  pwi.priority as work_item_priority,
  pwi.category as work_item_category,
  pwi.status as work_item_status,
  pwi.estimated_minutes,
  -- Protocol fields
  p.id as protocol_id,
  p.protocol_code,
  p.conversation_id,
  p.summary as protocol_summary,
  -- Condominium (Prioridade: Tabela Condominiums > Manual Title)
  COALESCE(c.name, mc.name, pi.manual_title) as condominium_name
FROM plan_items pi
LEFT JOIN technicians t ON pi.technician_id = t.id
LEFT JOIN protocol_work_items pwi ON pi.work_item_id = pwi.id
LEFT JOIN protocols p ON pwi.protocol_id = p.id
LEFT JOIN condominiums c ON p.condominium_id = c.id
LEFT JOIN condominiums mc ON pi.condominium_id = mc.id
ORDER BY pi.plan_date, pi.start_minute;

-- 4. Permissões
GRANT SELECT ON v_planning_week TO authenticated, service_role;
