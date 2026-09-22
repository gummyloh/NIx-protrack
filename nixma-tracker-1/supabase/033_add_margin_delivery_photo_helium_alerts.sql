-- Feature 1: Project quoted price for margin tracking
ALTER TABLE nixma.projects
  ADD COLUMN IF NOT EXISTS quoted_price    numeric(14,2),
  ADD COLUMN IF NOT EXISTS quoted_currency text NOT NULL DEFAULT 'MYR';

-- Feature 2: PO delivery photos
CREATE TABLE IF NOT EXISTS nixma.procurement_po_photos (
  id           bigserial PRIMARY KEY,
  po_id        bigint NOT NULL REFERENCES nixma.procurement_pos(id) ON DELETE CASCADE,
  project_id   text   NOT NULL REFERENCES nixma.projects(id)        ON DELETE CASCADE,
  storage_path text   NOT NULL,
  caption      text,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  uploaded_by  uuid REFERENCES auth.users(id)
);
ALTER TABLE nixma.procurement_po_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team members" ON nixma.procurement_po_photos
  FOR ALL USING (nixma.can_i_access_project(project_id));
CREATE INDEX ON nixma.procurement_po_photos (po_id);

-- Feature 3: Helium leak test results
CREATE TABLE IF NOT EXISTS nixma.helium_test_results (
  id                 bigserial PRIMARY KEY,
  project_id         text NOT NULL REFERENCES nixma.projects(id) ON DELETE CASCADE,
  serial_number      text,
  part_number        text,
  description        text,
  result             text NOT NULL CHECK (result IN ('pass','fail','retest')),
  leak_rate          numeric(18,6),
  leak_rate_unit     text NOT NULL DEFAULT 'mbar·l/s',
  test_pressure      numeric(10,3),
  test_pressure_unit text,
  test_duration_s    int,
  chamber_id         text,
  operator           text,
  test_date          date NOT NULL DEFAULT CURRENT_DATE,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES auth.users(id)
);
ALTER TABLE nixma.helium_test_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team members" ON nixma.helium_test_results
  FOR ALL USING (nixma.can_i_access_project(project_id));
CREATE INDEX ON nixma.helium_test_results (project_id, test_date DESC);
CREATE INDEX ON nixma.helium_test_results (project_id, result);

-- Feature 4: WhatsApp alert config
CREATE TABLE IF NOT EXISTS nixma.project_alert_config (
  project_id           text PRIMARY KEY REFERENCES nixma.projects(id) ON DELETE CASCADE,
  whatsapp_enabled     boolean NOT NULL DEFAULT false,
  recipient_numbers    text,
  alert_overdue_po     boolean NOT NULL DEFAULT true,
  alert_overdue_fab    boolean NOT NULL DEFAULT true,
  alert_daily_summary  boolean NOT NULL DEFAULT false,
  alert_hour_utc       int     NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE nixma.project_alert_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team members" ON nixma.project_alert_config
  FOR ALL USING (nixma.can_i_access_project(project_id));
