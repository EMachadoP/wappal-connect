-- Migration: Add auto-start when task is assigned for the first time
-- This modifies the existing trigger to auto-start tasks when assignee is set

-- Drop and recreate the trigger function with auto-start logic
create or replace function public.tasks_before_update_set_fields()
returns trigger
language plpgsql
as $$
begin
  -- Always update updated_at
  new.updated_at := now();

  -- Auto-start when:
  -- 1. Task is being assigned for the first time (old.assignee_id is NULL, new is not)
  -- 2. Task hasn't started yet (started_at is NULL)
  -- 3. Task is in pending status
  if old.assignee_id is null
     and new.assignee_id is not null
     and new.started_at is null
     and new.status = 'pending' then
    new.status := 'in_progress';
    new.started_at := now();
  end if;

  -- For waiting tasks: just set started_at if not set (don't change status)
  if old.assignee_id is null
     and new.assignee_id is not null
     and new.started_at is null
     and new.status = 'waiting' then
    new.started_at := now();
  end if;

  -- Track started_at when manually moving to in_progress
  if old.status <> 'in_progress' and new.status = 'in_progress' then
    if new.started_at is null then
      new.started_at := now();
    end if;
    new.first_action_at := coalesce(new.first_action_at, now());
  end if;

  -- Track completed_at when moving to done
  if old.status <> 'done' and new.status = 'done' then
    new.completed_at := now();
  end if;

  -- Clear completed_at if reopening
  if old.status = 'done' and new.status <> 'done' then
    new.completed_at := null;
  end if;

  -- Track last_action_at on any status change (except initial)
  if old.status <> new.status then
    new.last_action_at := now();
  end if;

  return new;
end;
$$;

-- Ensure trigger exists
drop trigger if exists tasks_before_update_set_fields on public.tasks;

create trigger tasks_before_update_set_fields
before update on public.tasks
for each row
execute procedure public.tasks_before_update_set_fields();

-- Add comment
comment on function public.tasks_before_update_set_fields() is 
'Auto-manages timestamps and auto-starts tasks when assigned for the first time';
