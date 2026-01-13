-- Migration: Planning View and Performance Indexes
-- Created: 2026-01-13
-- Purpose: Create view for easier frontend queries and add performance indexes

-- 1) VIEW para simplificar queries do frontend
create or replace view v_planning_week as
select
  pi.id,
  pi.plan_date,
  pi.start_minute,
  pi.end_minute,
  pi.sequence,
  pi.created_at as plan_created_at,

  t.id as technician_id,
  t.name as technician_name,

  wi.id as work_item_id,
  wi.title as work_item_title,
  wi.priority as work_item_priority,
  wi.category as work_item_category,
  wi.status as work_item_status,
  wi.estimated_minutes,
  wi.required_people,

  p.id as protocol_id,
  p.protocol_code,
  p.conversation_id,
  p.status as protocol_status,
  p.priority as protocol_priority,
  p.category as protocol_category
from plan_items pi
join technicians t on t.id = pi.technician_id
join protocol_work_items wi on wi.id = pi.work_item_id
join protocols p on p.id = wi.protocol_id;

-- 2) Índices de performance para a VIEW
create index if not exists idx_plan_items_plan_date
  on plan_items (plan_date, technician_id, start_minute);

create index if not exists idx_protocol_work_items_protocol_id
  on protocol_work_items (protocol_id);

create index if not exists idx_protocols_conversation_id
  on protocols (conversation_id);

-- 3) Comentário para documentação
comment on view v_planning_week is 'View consolidada para tela /planning - join de plan_items + technicians + work_items + protocols';
