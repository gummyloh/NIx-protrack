-- 009: Close the anon-key cross-project hole, and stop storing customer
-- passwords in plain text.
--
-- BACKGROUND -- what was wrong:
-- Team members sign in with Supabase Auth, so RLS can check auth.uid()
-- against nixma.can_access_project() for them. Customers don't use Supabase
-- Auth at all (their session is a custom httpOnly cookie set by
-- /api/customer-login), so for a customer's browser auth.uid() is NULL.
-- To let the customer page's direct client-side Supabase calls work at
-- all, the "tasks readable/updatable", "projects readable", and "photos
-- insertable" policies were written as:
--     (auth.uid() IS NULL) OR nixma.can_access_project(...)
-- That first clause is true for EVERY anon-key caller, not just the one
-- customer who's actually logged in to their own project -- so anyone who
-- extracted the public anon key (trivial: it's in the deployed JS bundle)
-- could read or write ANY project's tasks, or any project's photos/project
-- row, not just their own. This migration removes that bypass entirely and
-- moves the customer-facing reads behind the same "verify the password
-- server-side, in a SECURITY DEFINER function" pattern the meeting-notes
-- feature already used correctly (see nixma.list_client_meeting_notes in
-- 005). New /api/customer-tasks and /api/customer-project routes (added in
-- this commit) call these from the server, the same way
-- /api/customer-meeting-notes already does.
--
-- Also switches nixma.projects.customer_password from plain text to a
-- pgcrypto bcrypt hash, since there's no reason to keep storing it in the
-- clear once every comparison goes through a function anyway.

create extension if not exists pgcrypto;

-- Supabase installs pgcrypto into the "extensions" schema, not "public" or
-- "nixma" -- every extensions.crypt()/extensions.gen_salt() call below is fully qualified as
-- extensions.crypt(...) so it resolves regardless of search_path, since
-- the SECURITY DEFINER functions below set search_path to just "nixma".

-- Hash any existing plaintext passwords in place. Safe to re-run: bcrypt
-- hashes always start with $2a$/$2b$/$2y$, so already-hashed rows are
-- left alone instead of being hashed twice.
update nixma.projects
set customer_password = extensions.crypt(customer_password, extensions.gen_salt('bf'))
where customer_password !~ '^\$2[aby]\$';

-- All password checks now compare via extensions.crypt(guess, stored_hash) = stored_hash
-- instead of straight equality.

create or replace function nixma.verify_customer_password(p_project_id text, p_password text)
returns boolean
language sql
security definer
set search_path = nixma
as $$
  select exists (
    select 1 from nixma.projects
    where id = p_project_id
      and customer_password = extensions.crypt(p_password, customer_password)
  );
$$;

create or replace function nixma.find_project_by_customer_password(p_password text)
returns text
language sql
security definer
set search_path = nixma
as $$
  select id from nixma.projects
  where customer_password = extensions.crypt(p_password, customer_password)
  limit 1;
$$;

create or replace function nixma.list_client_meeting_notes(p_project_id text, p_password text)
returns setof nixma.meeting_notes
language sql
security definer
set search_path = nixma
as $$
  select mn.* from nixma.meeting_notes mn
  where mn.project_id = p_project_id
    and mn.audience = 'client'
    and exists (
      select 1 from nixma.projects p
      where p.id = p_project_id and p.customer_password = extensions.crypt(p_password, p.customer_password)
    )
  order by mn.meeting_date desc, mn.created_at desc;
$$;

-- New: password-verified reads for the customer page's project header and
-- task list, replacing the direct anon-key table queries it used before.
create or replace function nixma.get_client_project(p_project_id text, p_password text)
returns table (
  name text,
  customer text,
  project_code text,
  kickoff_date date,
  target_buyoff_date date,
  target_end_date date
)
language sql
security definer
set search_path = nixma
as $$
  select p.name, p.customer, p.project_code, p.kickoff_date, p.target_buyoff_date, p.target_end_date
  from nixma.projects p
  where p.id = p_project_id
    and p.customer_password = extensions.crypt(p_password, p.customer_password);
$$;

grant execute on function nixma.get_client_project(text, text) to anon, authenticated;

create or replace function nixma.get_client_tasks(p_project_id text, p_password text)
returns setof nixma.tasks
language sql
security definer
set search_path = nixma
as $$
  select t.* from nixma.tasks t
  where t.project_id = p_project_id
    and t.is_active = true
    and exists (
      select 1 from nixma.projects p
      where p.id = p_project_id and p.customer_password = extensions.crypt(p_password, p.customer_password)
    )
  order by t.id;
$$;

grant execute on function nixma.get_client_tasks(text, text) to anon, authenticated;

-- Hash the password on creation instead of storing it as-typed.
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
  values (p_new_project_id, p_name, p_customer, p_project_code, p_kickoff_date, target_end, extensions.crypt(p_customer_password, extensions.gen_salt('bf')));

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

-- Tighten RLS: direct table access is now internal-team-only (authenticated
-- + project membership). Customers go through the password-verified RPCs
-- above instead of a direct anon-key table read/write.
drop policy if exists "tasks readable by project access" on nixma.tasks;
create policy "tasks readable by project members"
  on nixma.tasks for select
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));

drop policy if exists "tasks updatable by project members" on nixma.tasks;
create policy "tasks updatable by project members"
  on nixma.tasks for update
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()))
  with check (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));

drop policy if exists "projects readable by project access" on nixma.projects;
create policy "projects readable by project members"
  on nixma.projects for select
  using (auth.uid() is not null and nixma.can_access_project(id, auth.uid()));

drop policy if exists "photos insertable by project members" on nixma.photos;
create policy "photos insertable by project members"
  on nixma.photos for insert
  with check (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));

-- The project picker (/internal/projects) is an internal-only page --
-- scope it to what the caller can actually reach instead of returning
-- every project to any anon-key holder. Admins still see everything,
-- members see only projects they've been added to.
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
  where auth.uid() is not null and nixma.can_access_project(id, auth.uid())
  order by created_at desc;
$$;
