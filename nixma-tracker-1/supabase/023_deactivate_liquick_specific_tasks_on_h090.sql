-- Data fix, not schema: deactivates the 17 pouch-machine-specific tasks
-- (Liquick's ids 75-91 -- catheter handling, zip-lock mechanisms, gripper
-- force, etc.) that H090 incorrectly inherited before 021/022 split the
-- clone template away from Liquick's live project. Deactivated rather than
-- deleted, same pattern the schema already uses for superseded tasks --
-- the history stays, it just stops counting as active.
update nixma.tasks
set is_active = false
where project_id = 'h090-modine-hrs-charging-station'
  and phase = 1 and task_no > 54;
