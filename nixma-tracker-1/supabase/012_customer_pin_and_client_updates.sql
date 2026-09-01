-- 012: Replace free-text customer passwords with a system-generated 6-digit
-- PIN, and switch the customer-facing progress view from "live query,
-- scoped by RLS" to "admin publishes a curated snapshot, customer sees the
-- last one published."
--
-- Why: a typed password is one more thing for the team to invent and the
-- client to type; a short PIN the system generates is simpler on both ends
-- and just as effective given login is already rate-limited. And a live
-- view means the client sees literally everything the second it changes,
-- with no way to hold back an internal-only line item (a vendor
-- negotiation, a task worth explaining before it's just visible) -- a
-- publish step gives the team a deliberate "this is what the client sees
-- right now" moment instead.

-- ---------------------------------------------------------------------
-- 1. Per-task "include in the next client update" flag. Defaults to true
--    so existing behavior (everything visible) doesn't silently change
--    for projects that never touch this.
-- ---------------------------------------------------------------------
alter table nixma.tasks
  add column if not exists show_to_client boolean not null default true;

-- ---------------------------------------------------------------------
-- 2. Published snapshots. The team computes the whole payload client-side
--    (reusing the same schedule math the Task Table already uses) and
--    this just stores + timestamps it -- no need to re-derive "days
--    behind schedule" logic in SQL.
-- ---------------------------------------------------------------------
create table if not exists nixma.client_updates (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references nixma.projects(id) on delete cascade,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete set null,
  note text,
  snapshot jsonb not null
);

create index if not exists idx_client_updates_project_time
  on nixma.client_updates(project_id, published_at desc);

alter table nixma.client_updates enable row level security;

create policy "client updates readable by project members"
  on nixma.client_updates for select
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));

create or replace function nixma.publish_client_update(
  p_project_id text,
  p_note text,
  p_snapshot jsonb
) returns uuid
language plpgsql
security definer
set search_path = nixma
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null or not nixma.can_access_project(p_project_id, auth.uid()) then
    raise exception 'Not authorized for project %', p_project_id;
  end if;

  insert into nixma.client_updates (project_id, published_by, note, snapshot)
  values (p_project_id, auth.uid(), p_note, p_snapshot)
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function nixma.publish_client_update(text, text, jsonb) to authenticated;

-- Password-verified read of the latest published update -- this is what
-- the customer page now renders instead of live task queries.
create or replace function nixma.get_latest_client_update(p_project_id text, p_password text)
returns table (published_at timestamptz, note text, snapshot jsonb)
language sql
security definer
set search_path = nixma
as $$
  select u.published_at, u.note, u.snapshot
  from nixma.client_updates u
  where u.project_id = p_project_id
    and exists (
      select 1 from nixma.projects p
      where p.id = p_project_id and p.customer_password = extensions.crypt(p_password, p.customer_password)
    )
  order by u.published_at desc
  limit 1;
$$;

grant execute on function nixma.get_latest_client_update(text, text) to anon, authenticated;

-- Superseded by the snapshot flow above -- the customer page no longer
-- reads live tasks directly.
drop function if exists nixma.get_client_tasks(text, text);

-- ---------------------------------------------------------------------
-- 3. PIN generation + reset. A short numeric PIN is easy to generate
--    collision-free: try random 6-digit strings until one doesn't match
--    any existing hash (bcrypt-comparing against every row, but there are
--    only ever a handful of projects, so this is cheap).
-- ---------------------------------------------------------------------
create or replace function nixma.generate_unique_customer_pin()
returns text
language plpgsql
security definer
set search_path = nixma
as $$
declare
  candidate text;
  attempt int := 0;
begin
  loop
    candidate := lpad((floor(random() * 1000000))::int::text, 6, '0');
    attempt := attempt + 1;
    exit when not exists (
      select 1 from nixma.projects
      where customer_password = extensions.crypt(candidate, customer_password)
    );
    if attempt >= 20 then
      raise exception 'Could not generate a unique customer PIN after % attempts', attempt;
    end if;
  end loop;
  return candidate;
end;
$$;

-- Regenerates a project's PIN on demand (e.g. the admin lost it, or wants
-- to revoke the old one). Returns the new PIN in plaintext -- this is the
-- only moment it's ever visible again after creation.
create or replace function nixma.reset_customer_pin(p_project_id text)
returns text
language plpgsql
security definer
set search_path = nixma
as $$
declare
  new_pin text;
begin
  if auth.uid() is null or not nixma.can_access_project(p_project_id, auth.uid()) then
    raise exception 'Not authorized for project %', p_project_id;
  end if;

  new_pin := nixma.generate_unique_customer_pin();

  update nixma.projects
  set customer_password = extensions.crypt(new_pin, extensions.gen_salt('bf'))
  where id = p_project_id;

  if not found then
    raise exception 'Project % not found', p_project_id;
  end if;

  return new_pin;
end;
$$;

grant execute on function nixma.reset_customer_pin(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. create_project_from_template no longer takes an admin-typed
--    password -- it generates its own PIN and hands it back once, the
--    same as reset_customer_pin. Also closes a gap noticed in passing:
--    the old version had no auth check at all (callable by anyone with
--    the anon key, not just logged-in team members) and was granted to
--    anon -- both fixed here.
-- ---------------------------------------------------------------------
drop function if exists nixma.create_project_from_template(text, text, text, text, date, text, text);

create or replace function nixma.create_project_from_template(
  p_new_project_id text,
  p_name text,
  p_customer text,
  p_project_code text,
  p_kickoff_date date,
  p_source_project_id text default 'liquick-go-pack-n-seal'
) returns table (project_id text, customer_pin text)
language plpgsql
security definer
set search_path = nixma
as $$
declare
  source_kickoff date;
  date_offset integer;
  id_offset integer;
  target_end date;
  new_pin text;
begin
  if auth.uid() is null then
    raise exception 'Not authorized';
  end if;

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

  new_pin := nixma.generate_unique_customer_pin();

  insert into nixma.projects (id, name, customer, project_code, kickoff_date, target_end_date, customer_password)
  values (p_new_project_id, p_name, p_customer, p_project_code, p_kickoff_date, target_end, extensions.crypt(new_pin, extensions.gen_salt('bf')));

  select coalesce(max(id), 0) into id_offset from nixma.tasks;

  insert into nixma.tasks (
    id, project_id, phase, task_no, description, duration_days,
    planned_start, planned_finish, indent_level, parent_id,
    department, is_summary, is_active, assignee,
    predecessor_id, lag_days, scheduled_start, scheduled_finish,
    actual_start, actual_finish, percent_complete, status_note,
    updated_by, updated_at, show_to_client
  )
  select
    t.id + id_offset, p_new_project_id, t.phase, t.task_no, t.description, t.duration_days,
    t.planned_start + date_offset, t.planned_finish + date_offset, t.indent_level,
    case when t.parent_id is null then null else t.parent_id + id_offset end,
    t.department, t.is_summary, true, null,
    case when t.predecessor_id is null then null else t.predecessor_id + id_offset end,
    t.lag_days, t.planned_start + date_offset, t.planned_finish + date_offset,
    null, null, 0, null, null, null, true
  from nixma.tasks t where t.project_id = p_source_project_id;

  return query select p_new_project_id, new_pin;
end;
$$;

grant execute on function nixma.create_project_from_template(text, text, text, text, date, text) to authenticated;
