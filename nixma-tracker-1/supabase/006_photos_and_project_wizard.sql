-- Multi-project support: photos (internal archive) and a template-cloning
-- function so a new project can be created from the existing task
-- structure instead of rebuilding it by hand each time.

create table if not exists nixma.photos (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references nixma.projects(id) on delete cascade,
  task_id integer references nixma.tasks(id) on delete set null,
  storage_path text not null,
  caption text,
  taken_by text,
  taken_date date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists idx_photos_project on nixma.photos(project_id);

alter table nixma.photos enable row level security;

create policy "photos readable by anyone with anon key"
  on nixma.photos for select using (true);
create policy "photos insertable by anyone with anon key"
  on nixma.photos for insert with check (true);
create policy "photos deletable by anyone with anon key"
  on nixma.photos for delete using (true);

grant select, insert, delete on nixma.photos to anon, authenticated;

-- Clones every task from a source project into a brand-new project,
-- shifting all dates by the difference between the new kickoff date and
-- the source's earliest planned_start, and remapping task/predecessor/
-- parent IDs into a fresh block so they never collide with the source's.
-- Progress fields (percent_complete, actual_*, status_note, assignee) are
-- reset -- this is a fresh project, not a copy of someone's in-progress work.
create or replace function nixma.create_project_from_template(
  p_new_project_id text,
  p_name text,
  p_customer text,
  p_project_code text,
  p_kickoff_date date,
  p_customer_password text,
  p_source_project_id text default 'liquick-go-pack-n-seal'
) returns text
language plpgsql
security definer
set search_path = nixma
as $$
declare
  source_kickoff date;
  date_offset integer;
  id_offset integer;
  target_end date;
begin
  if exists (select 1 from nixma.projects where id = p_new_project_id) then
    raise exception 'Project id % already exists', p_new_project_id;
  end if;

  select min(planned_start) into source_kickoff
  from nixma.tasks where project_id = p_source_project_id;

  if source_kickoff is null then
    raise exception 'Source project % has no tasks to clone', p_source_project_id;
  end if;

  date_offset := p_kickoff_date - source_kickoff;

  select max(planned_finish) + date_offset into target_end
  from nixma.tasks where project_id = p_source_project_id;

  insert into nixma.projects (id, name, customer, project_code, kickoff_date, target_end_date, customer_password)
  values (p_new_project_id, p_name, p_customer, p_project_code, p_kickoff_date, target_end, p_customer_password);

  select coalesce(max(id), 0) into id_offset from nixma.tasks;

  insert into nixma.tasks (
    id, project_id, phase, task_no, description, duration_days,
    planned_start, planned_finish, indent_level, parent_id,
    department, is_summary, is_active, assignee,
    predecessor_id, lag_days, scheduled_start, scheduled_finish,
    actual_start, actual_finish, percent_complete, status_note,
    updated_by, updated_at
  )
  select
    t.id + id_offset,
    p_new_project_id,
    t.phase, t.task_no, t.description, t.duration_days,
    t.planned_start + date_offset,
    t.planned_finish + date_offset,
    t.indent_level,
    case when t.parent_id is null then null else t.parent_id + id_offset end,
    t.department, t.is_summary,
    true,   -- is_active: on by default, customize per-project in Task Table
    null,   -- assignee reset
    case when t.predecessor_id is null then null else t.predecessor_id + id_offset end,
    t.lag_days,
    t.planned_start + date_offset,   -- scheduled = planned on a fresh project
    t.planned_finish + date_offset,
    null, null, 0, null, null, null  -- actuals/progress/notes reset
  from nixma.tasks t
  where t.project_id = p_source_project_id;

  return p_new_project_id;
end;
$$;

grant execute on function nixma.create_project_from_template(text, text, text, text, date, text, text) to anon, authenticated;

create or replace function nixma.list_projects()
returns table (
  id text,
  name text,
  customer text,
  project_code text,
  kickoff_date date,
  target_buyoff_date date,
  target_end_date date,
  created_at timestamptz
)
language sql
security definer
set search_path = nixma
as $$
  select id, name, customer, project_code, kickoff_date, target_buyoff_date, target_end_date, created_at
  from nixma.projects
  order by created_at desc;
$$;

grant execute on function nixma.list_projects() to anon, authenticated;
