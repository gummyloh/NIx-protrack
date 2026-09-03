-- 016: Auto-compute a task's percent-complete from its linked punch items,
-- once it has any. Requested because real work on a module often runs
-- design and procurement side by side rather than in a fixed sequence, so
-- forcing progress through named stages doesn't fit -- but counting
-- "closed items out of linked items" doesn't assume any ordering at all,
-- so it fits parallel work just as well as sequential work.
--
-- Deliberately a DB trigger, not client-side logic: percent_complete stays
-- the one column every consumer already reads (Gantt, Task Table,
-- lib/schedule.ts status math, the publish/snapshot flow, PDF export) --
-- none of them need to know this exists. A task with zero linked punch
-- items is untouched and stays under manual control, same as today.

create or replace function nixma.recompute_task_percent_from_punch_items(p_task_id integer)
returns void
language plpgsql
security definer
set search_path = nixma
as $$
declare
  v_total integer;
  v_done integer;
  v_computed integer;
begin
  select count(*), count(*) filter (where status in ('closed', 'waived'))
    into v_total, v_done
  from nixma.punch_items
  where linked_task_id = p_task_id;

  -- No linked items (including "the last one was just unlinked/deleted"):
  -- leave percent_complete exactly as it is and let manual editing resume.
  if v_total = 0 then
    return;
  end if;

  v_computed := round(100.0 * v_done / v_total);

  update nixma.tasks
  set percent_complete = v_computed
  where id = p_task_id
    and percent_complete is distinct from v_computed;
end;
$$;

create or replace function nixma.trg_sync_task_percent_from_punch_items()
returns trigger
language plpgsql
security definer
set search_path = nixma
as $$
begin
  if tg_op = 'DELETE' then
    if old.linked_task_id is not null then
      perform nixma.recompute_task_percent_from_punch_items(old.linked_task_id);
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.linked_task_id is not null then
      perform nixma.recompute_task_percent_from_punch_items(new.linked_task_id);
    end if;
    return new;
  end if;

  -- UPDATE: covers both a status flip (open -> closed/waived/reopened) and
  -- re-pointing linked_task_id at a different task -- recompute whichever
  -- task(s) are actually affected.
  if new.linked_task_id is not null then
    perform nixma.recompute_task_percent_from_punch_items(new.linked_task_id);
  end if;
  if old.linked_task_id is not null and old.linked_task_id is distinct from new.linked_task_id then
    perform nixma.recompute_task_percent_from_punch_items(old.linked_task_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_punch_items_sync_task_percent on nixma.punch_items;
create trigger trg_punch_items_sync_task_percent
  after insert or update or delete on nixma.punch_items
  for each row
  execute function nixma.trg_sync_task_percent_from_punch_items();
