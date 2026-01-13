-- DASHBOARD: métricas gerais (1 linha)
create or replace view public.task_metrics_dashboard as
with bounds as (
  select
    (date_trunc('day', timezone('America/Recife', now())) at time zone 'America/Recife') as day_start_utc,
    ((date_trunc('day', timezone('America/Recife', now())) + interval '1 day') at time zone 'America/Recife') as day_end_utc
)
select
  -- abertas (inclui waiting)
  count(*) filter (where t.status in ('pending','in_progress','waiting'))::bigint as open_tasks,

  -- atrasadas pelo prazo final (due_at)
  count(*) filter (
    where t.status not in ('done','cancelled')
      and t.due_at is not null
      and t.due_at < now()
  )::bigint as overdue_tasks,

  -- follow-ups vencidos (remind_at)
  count(*) filter (
    where t.status in ('pending','in_progress','waiting')
      and t.remind_at is not null
      and t.remind_at < now()
  )::bigint as followups_due,

  -- concluídas "hoje" (considerando America/Recife)
  count(*) filter (
    where t.status = 'done'
      and t.completed_at is not null
      and t.completed_at >= b.day_start_utc
      and t.completed_at <  b.day_end_utc
  )::bigint as done_today,

  -- tempo médio de resolução (últimos 7 dias, em segundos)
  coalesce(
    avg(extract(epoch from (t.completed_at - t.created_at)))
      filter (where t.status = 'done' and t.completed_at >= now() - interval '7 days'),
    0
  )::numeric as avg_resolution_seconds_7d

from public.tasks t
cross join bounds b;

grant select on public.task_metrics_dashboard to authenticated;

-- POR AGENTE: lista (assignee) com métricas + média de resolução configurável
create or replace function public.task_metrics_by_assignee(p_days int default 7)
returns table (
  assignee_id uuid,
  assignee_name text,
  open_tasks bigint,
  overdue_tasks bigint,
  followups_due bigint,
  done_today bigint,
  avg_resolution_seconds numeric
)
language sql
stable
as $$
with bounds as (
  select
    (date_trunc('day', timezone('America/Recife', now())) at time zone 'America/Recife') as day_start_utc,
    ((date_trunc('day', timezone('America/Recife', now())) + interval '1 day') at time zone 'America/Recife') as day_end_utc
),
base as (
  select
    t.*,
    coalesce(p.name, 'Não atribuída') as assignee_name
  from public.tasks t
  left join public.profiles p on p.id = t.assignee_id
)
select
  b.assignee_id,
  b.assignee_name,

  count(*) filter (where b.status in ('pending','in_progress','waiting'))::bigint as open_tasks,

  count(*) filter (
    where b.status not in ('done','cancelled')
      and b.due_at is not null
      and b.due_at < now()
  )::bigint as overdue_tasks,

  count(*) filter (
    where b.status in ('pending','in_progress','waiting')
      and b.remind_at is not null
      and b.remind_at < now()
  )::bigint as followups_due,

  count(*) filter (
    where b.status = 'done'
      and b.completed_at is not null
      and b.completed_at >= (select day_start_utc from bounds)
      and b.completed_at <  (select day_end_utc   from bounds)
  )::bigint as done_today,

  coalesce(
    avg(extract(epoch from (b.completed_at - b.created_at)))
      filter (where b.status = 'done'
              and b.completed_at is not null
              and b.completed_at >= now() - (p_days::text || ' days')::interval),
    0
  )::numeric as avg_resolution_seconds

from base b
group by b.assignee_id, b.assignee_name
order by
  open_tasks desc,
  overdue_tasks desc,
  b.assignee_name asc;
$$;

grant execute on function public.task_metrics_by_assignee(int) to authenticated;
