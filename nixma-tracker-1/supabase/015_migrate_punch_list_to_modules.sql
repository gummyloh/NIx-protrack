-- 015: Migrate the already-live Teleflex punch list (nixma.punch_list_items,
-- imported ad hoc into a flat table+page while Phase 9 was being designed
-- in parallel elsewhere) into the generic modules/stations/punch_items
-- hierarchy added in 014. This gives the existing 60 real punch items
-- readiness gating (blocker/minor/cosmetic -> ready/not-ready), per-item
-- client visibility, and reusable module/station templates for future
-- projects -- none of which the flat table supported.
--
-- nixma.punch_list_items itself is left in place, untouched, as a
-- historical backup. Nothing is dropped.

-- ---------------------------------------------------------------------
-- 1. Carry over the flat table's richer per-item fields onto punch_items.
--    These are optional everywhere: a punch item logged fresh from the
--    Modules page only needs description + severity, but migrated rows
--    keep their original detail (category, priority, target date, PIC,
--    remarks, acceptance criteria) rather than losing it.
-- ---------------------------------------------------------------------

alter table nixma.punch_items
  add column if not exists item_no integer,
  add column if not exists category text,
  add column if not exists priority text,
  add column if not exists percent_complete integer,
  add column if not exists target_date date,
  add column if not exists pic text,
  add column if not exists remarks text,
  add column if not exists acceptance_criteria text,
  add column if not exists source text not null default 'manual';

-- Lets the migration below (and any future clone/import) use ON CONFLICT
-- to stay idempotent instead of hand-rolled existence checks per row.
alter table nixma.modules
  add constraint modules_project_name_unique unique (project_id, name);
alter table nixma.stations
  add constraint stations_module_name_unique unique (module_id, name);

-- ---------------------------------------------------------------------
-- 2. One-time data migration. Safe to re-run: it skips entirely once this
--    project already has punch_items rows.
-- ---------------------------------------------------------------------

do $$
declare
  v_project_id text := 'liquick-go-pack-n-seal';
  v_module record;
  v_new_module_id bigint;
  v_station record;
  v_new_station_id bigint;
  v_item record;
begin
  if exists (select 1 from nixma.punch_items where project_id = v_project_id) then
    return;
  end if;

  for v_module in
    select module as name, min(item_no) as first_item_no
    from nixma.punch_list_items
    where project_id = v_project_id
    group by module
    order by min(item_no)
  loop
    insert into nixma.modules (project_id, name, sequence)
    values (v_project_id, v_module.name, v_module.first_item_no)
    on conflict (project_id, name) do update set name = excluded.name
    returning id into v_new_module_id;

    for v_station in
      select station as name, min(item_no) as first_item_no
      from nixma.punch_list_items
      where project_id = v_project_id and module = v_module.name
      group by station
      order by min(item_no)
    loop
      insert into nixma.stations (module_id, project_id, name, sequence)
      values (v_new_module_id, v_project_id, v_station.name, v_station.first_item_no)
      on conflict (module_id, name) do update set name = excluded.name
      returning id into v_new_station_id;

      for v_item in
        select *
        from nixma.punch_list_items
        where project_id = v_project_id
          and module = v_module.name
          and station = v_station.name
        order by item_no
      loop
        -- Original priorities skew High-heavy (26 High + 5 Critical out of
        -- 60), which is realistic for an early-stage build where almost
        -- nothing is finished yet -- most stations correctly show
        -- "not ready" right now, the same as the flat table's RAG view did.
        insert into nixma.punch_items (
          station_id, project_id, description, severity, status,
          show_to_client, item_no, category, priority, percent_complete,
          target_date, pic, remarks, acceptance_criteria, source, created_at
        ) values (
          v_new_station_id,
          v_project_id,
          v_item.item_scope,
          case v_item.priority
            when 'Critical' then 'blocker'
            when 'High' then 'blocker'
            when 'Medium' then 'minor'
            else 'cosmetic'
          end,
          case v_item.status when 'Completed' then 'closed' else 'open' end,
          false,
          v_item.item_no,
          v_item.category,
          v_item.priority,
          v_item.percent_complete,
          v_item.target_date,
          v_item.pic,
          v_item.remarks,
          v_item.acceptance_criteria,
          v_item.source,
          v_item.created_at
        );
      end loop;
    end loop;
  end loop;
end $$;
