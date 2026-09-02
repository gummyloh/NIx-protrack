-- 014: Machine readiness -- Module / Station / Punch List (Phase 9 of the
-- app roadmap). Adds a genuinely new source of truth alongside the
-- schedule (tasks): whether the physical machine is actually ready to
-- ship, independent of how far along the task list looks.
--
-- Deliberately modeled as a generic, data-driven hierarchy
-- (Project -> Modules -> Stations -> Punch items) rather than anything
-- specific to this project's module names -- Teleflex's "Pouch Loading /
-- Rotary Indexer / Packing & Sealing" are just rows a team member types
-- in, same as a future project's "Loading / Vision Inspection / Leak Test
-- / Reject" would be. No code differences between projects, ever.

-- ---------------------------------------------------------------------
-- 1. The hierarchy. project_id is denormalized onto stations and
--    punch_items (in addition to the module_id/station_id chain) purely
--    so RLS policies and everyday queries stay a single equality check
--    instead of a join -- the same choice already made for task_history.
-- ---------------------------------------------------------------------

create table if not exists nixma.modules (
  id bigserial primary key,
  project_id text not null references nixma.projects(id) on delete cascade,
  name text not null,
  sequence integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_modules_project on nixma.modules(project_id, sequence);

create table if not exists nixma.stations (
  id bigserial primary key,
  module_id bigint not null references nixma.modules(id) on delete cascade,
  project_id text not null references nixma.projects(id) on delete cascade,
  name text not null,
  sequence integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_stations_module on nixma.stations(module_id, sequence);
create index if not exists idx_stations_project on nixma.stations(project_id);

-- severity: only "blocker" gates a station's readiness -- "minor" and
-- "cosmetic" stay visible as open work without turning the whole station
-- red, so the readiness signal doesn't get noisy enough to ignore.
-- status: "waived" is distinct from "closed" (acknowledged/accepted as-is
-- vs actually fixed) but counts the same as closed for readiness -- both
-- just stop blocking.
create table if not exists nixma.punch_items (
  id bigserial primary key,
  station_id bigint not null references nixma.stations(id) on delete cascade,
  project_id text not null references nixma.projects(id) on delete cascade,
  description text not null,
  severity text not null default 'minor' check (severity in ('blocker', 'minor', 'cosmetic')),
  status text not null default 'open' check (status in ('open', 'closed', 'waived')),
  -- Opt-in, unlike tasks.show_to_client (which defaults true). A punch
  -- item's text often contains unflattering internal detail ("vendor
  -- shipped wrong part") that shouldn't reach the client just because the
  -- module's rollup color does -- the rollup state is always visible in a
  -- published snapshot regardless of this flag; only the item text itself
  -- is gated by it.
  show_to_client boolean not null default false,
  -- A punch item significant enough to need real planning can point at a
  -- full task; most don't need one. Nullable both ways -- deleting the
  -- linked task just detaches it rather than losing the punch item.
  linked_task_id integer references nixma.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_punch_items_station on nixma.punch_items(station_id);
create index if not exists idx_punch_items_project on nixma.punch_items(project_id, status);

-- ---------------------------------------------------------------------
-- 2. RLS -- same "any project member can read and write" shape as tasks
--    (nixma.can_access_project), not admin-only: whoever's actually doing
--    FAT prep on the floor needs to log and close items directly.
-- ---------------------------------------------------------------------

alter table nixma.modules enable row level security;
create policy "modules readable by project members"
  on nixma.modules for select
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));
create policy "modules writable by project members"
  on nixma.modules for all
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()))
  with check (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));

alter table nixma.stations enable row level security;
create policy "stations readable by project members"
  on nixma.stations for select
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));
create policy "stations writable by project members"
  on nixma.stations for all
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()))
  with check (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));

alter table nixma.punch_items enable row level security;
create policy "punch items readable by project members"
  on nixma.punch_items for select
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));
create policy "punch items writable by project members"
  on nixma.punch_items for all
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()))
  with check (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));

grant select, insert, update, delete on nixma.modules to authenticated;
grant select, insert, update, delete on nixma.stations to authenticated;
grant select, insert, update, delete on nixma.punch_items to authenticated;
grant usage, select on sequence nixma.modules_id_seq to authenticated;
grant usage, select on sequence nixma.stations_id_seq to authenticated;
grant usage, select on sequence nixma.punch_items_id_seq to authenticated;

-- ---------------------------------------------------------------------
-- 3. Closing/waiving a punch item stamps who and when, the same
--    "record the fact, don't make the caller pass it in" pattern as
--    publish_client_update stamping published_by from auth.uid().
-- ---------------------------------------------------------------------

create or replace function nixma.set_punch_item_status(
  p_punch_item_id bigint,
  p_status text
) returns void
language plpgsql
security definer
set search_path = nixma
as $$
declare
  v_project_id text;
begin
  if p_status not in ('open', 'closed', 'waived') then
    raise exception 'Invalid status %', p_status;
  end if;

  select project_id into v_project_id from nixma.punch_items where id = p_punch_item_id;
  if v_project_id is null then
    raise exception 'Punch item % not found', p_punch_item_id;
  end if;
  if auth.uid() is null or not nixma.can_access_project(v_project_id, auth.uid()) then
    raise exception 'Not authorized for this project';
  end if;

  update nixma.punch_items
  set status = p_status,
      closed_at = case when p_status = 'open' then null else now() end,
      closed_by = case when p_status = 'open' then null else auth.uid() end
  where id = p_punch_item_id;
end;
$$;

grant execute on function nixma.set_punch_item_status(bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Cloning modules/stations from an existing project -- the "repeat
--    project, similar machine shape" path. Punch items are deliberately
--    never cloned (they're specific defects on one build, not reusable
--    structure). Admin-only, matching who can create projects at all.
-- ---------------------------------------------------------------------

create or replace function nixma.clone_modules_from_project(
  p_source_project_id text,
  p_target_project_id text
) returns integer
language plpgsql
security definer
set search_path = nixma
as $$
declare
  v_module record;
  v_new_module_id bigint;
  v_count integer := 0;
begin
  if not nixma.is_approved_admin(auth.uid()) then
    raise exception 'Only admins can clone modules';
  end if;
  if not nixma.can_access_project(p_source_project_id, auth.uid())
    or not nixma.can_access_project(p_target_project_id, auth.uid()) then
    raise exception 'Not authorized for one of these projects';
  end if;
  if exists (select 1 from nixma.modules where project_id = p_target_project_id) then
    raise exception 'Target project already has modules -- cloning only applies to an empty module list';
  end if;

  for v_module in
    select * from nixma.modules where project_id = p_source_project_id order by sequence, id
  loop
    insert into nixma.modules (project_id, name, sequence)
    values (p_target_project_id, v_module.name, v_module.sequence)
    returning id into v_new_module_id;

    insert into nixma.stations (module_id, project_id, name, sequence)
    select v_new_module_id, p_target_project_id, s.name, s.sequence
    from nixma.stations s
    where s.module_id = v_module.id
    order by s.sequence, s.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function nixma.clone_modules_from_project(text, text) to authenticated;
