-- Link tasks to purchase orders so delivery delays can flag task risk
ALTER TABLE nixma.tasks
  ADD COLUMN IF NOT EXISTS linked_po_id bigint REFERENCES nixma.procurement_pos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_linked_po ON nixma.tasks (linked_po_id) WHERE linked_po_id IS NOT NULL;
