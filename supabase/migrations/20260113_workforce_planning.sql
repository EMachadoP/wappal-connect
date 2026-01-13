-- Migration: Workforce Planning System
-- Created: 2026-01-13
-- Purpose: Create tables for protocol-derived work items and scheduler

-- 0) Planner locks (for concurrency control)
create table if not exists planner_locks (
  id bigserial primary key,
  lock_key text not null unique,
  locked_at timestamptz not null default now()
);

-- 1) Templates by category (time estimation + skills + default materials)
create table if not exists task_templates (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  title text not null,
  default_minutes int not null default 60,
  required_people int not null default 1,
  required_skill_codes text[] not null default '{}',
  default_materials jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_templates_category_active
  on task_templates (category, active);

-- 2) Work items (schedulable tasks derived from protocols)
create table if not exists protocol_work_items (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references protocols(id) on delete cascade,
  category text not null,
  priority text not null default 'normal',
  title text not null,
  estimated_minutes int not null default 60,
  required_people int not null default 1,
  required_skill_codes text[] not null default '{}',
  status text not null default 'open',
  due_date date null,
  location_text text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pwi_status_created
  on protocol_work_items (status, created_at);

create index if not exists idx_pwi_protocol
  on protocol_work_items (protocol_id);

-- 3) Technicians + skills (operational registry)
create table if not exists technicians (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null
);

create table if not exists technician_skills (
  technician_id uuid not null references technicians(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  level int not null default 1,
  primary key (technician_id, skill_id)
);

-- 4) Plan items (scheduler output - the active plan)
create table if not exists plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null,
  technician_id uuid not null references technicians(id) on delete cascade,
  work_item_id uuid not null references protocol_work_items(id) on delete cascade,
  start_minute int not null,
  end_minute int not null,
  sequence int not null default 0,
  created_at timestamptz not null default now(),
  unique (plan_date, technician_id, start_minute)
);

create index if not exists idx_plan_items_date
  on plan_items (plan_date, technician_id, start_minute);

-- 5) Materials (MVP: list and status)
create table if not exists material_requests (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references protocol_work_items(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- 6) Seed default templates (one per category)
insert into task_templates (category, title, default_minutes, required_people, required_skill_codes, default_materials, active)
values
  ('operational', 'Visita técnica - Operacional', 60, 1, array['PORTAO','CFTV','INTERFONE'], '[]'::jsonb, true),
  ('support', 'Atendimento técnico - Suporte', 45, 1, array['CFTV','ACESSO'], '[]'::jsonb, true),
  ('admin', 'Atendimento administrativo', 30, 1, array['ADMIN'], '[]'::jsonb, true),
  ('financial', 'Atendimento financeiro', 30, 1, array['FIN'], '[]'::jsonb, true)
on conflict do nothing;

-- 7) Seed default skills
insert into skills (code, label)
values
  ('PORTAO', 'Portão Eletrônico'),
  ('CFTV', 'CFTV / Câmeras'),
  ('INTERFONE', 'Interfone'),
  ('ACESSO', 'Controle de Acesso'),
  ('ADMIN', 'Administrativo'),
  ('FIN', 'Financeiro')
on conflict (code) do nothing;
