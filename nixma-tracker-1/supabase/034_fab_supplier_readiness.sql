-- ============================================================
-- 034 — Supplier Readiness on Fabrication Items
--
-- Adds a requirements checklist + supplier confirmation tracking
-- to procurement_fab_items so that a fab item cannot be marked
-- "in_fabrication" until the supplier has confirmed they have
-- everything they need and has provided a start/delivery date.
--
-- This directly prevents the MH063-style failure where:
--   - PO was raised but supplier silently waited for 3D drawings
--   - No one was alerted that fabrication hadn't actually started
-- ============================================================

ALTER TABLE nixma.procurement_fab_items
  -- JSONB checklist: tracks which docs/requirements have been sent
  -- Schema: { drawing_sent: bool, spec_sent: bool, po_confirmed: bool, other: string|null }
  ADD COLUMN IF NOT EXISTS requirements_checklist jsonb NOT NULL DEFAULT '{"drawing_sent":false,"spec_sent":false,"po_confirmed":false,"other":null}'::jsonb,

  -- Has the supplier explicitly confirmed they have everything to start?
  ADD COLUMN IF NOT EXISTS supplier_confirmed boolean NOT NULL DEFAULT false,

  -- Date the supplier confirmed (for audit trail)
  ADD COLUMN IF NOT EXISTS supplier_confirmed_date date,

  -- Dates the supplier committed to when confirming
  ADD COLUMN IF NOT EXISTS supplier_confirmed_start date,
  ADD COLUMN IF NOT EXISTS supplier_confirmed_delivery date,

  -- Last time we received any update from supplier (to flag stale items)
  ADD COLUMN IF NOT EXISTS last_supplier_update date,

  -- Who confirmed (free text — name of the contact at supplier who confirmed)
  ADD COLUMN IF NOT EXISTS supplier_confirmed_by text;

-- Index to quickly find unconfirmed, active fab items (for dashboard alerts)
CREATE INDEX IF NOT EXISTS idx_fab_items_unconfirmed
  ON nixma.procurement_fab_items (project_id, supplier_confirmed, status)
  WHERE status NOT IN ('delivered', 'cancelled');

COMMENT ON COLUMN nixma.procurement_fab_items.requirements_checklist IS
  'JSON tracking which pre-fabrication requirements have been sent to supplier: {drawing_sent, spec_sent, po_confirmed, other}';

COMMENT ON COLUMN nixma.procurement_fab_items.supplier_confirmed IS
  'TRUE only when supplier has explicitly confirmed receipt of all requirements and committed to a start/delivery date';

COMMENT ON COLUMN nixma.procurement_fab_items.last_supplier_update IS
  'Date of last communication received FROM supplier — used to flag items going quiet';
