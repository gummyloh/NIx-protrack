-- Adds dependency tracking and a "current schedule" that's separate from the
-- original baseline. This is what makes downstream auto-shift possible while
-- still being able to answer "are we ahead or behind the ORIGINAL plan".
--
-- planned_start / planned_finish  = baseline (frozen, from Rev 0, never
--                                    auto-changed -- this is what "behind
--                                    schedule" is measured against)
-- scheduled_start / scheduled_finish = current live plan (shifts when a
--                                    predecessor's actual finish date moves)
-- actual_start / actual_finish    = what really happened (unchanged)
--
-- Run this after 001_schema.sql / 002_seed_liquick_go.sql, before
-- 004_seed_dependencies.sql.

alter table nixma.tasks
  add column if not exists predecessor_id integer references nixma.tasks(id),
  add column if not exists lag_days integer not null default 0,
  add column if not exists scheduled_start date,
  add column if not exists scheduled_finish date;

-- Initialize the current schedule to match baseline for every task that
-- doesn't have one yet (i.e. everything, on first run).
update nixma.tasks
set scheduled_start = planned_start,
    scheduled_finish = planned_finish
where scheduled_start is null;

alter table nixma.tasks
  alter column scheduled_start set not null,
  alter column scheduled_finish set not null;

create index if not exists idx_nixma_tasks_predecessor on nixma.tasks(predecessor_id);
