-- =====================================================
-- MIGRATION: Suporte a cards manuais e melhorias
-- =====================================================

-- 1. Adicionar colunas para cards manuais em plan_items
ALTER TABLE plan_items 
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'auto',
ADD COLUMN IF NOT EXISTS manual_title TEXT,
ADD COLUMN IF NOT EXISTS manual_notes TEXT,
ADD COLUMN IF NOT EXISTS is_fixed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

-- 2. Adicionar índice para performance
CREATE INDEX IF NOT EXISTS idx_plan_items_source ON plan_items(source);
CREATE INDEX IF NOT EXISTS idx_plan_items_plan_date ON plan_items(plan_date);

-- 3. Criar view atualizada para incluir cards manuais
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
  -- Condominium
  COALESCE(c.name, pi.manual_title) as condominium_name
FROM plan_items pi
LEFT JOIN technicians t ON pi.technician_id = t.id
LEFT JOIN protocol_work_items pwi ON pi.work_item_id = pwi.id
LEFT JOIN protocols p ON pwi.protocol_id = p.id
LEFT JOIN condominiums c ON p.condominium_id = c.id
ORDER BY pi.plan_date, pi.start_minute;

-- 4. Função para deletar card com cleanup
CREATE OR REPLACE FUNCTION delete_plan_item(p_item_id UUID, p_set_done BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_work_item_id UUID;
  v_assignment_group_id UUID;
  v_new_status TEXT := 'open';
BEGIN
  -- Definir novo status
  IF p_set_done THEN
    v_new_status := 'done';
  END IF;

  -- Buscar dados do item
  SELECT work_item_id, assignment_group_id 
  INTO v_work_item_id, v_assignment_group_id
  FROM plan_items WHERE id = p_item_id;
  
  -- Se tinha work_item, atualizar status
  IF v_work_item_id IS NOT NULL THEN
    UPDATE protocol_work_items 
    SET status = v_new_status, assignment_group_id = NULL
    WHERE id = v_work_item_id;
  END IF;
  
  -- Deletar o item (e outros do mesmo grupo se houver)
  IF v_assignment_group_id IS NOT NULL THEN
    DELETE FROM plan_items WHERE assignment_group_id = v_assignment_group_id;
  ELSE
    DELETE FROM plan_items WHERE id = p_item_id;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true, 
    'deleted_work_item_id', v_work_item_id,
    'new_status', v_new_status
  );
END;
$$;

-- 5. Permissões
GRANT EXECUTE ON FUNCTION delete_plan_item(UUID, BOOLEAN) TO authenticated, service_role;
GRANT ALL ON v_planning_week TO authenticated, service_role;
