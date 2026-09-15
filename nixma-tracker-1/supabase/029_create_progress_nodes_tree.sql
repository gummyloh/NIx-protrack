-- Generic, arbitrary-depth, per-discipline work-breakdown tree for
-- fact-checked progress ("what % of drawing 120 is actually done",
-- confirmed with whoever's doing the work) -- distinct from
-- modules/stations, which drive the physical assembly-readiness gate in
-- Module Rollup, a different question. parent_id self-references the same
-- table (on delete cascade, so deleting a branch removes everything under
-- it in one call). percent_complete is only meaningful on leaves -- a node
-- with children always shows a *computed* average of its children in the
-- app, never a stored value; nothing in this schema enforces that, it's
-- an application-level rule (see lib/progressRollup.ts).
create table if not exists nixma.progress_nodes (
  id bigint generated always as identity primary key,
  project_id text not null,
  discipline text not null,
  parent_id bigint references nixma.progress_nodes(id) on delete cascade,
  name text not null,
  sequence integer not null default 0,
  percent_complete integer check (percent_complete between 0 and 100),
  confirmed_by text,
  updated_by uuid,
  updated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists progress_nodes_project_discipline_idx
  on nixma.progress_nodes (project_id, discipline);
create index if not exists progress_nodes_parent_idx
  on nixma.progress_nodes (parent_id);

alter table nixma.progress_nodes enable row level security;

drop policy if exists "progress nodes readable by project members" on nixma.progress_nodes;
create policy "progress nodes readable by project members"
  on nixma.progress_nodes for select
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));

drop policy if exists "progress nodes writable by project members" on nixma.progress_nodes;
create policy "progress nodes writable by project members"
  on nixma.progress_nodes for all
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()))
  with check (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));
