-- Migration: Fix auto-start trigger to work on both INSERT and UPDATE
-- This ensures tasks auto-start when created with an assignee OR when assigned later

-- Drop old triggers
drop trigger if exists tasks_before_update_set_fields on public.tasks;
drop trigger if exists trg_tasks_before_insert on public.tasks;
drop trigger if exists trg_tasks_before_update on public.tasks;

-- Drop old function
drop function if exists public.tasks_before_update_set_fields();

-- Create unified function for INSERT and UPDATE
create or replace function public.tasks_set_defaults()
returns trigger
language plpgsql
as $$
begin
  -- Always update updated_at
  new.updated_at = now();
  
  -- Set created_at on INSERT
  if tg_op = 'INSERT' then
    new.created_at = coalesce(new.created_at, now());
  end if;

  -- AUTO-START on INSERT: if task is created with an assignee and is pending
  if tg_op = 'INSERT'
     and new.assignee_id is not null
     and new.started_at is null
     and new.status = 'pending'
  then
     new.status = 'in_progress';
     new.started_at = now();
     new.first_action_at = coalesce(new.first_action_at, now());
  end if;

  -- AUTO-START on UPDATE: assigned for the first time
  if tg_op = 'UPDATE'
     and old.assignee_id is null
     and new.assignee_id is not null
     and new.started_at is null
     and new.status = 'pending'
  then
     new.status = 'in_progress';
     new.started_at = now();
     new.first_action_at = coalesce(new.first_action_at, now());
  end if;

  -- For waiting tasks: just set started_at if assigned for first time (on UPDATE)
  if tg_op = 'UPDATE'
     and old.assignee_id is null
     and new.assignee_id is not null
     and new.started_at is null
     and new.status = 'waiting'
  then
     new.started_at = now();
  end if;

  -- Mark completed when moving to done
  if tg_op = 'UPDATE'
     and new.status = 'done'
     and old.status <> 'done'
  then
     new.completed_at = now();
  end if;

  -- Clear completed_at if reopening
  if tg_op = 'UPDATE'
     and old.status = 'done'
     and new.status <> 'done'
  then
     new.completed_at = null;
  end if;

  -- Manual start (play button): set started_at if moving to in_progress
  if tg_op = 'UPDATE'
     and new.status = 'in_progress'
     and old.status <> 'in_progress'
     and new.started_at is null
  then
     new.started_at = now();
     new.first_action_at = coalesce(new.first_action_at, now());
  end if;

  -- Track last_action_at on any status change
  if tg_op = 'UPDATE' and old.status <> new.status then
     new.last_action_at = now();
  end if;

  return new;
end;
$$;

-- Create triggers for both INSERT and UPDATE
create trigger trg_tasks_before_insert
before insert on public.tasks
for each row execute function public.tasks_set_defaults();

create trigger trg_tasks_before_update
before update on public.tasks
for each row execute function public.tasks_set_defaults();

-- Add comment
comment on function public.tasks_set_defaults() is 
'Manages task timestamps and auto-starts tasks when created with or assigned an owner';
