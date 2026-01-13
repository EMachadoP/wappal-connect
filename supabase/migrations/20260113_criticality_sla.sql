-- Migration: Add criticality and SLA to templates and work items
-- Created: 2026-01-13
-- Purpose: Support critical (same day) vs non-critical (2 business days) SLA

-- 1) Add columns to task_templates
alter table task_templates
add column if not exists criticality text not null default 'non_critical',
add column if not exists sla_business_days int not null default 2;

create index if not exists idx_task_templates_criticality
on task_templates (criticality);

-- 2) Add columns to protocol_work_items
alter table protocol_work_items
add column if not exists criticality text not null default 'non_critical',
add column if not exists sla_business_days int not null default 2,
add column if not exists due_date date;

-- 3) Update existing operational templates to be critical (same day)
update task_templates 
set criticality = 'critical', sla_business_days = 0 
where category = 'operational';

-- 4) Comment for documentation
comment on column task_templates.criticality is 'critical = same day, non_critical = 2 business days';
comment on column task_templates.sla_business_days is '0 = same day, 2 = 2 business days';
