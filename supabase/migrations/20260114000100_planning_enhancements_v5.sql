-- Migration: Planning Enhancements V5
-- Created: 2026-01-14
-- Purpose: Add wildcard support and rich view for planning cards

-- 1) Technicians: Add is_wildcard column
ALTER TABLE technicians 
ADD COLUMN IF NOT EXISTS is_wildcard BOOLEAN NOT NULL DEFAULT false;

-- Index for bitwise or frequent active status checks
CREATE INDEX IF NOT EXISTS idx_technicians_active ON technicians(is_active);

-- Mark André as wildcard by default if he exists
UPDATE technicians 
SET is_wildcard = true 
WHERE name ILIKE '%André%';

-- 2) View: Consolidate data for planning cards (rich information)
CREATE OR REPLACE VIEW v_planning_week AS
SELECT
  pi.id,
  pi.plan_date,
  pi.start_minute,
  pi.end_minute,
  pi.sequence,
  pi.assignment_group_id,
  pi.technician_id,
  t.name as technician_name,
  t.is_wildcard,

  wi.id as work_item_id,
  wi.title as work_item_title,
  wi.priority as work_item_priority,
  wi.status as work_item_status,
  wi.estimated_minutes,
  wi.required_people,
  wi.required_skill_codes,

  p.id as protocol_id,
  p.protocol_code,
  p.conversation_id,
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

-- Comment for documentation
COMMENT ON VIEW v_planning_week IS 'Rich view for the Planning grid - includes protocol and condominium info for cards.';
