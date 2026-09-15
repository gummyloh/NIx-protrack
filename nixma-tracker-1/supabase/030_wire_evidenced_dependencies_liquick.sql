-- Data fix, not schema: two dependency links backed directly by Liquick's
-- own status notes, not inference. "Gripper force" (task 84)'s note says
-- "Same as Gripper (#83)" -- the same work thread, untracked as such
-- structurally. "Pick and place into conveyor" (task 90)'s note flags the
-- gripper-to-conveyor transfer mechanism as not yet designed, pending on
-- the conveyor side of that pairing (Loading conveyor, task 87) being
-- settled first.
update nixma.tasks set predecessor_id = 83 where id = 84 and project_id = 'liquick-go-pack-n-seal';
update nixma.tasks set predecessor_id = 87 where id = 90 and project_id = 'liquick-go-pack-n-seal';
