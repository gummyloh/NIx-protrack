-- The customer page only shows what the team explicitly chose to share, so
-- the BOM stays hidden from customers until someone switches it on per
-- project (BOM page → "Share with customer").
ALTER TABLE nixma.projects
  ADD COLUMN IF NOT EXISTS share_bom_with_client boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION nixma._client_bom_rows(p_project_id text)
RETURNS TABLE (
  id bigint, module_name text, module_seq int, station_name text, station_seq int,
  sub_assembly text, discipline text, description text, part_no text,
  manufacturer text, total_qty numeric, unit text, drawing_no text,
  client_status text, eta date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = nixma AS $$
  SELECT b.id, m.name, m.sequence, s.name, s.sequence,
         b.sub_assembly, b.discipline, b.description, b.part_no,
         b.manufacturer, b.total_qty, b.unit, b.drawing_no,
         CASE
           WHEN b.status IN ('received','nsw_purchased') THEN 'received'
           WHEN b.status = 'purchased' THEN 'ordered'
           WHEN b.status IN ('finalized','nsw_requested') THEN 'released'
           ELSE 'in_design'
         END,
         b.eta
  FROM nixma.bom_items b
  JOIN nixma.projects pr ON pr.id = b.project_id AND pr.share_bom_with_client = true
  LEFT JOIN nixma.stations s ON s.id = b.station_id
  LEFT JOIN nixma.modules  m ON m.id = s.module_id
  WHERE b.project_id = p_project_id
    AND b.show_to_client = true
    AND b.status <> 'cancelled'
  ORDER BY m.sequence NULLS LAST, s.sequence NULLS LAST, b.sub_assembly, b.sort_order NULLS LAST, b.id;
$$;
REVOKE ALL ON FUNCTION nixma._client_bom_rows(text) FROM PUBLIC, anon, authenticated;

-- projects has no UPDATE policy (changes go through RPCs), so the toggle
-- gets its own, with the same membership check as publish_client_update.
CREATE OR REPLACE FUNCTION nixma.set_bom_client_sharing(p_project_id text, p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = nixma AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT nixma.can_access_project(p_project_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized for project %', p_project_id;
  END IF;
  UPDATE nixma.projects SET share_bom_with_client = p_enabled WHERE id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project % not found', p_project_id;
  END IF;
  RETURN p_enabled;
END;
$$;
REVOKE ALL ON FUNCTION nixma.set_bom_client_sharing(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nixma.set_bom_client_sharing(text, boolean) TO authenticated;

-- projects uses column-level SELECT grants; let team members read the flag.
GRANT SELECT (share_bom_with_client) ON nixma.projects TO authenticated;
