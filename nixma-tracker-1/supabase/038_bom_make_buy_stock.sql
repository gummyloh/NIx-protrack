-- ============================================================
-- BOM: "From Stock" as a fourth Make / Buy choice.
--
-- Parts taken from store stock need no PR or PO. The wiring BOM marks them
-- "Stock" in the Make / Buy column; until now the tracker could only hold
-- Buy / Make / Customer Supplied, so they were imported as Buy.
-- ============================================================

ALTER TABLE nixma.bom_items DROP CONSTRAINT IF EXISTS bom_items_make_buy_check;
ALTER TABLE nixma.bom_items
  ADD CONSTRAINT bom_items_make_buy_check
  CHECK (make_buy IN ('buy','make','customer','stock'));
