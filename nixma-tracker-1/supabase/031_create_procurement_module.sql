-- ============================================================
-- PROCUREMENT MODULE
-- All tables under nixma schema. project_id is text (matches projects.id)
-- ============================================================

-- 1. Supplier master with track record
CREATE TABLE nixma.procurement_suppliers (
  id            bigserial PRIMARY KEY,
  project_id    text NOT NULL REFERENCES nixma.projects(id) ON DELETE CASCADE,
  name          text NOT NULL,
  contact_name  text,
  email         text,
  phone         text,
  category      text,
  total_orders           int NOT NULL DEFAULT 0,
  on_time_count          int NOT NULL DEFAULT 0,
  late_count             int NOT NULL DEFAULT 0,
  avg_delay_days         numeric(5,1),
  quality_rejection_count int NOT NULL DEFAULT 0,
  last_order_date        date,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id)
);

-- 2. RFQ — groups multiple supplier quotes for one item
CREATE TABLE nixma.procurement_rfq (
  id               bigserial PRIMARY KEY,
  project_id       text NOT NULL REFERENCES nixma.projects(id) ON DELETE CASCADE,
  item_description text NOT NULL,
  category         text,
  quantity         numeric(12,3),
  unit             text,
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','awarded','cancelled')),
  selected_quote_id bigint,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES auth.users(id)
);

-- 3. Individual supplier quotes
CREATE TABLE nixma.procurement_quotes (
  id              bigserial PRIMARY KEY,
  rfq_id          bigint NOT NULL REFERENCES nixma.procurement_rfq(id) ON DELETE CASCADE,
  project_id      text NOT NULL REFERENCES nixma.projects(id) ON DELETE CASCADE,
  supplier_id     bigint REFERENCES nixma.procurement_suppliers(id),
  supplier_name   text NOT NULL,
  unit_price      numeric(14,2),
  quantity        numeric(12,3),
  total_price     numeric(14,2),
  currency        text NOT NULL DEFAULT 'MYR',
  lead_time_days  int,
  payment_terms   text,
  validity_date   date,
  delivery_terms  text,
  source_doc_url  text,
  extracted_by_ai boolean NOT NULL DEFAULT false,
  raw_ai_json     jsonb,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id)
);

ALTER TABLE nixma.procurement_rfq
  ADD CONSTRAINT fk_selected_quote
  FOREIGN KEY (selected_quote_id) REFERENCES nixma.procurement_quotes(id);

-- 4. Purchase Orders
CREATE TABLE nixma.procurement_pos (
  id               bigserial PRIMARY KEY,
  project_id       text NOT NULL REFERENCES nixma.projects(id) ON DELETE CASCADE,
  po_number        text,
  supplier_id      bigint REFERENCES nixma.procurement_suppliers(id),
  supplier_name    text NOT NULL,
  rfq_id           bigint REFERENCES nixma.procurement_rfq(id),
  quote_id         bigint REFERENCES nixma.procurement_quotes(id),
  category         text,
  item_description text NOT NULL,
  quantity         numeric(12,3),
  unit             text,
  unit_price       numeric(14,2),
  total_price      numeric(14,2),
  currency         text NOT NULL DEFAULT 'MYR',
  payment_terms    text,
  date_ordered     date,
  expected_delivery date,
  actual_delivery  date,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','issued','partial','received','closed','cancelled')),
  source_doc_url   text,
  extracted_by_ai  boolean NOT NULL DEFAULT false,
  raw_ai_json      jsonb,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES auth.users(id),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- 5. Fabrication items
CREATE TABLE nixma.procurement_fab_items (
  id                  bigserial PRIMARY KEY,
  project_id          text NOT NULL REFERENCES nixma.projects(id) ON DELETE CASCADE,
  item_name           text NOT NULL,
  drawing_ref         text,
  fab_vendor          text,
  category            text,
  quantity            int,
  cost                numeric(14,2),
  currency            text NOT NULL DEFAULT 'MYR',
  start_date          date,
  expected_completion date,
  actual_completion   date,
  status              text NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started','in_fabrication','qc','ready','delivered','cancelled')),
  source_doc_url      text,
  extracted_by_ai     boolean NOT NULL DEFAULT false,
  raw_ai_json         jsonb,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES auth.users(id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 6. Project budget per category
CREATE TABLE nixma.procurement_budget (
  id               bigserial PRIMARY KEY,
  project_id       text NOT NULL REFERENCES nixma.projects(id) ON DELETE CASCADE,
  category         text NOT NULL,
  budgeted_amount  numeric(14,2) NOT NULL DEFAULT 0,
  currency         text NOT NULL DEFAULT 'MYR',
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, category)
);

-- RLS
ALTER TABLE nixma.procurement_suppliers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE nixma.procurement_rfq        ENABLE ROW LEVEL SECURITY;
ALTER TABLE nixma.procurement_quotes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE nixma.procurement_pos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE nixma.procurement_fab_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE nixma.procurement_budget     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team members" ON nixma.procurement_suppliers  FOR ALL USING (nixma.can_i_access_project(project_id));
CREATE POLICY "team members" ON nixma.procurement_rfq        FOR ALL USING (nixma.can_i_access_project(project_id));
CREATE POLICY "team members" ON nixma.procurement_quotes     FOR ALL USING (nixma.can_i_access_project(project_id));
CREATE POLICY "team members" ON nixma.procurement_pos        FOR ALL USING (nixma.can_i_access_project(project_id));
CREATE POLICY "team members" ON nixma.procurement_fab_items  FOR ALL USING (nixma.can_i_access_project(project_id));
CREATE POLICY "team members" ON nixma.procurement_budget     FOR ALL USING (nixma.can_i_access_project(project_id));

CREATE INDEX ON nixma.procurement_pos (project_id, status);
CREATE INDEX ON nixma.procurement_pos (project_id, expected_delivery);
CREATE INDEX ON nixma.procurement_fab_items (project_id, status);
CREATE INDEX ON nixma.procurement_rfq (project_id, status);
CREATE INDEX ON nixma.procurement_quotes (rfq_id);
CREATE INDEX ON nixma.procurement_suppliers (project_id);
