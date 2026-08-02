-- Inferred FS (finish-to-start) dependencies for the Liquick GO Pack N Seal
-- schedule, derived from date-adjacency in the original Rev 0 Gantt: task B's
-- predecessor is task A when A's planned_finish is the same day or the day
-- before B's planned_start. Tasks with identical start/finish to another task
-- are treated as parallel (no dependency between them), not sequential.
-- 8 leaf tasks have no predecessor -- genuine chain starts / parallel
-- work-stream kickoffs (e.g. Machine Assembly and Panel Wiring both start
-- 2026-10-09 independently).
-- Run 003_add_scheduling_columns.sql first.

update nixma.tasks set predecessor_id = 2 where id = 5 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 5 where id = 6 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 6 where id = 7 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 7 where id = 8 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 8 where id = 9 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 2 where id = 11 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 11 where id = 12 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 12 where id = 13 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 13 where id = 14 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 14 where id = 15 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 9 where id = 17 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 17 where id = 18 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 18 where id = 19 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 19 where id = 20 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 20 where id = 21 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 21 where id = 22 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 22 where id = 23 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 15 where id = 25 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 25 where id = 26 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 26 where id = 27 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 27 where id = 28 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 9 where id = 30 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 30 where id = 31 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 31 where id = 32 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 32 where id = 33 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 2 where id = 35 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 22 where id = 36 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 2 where id = 37 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 27 where id = 38 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 20 where id = 40 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 40 where id = 41 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 46 where id = 48 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 48 where id = 49 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 43 where id = 50 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 49 where id = 51 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 51 where id = 53 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 53 where id = 54 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 54 where id = 56 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 56 where id = 57 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 56 where id = 58 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 56 where id = 59 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 57 where id = 60 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 60 where id = 61 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 60 where id = 63 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 65 where id = 68 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 68 where id = 69 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 69 where id = 70 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 70 where id = 71 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 71 where id = 72 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 72 where id = 73 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 73 where id = 74 and project_id = 'liquick-go-pack-n-seal';
