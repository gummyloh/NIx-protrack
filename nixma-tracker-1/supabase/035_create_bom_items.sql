-- ============================================================
-- BOM (Bill of Materials) master list
-- One row per part. Linked to a tracker station (the user's chosen model:
-- BOM sub-assemblies map onto stations), and optionally to the PO /
-- fabrication item that fulfils it. Column set mirrors the company BOM
-- Excel template (BOM_Master_List_TEMPLATE.xlsx) so files round-trip.
-- ============================================================

CREATE TABLE nixma.bom_items (
  id              bigserial PRIMARY KEY,
  project_id      text NOT NULL REFERENCES nixma.projects(id) ON DELETE CASCADE,
  station_id      bigint REFERENCES nixma.stations(id) ON DELETE SET NULL,

  -- Engineering
  sub_assembly    text,                       -- drawing-tree code/name, e.g. "120 SINGULATOR"
  discipline      text NOT NULL DEFAULT 'mechanical'
                    CHECK (discipline IN ('mechanical','electrical','pneumatic','software','others')),
  description     text NOT NULL,
  part_no         text,                       -- manufacturer part no.
  manufacturer    text,
  category        text,
  qty             numeric(12,3),              -- per set
  multiple        numeric(12,3) NOT NULL DEFAULT 1,
  total_qty       numeric(14,3) GENERATED ALWAYS AS (qty * multiple) STORED,
  unit            text NOT NULL DEFAULT 'Pcs',
  make_buy        text NOT NULL DEFAULT 'buy'
                    CHECK (make_buy IN ('buy','make','customer')),
  drawing_no      text,
  nsw_part_no     text,
  engineer_pic    text,
  issue_date      date,
  required_date   date,

  -- Purchasing
  status          text NOT NULL DEFAULT 'not_finalized'
                    CHECK (status IN ('not_finalized','finalized','purchased','received',
                                      'nsw_purchased','nsw_requested','cancelled')),
  supplier        text,
  pr_no           text,
  po_no           text,
  po_date         date,
  eta             date,
  do_invoice_no   text,
  qty_received    numeric(12,3),
  received_date   date,
  unit_price      numeric(14,2),
  currency        text NOT NULL DEFAULT 'MYR',
  linked_po_id    bigint REFERENCES nixma.procurement_pos(id) ON DELETE SET NULL,
  linked_fab_id   bigint REFERENCES nixma.procurement_fab_items(id) ON DELETE SET NULL,

  -- Assembly (store issue to line)
  qty_issued      numeric(12,3),
  issued_to       text,
  issued_date     date,

  show_to_client  boolean NOT NULL DEFAULT true,
  remarks         text,
  sort_order      int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES auth.users(id)
);

CREATE INDEX ON nixma.bom_items (project_id, station_id);
CREATE INDEX ON nixma.bom_items (project_id, status);
CREATE INDEX ON nixma.bom_items (project_id, eta);

ALTER TABLE nixma.bom_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team members" ON nixma.bom_items
  FOR ALL USING (nixma.can_i_access_project(project_id))
  WITH CHECK (nixma.can_i_access_project(project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON nixma.bom_items TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE nixma.bom_items_id_seq TO authenticated;

CREATE OR REPLACE FUNCTION nixma.touch_bom_items_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = nixma AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER bom_items_touch_updated_at
  BEFORE UPDATE ON nixma.bom_items
  FOR EACH ROW EXECUTE FUNCTION nixma.touch_bom_items_updated_at();

-- ------------------------------------------------------------
-- Customer view: never exposes supplier, PR/PO, price, DO or remarks.
-- Status is collapsed to four customer-facing stages. Same trust model as
-- list_client_photos: the RPC re-checks the PIN hash / access token itself.
-- ------------------------------------------------------------
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
  LEFT JOIN nixma.stations s ON s.id = b.station_id
  LEFT JOIN nixma.modules  m ON m.id = s.module_id
  WHERE b.project_id = p_project_id
    AND b.show_to_client = true
    AND b.status <> 'cancelled'
  ORDER BY m.sequence NULLS LAST, s.sequence NULLS LAST, b.sub_assembly, b.sort_order NULLS LAST, b.id;
$$;
REVOKE ALL ON FUNCTION nixma._client_bom_rows(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION nixma.list_client_bom(p_project_id text, p_password text)
RETURNS TABLE (
  id bigint, module_name text, module_seq int, station_name text, station_seq int,
  sub_assembly text, discipline text, description text, part_no text,
  manufacturer text, total_qty numeric, unit text, drawing_no text,
  client_status text, eta date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = nixma, extensions AS $$
  SELECT r.* FROM nixma._client_bom_rows(p_project_id) r
  WHERE EXISTS (
    SELECT 1 FROM nixma.projects p
    WHERE p.id = p_project_id
      AND p.customer_password = extensions.crypt(p_password, p.customer_password)
  );
$$;
GRANT EXECUTE ON FUNCTION nixma.list_client_bom(text, text) TO anon, authenticated;

CREATE FUNCTION nixma.list_client_bom_by_token(p_project_id text, p_token text)
RETURNS TABLE (
  id bigint, module_name text, module_seq int, station_name text, station_seq int,
  sub_assembly text, discipline text, description text, part_no text,
  manufacturer text, total_qty numeric, unit text, drawing_no text,
  client_status text, eta date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = nixma AS $$
  SELECT r.* FROM nixma._client_bom_rows(p_project_id) r
  WHERE EXISTS (
    SELECT 1 FROM nixma.projects p
    WHERE p.id = p_project_id AND p.customer_access_token = p_token
  );
$$;
GRANT EXECUTE ON FUNCTION nixma.list_client_bom_by_token(text, text) TO anon, authenticated;
