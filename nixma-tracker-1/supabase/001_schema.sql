-- Nixma Project Tracker schema
-- Designed to live inside an EXISTING Supabase project (e.g. VelSpec's or
-- PricePoint's) without touching or colliding with that project's own
-- tables. Everything below lives in its own "nixma" schema.
--
-- Run this once (SQL Editor or `apply_migration`), then run
-- 002_seed_liquick_go.sql.
--
-- AFTER running both files: go to Project Settings -> API -> Exposed
-- schemas, and add "nixma" to the list (alongside "public"). PostgREST
-- only serves schemas you explicitly expose, so this app's API calls will
-- 404 until you do this — it's a one-time checkbox, not a code change.

create schema if not exists nixma;

create table if not exists nixma.projects (
  id text primary key,               -- e.g. 'liquick-go-pack-n-seal'
  name text not null,
  customer text not null,
  project_code text,
  kickoff_date date,
  target_buyoff_date date,
  target_end_date date,
  customer_password text not null,   -- plain text is fine for a low-stakes internal tool;
                                      -- swap for a hash if this ever needs to be hardened
  created_at timestamptz default now()
);

create table if not exists nixma.tasks (
  id integer primary key,            -- matches the uid from the source Gantt extraction
  project_id text not null references nixma.projects(id) on delete cascade,
  phase integer not null,            -- 1 = Kick-off to Buy-off, 2 = Buy-off to Close
  task_no integer not null,
  description text not null,
  duration_days integer not null,
  planned_start date not null,
  planned_finish date not null,
  indent_level integer not null default 0,
  parent_id integer references nixma.tasks(id),
  department text not null,
  is_summary boolean not null default false,
  assignee text,                     -- lightweight, free-text -- no login/auth yet

  -- fields department leads update
  actual_start date,
  actual_finish date,
  percent_complete integer not null default 0 check (percent_complete between 0 and 100),
  status_note text,
  updated_by text,
  updated_at timestamptz
);

create index if not exists idx_nixma_tasks_project on nixma.tasks(project_id);
create index if not exists idx_nixma_tasks_department on nixma.tasks(department);

-- Row Level Security: reads are open (anon key), writes are open for now too
-- since department leads have no individual login yet (Phase 1 decision).
-- Tighten this once individual auth is added.
alter table nixma.projects enable row level security;
alter table nixma.tasks enable row level security;

create policy "projects readable by anyone with anon key"
  on nixma.projects for select using (true);

create policy "tasks readable by anyone with anon key"
  on nixma.tasks for select using (true);

create policy "tasks updatable by anyone with anon key"
  on nixma.tasks for update using (true);

-- A custom schema has no default privileges the way "public" does in a
-- fresh Supabase project, so the anon/authenticated roles need explicit
-- grants here — RLS policies alone aren't enough without these.
grant usage on schema nixma to anon, authenticated;
grant select, update on nixma.tasks to anon, authenticated;

-- IMPORTANT: grant SELECT on only the columns safe to expose, not the whole
-- table. A table-wide "grant select on nixma.projects" followed by a
-- column-level "revoke select (customer_password)" does NOT work in
-- Postgres — the table-wide grant already covers every column, and a
-- column-level revoke can't carve out an exception from it. Granting only
-- these named columns is the only way that actually blocks the password
-- from being readable via the anon key.
grant select (id, name, customer, project_code, kickoff_date, target_buyoff_date, target_end_date, created_at)
  on nixma.projects to anon, authenticated;

-- Server-side password check: takes a plain-text guess, returns true/false.
-- Runs with the privileges of the function owner (which can read the column),
-- so the anon key never needs direct column access to verify a guess.
create or replace function nixma.verify_customer_password(p_project_id text, p_password text)
returns boolean
language sql
security definer
set search_path = nixma
as $$
  select exists (
    select 1 from nixma.projects
    where id = p_project_id
      and customer_password = p_password
  );
$$;

grant execute on function nixma.verify_customer_password(text, text) to anon, authenticated;
