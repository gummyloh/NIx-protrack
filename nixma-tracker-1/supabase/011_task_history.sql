-- 011: Schedule change history. Nothing today records who moved a date or
-- when -- once a task's scheduled_finish gets dragged in the Gantt or
-- edited in the Task Table, the previous value is just gone. This adds an
-- append-only log of the fields people actually care about (dates,
-- progress, status note, assignee, active/inactive) so a project lead can
-- answer "when did this slip, and by how much" after the fact.

create table if not exists nixma.task_history (
  id bigserial primary key,
  task_id integer not null references nixma.tasks(id) on delete cascade,
  project_id text not null references nixma.projects(id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null,
  field text not null,
  old_value text,
  new_value text
);

create index if not exists idx_task_history_task on nixma.task_history(task_id, changed_at desc);
create index if not exists idx_task_history_project on nixma.task_history(project_id, changed_at desc);

alter table nixma.task_history enable row level security;

create policy "task history readable by project members"
  on nixma.task_history for select
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));

-- Logs one row per changed tracked field, not one row per update -- makes
-- "show me every change to this task's finish date" a plain filter instead
-- of having to diff JSON blobs.
create or replace function nixma.log_task_change()
returns trigger
language plpgsql
security definer
set search_path = nixma
as $$
begin
  if new.scheduled_start is distinct from old.scheduled_start then
    insert into nixma.task_history (task_id, project_id, changed_by, field, old_value, new_value)
    values (new.id, new.project_id, auth.uid(), 'scheduled_start', old.scheduled_start::text, new.scheduled_start::text);
  end if;
  if new.scheduled_finish is distinct from old.scheduled_finish then
    insert into nixma.task_history (task_id, project_id, changed_by, field, old_value, new_value)
    values (new.id, new.project_id, auth.uid(), 'scheduled_finish', old.scheduled_finish::text, new.scheduled_finish::text);
  end if;
  if new.percent_complete is distinct from old.percent_complete then
    insert into nixma.task_history (task_id, project_id, changed_by, field, old_value, new_value)
    values (new.id, new.project_id, auth.uid(), 'percent_complete', old.percent_complete::text, new.percent_complete::text);
  end if;
  if new.assignee is distinct from old.assignee then
    insert into nixma.task_history (task_id, project_id, changed_by, field, old_value, new_value)
    values (new.id, new.project_id, auth.uid(), 'assignee', old.assignee, new.assignee);
  end if;
  if new.status_note is distinct from old.status_note then
    insert into nixma.task_history (task_id, project_id, changed_by, field, old_value, new_value)
    values (new.id, new.project_id, auth.uid(), 'status_note', old.status_note, new.status_note);
  end if;
  if new.is_active is distinct from old.is_active then
    insert into nixma.task_history (task_id, project_id, changed_by, field, old_value, new_value)
    values (new.id, new.project_id, auth.uid(), 'is_active', old.is_active::text, new.is_active::text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_task_change on nixma.tasks;
create trigger trg_log_task_change
  after update on nixma.tasks
  for each row
  execute function nixma.log_task_change();

-- Convenience read: history for one task, newest first, with the acting
-- user's name resolved instead of a bare uuid.
create or replace function nixma.get_task_history(p_task_id integer)
returns table (
  id bigint,
  changed_at timestamptz,
  changed_by_name text,
  field text,
  old_value text,
  new_value text
)
language sql
security definer
set search_path = nixma
as $$
  select h.id, h.changed_at,
         coalesce(p.full_name, p.email, 'Someone'),
         h.field, h.old_value, h.new_value
  from nixma.task_history h
  left join nixma.profiles p on p.id = h.changed_by
  join nixma.tasks t on t.id = h.task_id
  where h.task_id = p_task_id
    and auth.uid() is not null
    and nixma.can_access_project(t.project_id, auth.uid())
  order by h.changed_at desc;
$$;

grant execute on function nixma.get_task_history(integer) to authenticated;
