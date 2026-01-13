-- 1) Enums (evita typo em status/priority)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type public.task_status as enum ('pending', 'in_progress', 'waiting', 'done', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'task_priority') then
    create type public.task_priority as enum ('low', 'normal', 'high', 'urgent');
  end if;
end $$;

-- 2) Tabela
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),

  -- opcional: tarefa independente da conversa
  conversation_id uuid references public.conversations(id) on delete set null,

  title text not null,
  description text,

  status public.task_status not null default 'pending',
  priority public.task_priority not null default 'normal',

  assignee_id uuid references public.profiles(id) on delete set null,

  -- prazo "final"
  due_at timestamptz,

  -- (recomendado) quando lembrar / follow-up, sem misturar com prazo final
  remind_at timestamptz,

  started_at timestamptz,
  completed_at timestamptz,

  created_by uuid references public.profiles(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  first_action_at timestamptz,
  last_action_at timestamptz,

  external_ref text
);

-- 3) Índices (inclui composto pro caso "minhas pendentes por data")
create index if not exists idx_tasks_assignee on public.tasks(assignee_id);
create index if not exists idx_tasks_conversation on public.tasks(conversation_id);
create index if not exists idx_tasks_status on public.tasks(status);
create index if not exists idx_tasks_due_at on public.tasks(due_at);
create index if not exists idx_tasks_assignee_status_due on public.tasks(assignee_id, status, due_at);

-- 4) Trigger function: timestamps + started/completed + first/last action
create or replace function public.tasks_before_update_set_fields()
returns trigger
language plpgsql
as $$
begin
  -- sempre atualiza updated_at
  new.updated_at := now();

  -- marca "last_action" em qualquer update (pode refinar depois)
  new.last_action_at := now();

  -- first_action_at: primeira vez que alguém mexe de verdade na task
  if old.first_action_at is null then
    if (new.status is distinct from old.status)
       or (new.assignee_id is distinct from old.assignee_id)
       or (new.due_at is distinct from old.due_at)
       or (new.remind_at is distinct from old.remind_at)
       or (new.title is distinct from old.title)
       or (new.description is distinct from old.description)
    then
      new.first_action_at := now();
    end if;
  end if;

  -- status -> started_at
  if new.status = 'in_progress' and old.status is distinct from new.status and new.started_at is null then
    new.started_at := now();
  end if;

  -- status -> completed_at
  if new.status = 'done' and old.status is distinct from new.status then
    if new.completed_at is null then
      new.completed_at := now();
    end if;
  end if;

  -- se reabrir a task, limpa completed_at (opcional, mas costuma ajudar)
  if old.status = 'done' and new.status is distinct from old.status and new.status <> 'done' then
    new.completed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tasks_before_update_set_fields on public.tasks;
create trigger trg_tasks_before_update_set_fields
before update on public.tasks
for each row
execute function public.tasks_before_update_set_fields();

-- 5) RLS (mais prático que "assignee only")
alter table public.tasks enable row level security;

-- SELECT: app interno => ok liberar para authenticated
create policy "tasks_select_authenticated"
on public.tasks
for select
to authenticated
using (true);

-- INSERT: exige created_by = auth.uid()
create policy "tasks_insert_own"
on public.tasks
for insert
to authenticated
with check (created_by = auth.uid());

-- UPDATE: assignee OU criador
create policy "tasks_update_assignee_or_creator"
on public.tasks
for update
to authenticated
using (assignee_id = auth.uid() or created_by = auth.uid())
with check (assignee_id = auth.uid() or created_by = auth.uid());

-- DELETE: somente criador
create policy "tasks_delete_creator"
on public.tasks
for delete
to authenticated
using (created_by = auth.uid());
