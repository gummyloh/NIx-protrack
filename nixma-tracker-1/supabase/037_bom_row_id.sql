-- ============================================================
-- BOM: stable Row ID per part, so a revised Excel BOM (Rev 1, Rev 2 …) updates
-- the parts already in the tracker instead of creating duplicates.
--
-- The company BOM template (v4) carries the same ID in a hidden "Row ID"
-- column (R0001, R0002 …). Parts added in the tracker, or imported from a file
-- that has no Row ID, get the next free number for their project.
-- ============================================================

ALTER TABLE nixma.bom_items ADD COLUMN IF NOT EXISTS row_id text;

-- Backfill existing parts: R0001… per project in creation order, continuing
-- after any ids already present (safe to re-run).
WITH base AS (
  SELECT project_id,
         COALESCE(MAX(NULLIF(substring(row_id from '^R([0-9]+)$'), '')::int), 0) AS n
  FROM nixma.bom_items
  GROUP BY project_id
),
todo AS (
  SELECT b.id,
         base.n + row_number() OVER (PARTITION BY b.project_id ORDER BY b.id) AS rn
  FROM nixma.bom_items b
  JOIN base ON base.project_id = b.project_id
  WHERE b.row_id IS NULL OR btrim(b.row_id) = ''
)
UPDATE nixma.bom_items b
SET row_id = 'R' || lpad(todo.rn::text, 4, '0')
FROM todo
WHERE b.id = todo.id;

ALTER TABLE nixma.bom_items ALTER COLUMN row_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bom_items_project_row_id_key
  ON nixma.bom_items (project_id, row_id);

-- Assigns the next R#### when an insert doesn't bring its own. The advisory
-- lock keeps two simultaneous inserts into one project from picking the same
-- number; rows inserted earlier by the same statement are visible to later
-- rows' trigger calls, so a 200-row import batch numbers correctly.
CREATE OR REPLACE FUNCTION nixma.assign_bom_row_id()
RETURNS trigger LANGUAGE plpgsql SET search_path = nixma AS $$
DECLARE
  next_n int;
BEGIN
  IF NEW.row_id IS NULL OR btrim(NEW.row_id) = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('bom_row_id:' || NEW.project_id));
    SELECT COALESCE(MAX(NULLIF(substring(row_id from '^R([0-9]+)$'), '')::int), 0) + 1
      INTO next_n
      FROM nixma.bom_items
     WHERE project_id = NEW.project_id;
    NEW.row_id := 'R' || lpad(next_n::text, 4, '0');
  ELSE
    NEW.row_id := btrim(NEW.row_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bom_items_assign_row_id ON nixma.bom_items;
CREATE TRIGGER bom_items_assign_row_id
  BEFORE INSERT ON nixma.bom_items
  FOR EACH ROW EXECUTE FUNCTION nixma.assign_bom_row_id();

-- A part's Row ID never changes once it exists: re-imports match on it.
CREATE OR REPLACE FUNCTION nixma.lock_bom_row_id()
RETURNS trigger LANGUAGE plpgsql SET search_path = nixma AS $$
BEGIN
  IF NEW.row_id IS DISTINCT FROM OLD.row_id THEN
    RAISE EXCEPTION 'bom_items.row_id cannot be changed (part %, % → %)', OLD.id, OLD.row_id, NEW.row_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bom_items_lock_row_id ON nixma.bom_items;
CREATE TRIGGER bom_items_lock_row_id
  BEFORE UPDATE ON nixma.bom_items
  FOR EACH ROW EXECUTE FUNCTION nixma.lock_bom_row_id();
