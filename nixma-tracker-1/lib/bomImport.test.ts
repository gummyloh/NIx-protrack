import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { BomItem } from "./types";
import {
  findHeader,
  headerField,
  mapHeaders,
  parseBomRows,
  parseDate,
  parseMakeBuy,
  parseStatus,
  normalizeUnit,
  planImport,
  readBomSheets,
  toInsertPayload,
  insertOrder,
  assignRowIds,
  ParsedBomRow,
} from "./bomImport";
import { readBomFile } from "./bomExcel";

function item(o: Partial<BomItem> & { id: number }): BomItem {
  return {
    row_id: `R${String(o.id).padStart(4, "0")}`,
    project_id: "p", station_id: 1, sub_assembly: "120 SINGULATOR", discipline: "mechanical",
    description: "CYLINDER", part_no: "CDU16-25D", manufacturer: "SMC", category: null,
    qty: 2, multiple: 1, total_qty: 2, unit: "Pcs", make_buy: "buy", drawing_no: null,
    nsw_part_no: null, engineer_pic: null, issue_date: null, required_date: null,
    status: "not_finalized", supplier: null, pr_no: null, po_no: null, po_date: null, eta: null,
    do_invoice_no: null, qty_received: null, received_date: null, unit_price: null, currency: "MYR",
    linked_po_id: null, linked_fab_id: null, qty_issued: null, issued_to: null, issued_date: null,
    show_to_client: true, remarks: null, sort_order: null, created_at: "", updated_at: "",
    ...o,
  };
}
const SA = "120 SINGULATOR";
const row = (o: Partial<ParsedBomRow>): ParsedBomRow => ({ source_row: 1, sub_assembly: SA, ...o });

/** Applies a plan the way the import modal does, so re-import behaviour can be tested end to end. */
function apply(existing: BomItem[], parsed: ParsedBomRow[], opts = {}): BomItem[] {
  const plan = planImport(parsed, existing, opts);
  let nextId = Math.max(0, ...existing.map((e) => e.id)) + 1;
  const out = existing.map((e) => {
    const u = plan.updates.find((x) => x.id === e.id);
    return u ? { ...e, ...u.patch } : e;
  });
  for (const r of plan.inserts) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { source_row, source_sheet, tracker_id, station_name, discipline_hint, ...rest } = r;
    out.push(item({ part_no: null, manufacturer: null, qty: null, ...rest, id: nextId++ } as BomItem));
  }
  return out;
}

describe("header names", () => {
  it("accepts the ways old master lists name the same column", () => {
    expect(headerField("Item Description")).toBe("description");
    expect(headerField("Description\n(Part name)")).toBe("description");
    expect(headerField("Model No.")).toBe("part_no");
    expect(headerField("P/N")).toBe("part_no");
    expect(headerField("Maker")).toBe("manufacturer");
    expect(headerField("Quantity")).toBe("qty");
    expect(headerField("Qty (pcs)")).toBe("qty");
    expect(headerField("UOM")).toBe("unit");
    expect(headerField("Vendor")).toBe("supplier");
    expect(headerField("Delivery Date")).toBe("eta");
    expect(headerField("Dwg No.")).toBe("drawing_no");
    expect(headerField("Notes")).toBe("remarks");
  });
  it("leaves numbering, group bands and unknown columns alone", () => {
    for (const h of ["Item", "No.", "S/N", "ENGINEERING", "PURCHASING", "ASSEMBLY", "AUTO", "Flag", "Lead Time", "Date"]) {
      expect(headerField(h)).toBeNull();
    }
  });
});

describe("findHeader", () => {
  it("skips title rows and the coloured group band above the real header (company template)", () => {
    const sheet: unknown[][] = [
      ["BOM Master List — Project Template"],
      ["Project Name:", null, null, null, "Originator:"],
      [],
      ["AUTO", "ENGINEERING", "ENGINEERING", "ENGINEERING", "PURCHASING", "ASSEMBLY"],
      ["Item", "Sub-Assembly", "Description", "Manufacturer Part No.", "Status", "Qty Issued"],
      [1, "110 BASE", "PLATE", "X-1", "Received", 1],
    ];
    const h = findHeader(sheet)!;
    expect(h).toMatchObject({ index: 4, span: 1 });
    expect(h.map.get(1)).toBe("sub_assembly");
  });
  it("merges a header split over two rows", () => {
    const sheet: unknown[][] = [
      ["PROJECT MH063"],
      ["No", "Description", "Part No", "Qty", "Purchasing", null, null],
      [null, null, null, null, "Supplier", "PO No", "ETA"],
      [1, "CYLINDER", "CDU16-25D", 2, "SMC MY", "PO-1", "15-Oct-26"],
    ];
    const h = findHeader(sheet)!;
    expect(h).toMatchObject({ index: 1, span: 2 });
    expect([...h.map.values()]).toEqual(["description", "part_no", "qty", "supplier", "po_no", "eta"]);
  });
  it("does not mistake the first data row for a second header row", () => {
    const sheet: unknown[][] = [
      ["Item", "Description", "Part No", "Qty", "Remarks"],
      [1, "Supplier", "Status", 2, "Unit"],
    ];
    expect(findHeader(sheet)).toMatchObject({ index: 0, span: 1 });
  });
  it("returns null when there is no parts table", () => {
    expect(findHeader([["Revision Log"], ["Rev", "Date", "Changes", "By"]])).toBeNull();
  });
});

describe("cells", () => {
  it("reads dates however they were typed", () => {
    expect(parseDate("15-Oct-26")).toBe("2026-10-15");
    expect(parseDate("15 October 2026")).toBe("2026-10-15");
    expect(parseDate("Oct 15, 2026")).toBe("2026-10-15");
    expect(parseDate("03/11/2026")).toBe("2026-11-03"); // day first
    expect(parseDate("3/11/26")).toBe("2026-11-03");
    expect(parseDate("15.10.2026")).toBe("2026-10-15");
    expect(parseDate("10/15/2026")).toBe("2026-10-15"); // can only be month first
    expect(parseDate("2026/10/15")).toBe("2026-10-15");
    expect(parseDate(46310)).toBe("2026-10-15"); // date cell formatted as General
    expect(parseDate("46310")).toBe("2026-10-15");
    expect(parseDate("TBC")).toBeNull();
    expect(parseDate("45/13/2026")).toBeNull();
    expect(parseDate(5)).toBeNull();
  });
  it("reads loose status wording", () => {
    expect(parseStatus("Not received")).toBe("purchased");
    expect(parseStatus("Not yet arrived")).toBe("purchased");
    expect(parseStatus("Delivered")).toBe("received");
    expect(parseStatus("On order")).toBe("purchased");
    expect(parseStatus("PR raised")).toBe("finalized");
    expect(parseStatus("KIV")).toBe("not_finalized");
    expect(parseStatus("Not yet finalize")).toBe("not_finalized");
    expect(parseStatus("see Ahmad")).toBeNull();
  });
  it("units and make/buy", () => {
    expect(normalizeUnit("EA")).toBe("Pcs");
    expect(normalizeUnit("nos")).toBe("Pcs");
    expect(normalizeUnit("M")).toBe("Mtr");
    expect(normalizeUnit("mm")).toBe("mm");
    expect(normalizeUnit("Pair")).toBe("Pair");
    expect(parseMakeBuy("In-house")).toBe("make");
    expect(parseMakeBuy("Purchase")).toBe("buy");
    expect(parseMakeBuy("Stock")).toBe("stock");
    expect(parseMakeBuy("Ex-stock")).toBe("stock");
  });
});

describe("parseBomRows on messy sheets", () => {
  it("reports what it left out instead of dropping it silently", () => {
    const hm = mapHeaders(["Item", "Description", "Part No", "Qty", "Maker", "Status"]);
    const { rows, skipped, issues } = parseBomRows(
      [
        [1, "CYLINDER", "CDU16-25D", "2 pcs", "SMC", "ask Ahmad"],
        [2, null, null, 4, "SMC", null], // no description, no part no.
        [null, null, null, null, null, null],
        [3, "VACUUM CUP", null, "TBC", null, null], // placeholder: no warning
        [null, "TOTAL", null, 6, null, null],
      ],
      hm,
      2,
      "Mech"
    );
    expect(rows.map((r) => r.description)).toEqual(["CYLINDER", "VACUUM CUP"]);
    expect(rows[0]).toMatchObject({ qty: 2, unit: "Pcs", source_sheet: "Mech" });
    expect(rows[0].status).toBeUndefined();
    expect(skipped).toBe(1);
    expect(issues.map((i) => [i.row, i.kind])).toEqual([[2, "value"], [3, "skipped"]]);
    expect(issues[0].message).toContain("ask Ahmad");
  });
  it("a fabricated part listed by drawing number alone is kept, named after the number", () => {
    const hm = mapHeaders(["Sub-Assembly", "Description", "Manufacturer Part No.", "Qty / Set", "Make / Buy"]);
    const { rows, skipped, issues } = parseBomRows(
      [
        ["MH063-240-00", null, "MH063-240-002", 2, "Make (Fabricate)"],
        ["MH063-240-00", null, null, null, null], // dropdown picked, nothing typed: not a part, not a warning
      ],
      hm,
      11
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ description: "MH063-240-002", part_no: "MH063-240-002", make_buy: "make" });
    expect(skipped).toBe(0);
    expect(issues.map((i) => i.kind)).toEqual(["note"]);
  });
  it("the same unreadable value on many rows is reported once", () => {
    const hm = mapHeaders(["Description", "Part No", "Make / Buy"]);
    const { issues } = parseBomRows([["A", "1", "Loan"], ["B", "2", "Loan"], ["C", "3", "loan"]], hm, 2);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ row: 2, kind: "value" });
    expect(issues[0].message).toContain("3 rows");
  });
  it("purchasing's comment in the ETA column is kept in Remarks; a bracketed date is a date", () => {
    const hm = mapHeaders(["Description", "Part No", "ETA", "Remarks"]);
    const { rows, issues } = parseBomRows(
      [
        ["CYLINDER", "C-1", "15/10: 4 to 6 weeks - order from overseas", null],
        ["CUP", "C-2", "14/10: lead time 4-5 weeks", "urgent"],
        ["VALVE", "C-3", "(31/10/2026)", null],
      ],
      hm,
      2
    );
    expect(rows[0]).toMatchObject({ remarks: "ETA: 15/10: 4 to 6 weeks - order from overseas" });
    expect(rows[0].eta).toBeUndefined();
    expect(rows[1].remarks).toBe("urgent · ETA: 14/10: lead time 4-5 weeks");
    expect(rows[2]).toMatchObject({ eta: "2026-10-31" });
    expect(issues.map((i) => i.kind)).toEqual(["note"]);
  });
  it("corrects dates Excel stored with day and month swapped", () => {
    const hm = mapHeaders(["Description", "Part No", "PO Date", "Received Date", "Required Date"]);
    const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
    const { rows, issues } = parseBomRows(
      [
        // typed 12/10/26 and 5/11/26 on a US-date PC → stored as 10 Dec and 11 May
        ["A", "1", d(2026, 12, 10), d(2026, 5, 11), d(2026, 11, 4)],
        ["B", "2", "28/10/26", "30/10/26", d(2026, 11, 18)],
        ["C", "3", "16/10/2026", null, d(2026, 10, 28)],
      ],
      hm,
      2
    );
    expect(rows[0]).toMatchObject({ po_date: "2026-10-12", received_date: "2026-11-05" });
    // Required Date has real dates past the 12th, so the column was entered properly: untouched.
    expect(rows[0].required_date).toBe("2026-11-04");
    expect(issues.filter((i) => i.kind === "note")).toHaveLength(2);
    expect(issues[0].message).toContain("10 Dec 2026 → 12 Oct 2026");
  });
  it("leaves real dates alone when they already sit with the typed ones", () => {
    const hm = mapHeaders(["Description", "Part No", "Received Date"]);
    const { rows } = parseBomRows(
      [["A", "1", new Date(Date.UTC(2026, 10, 5))], ["B", "2", "30/10/26"]],
      hm,
      2
    );
    expect(rows[0].received_date).toBe("2026-11-05");
  });
  it("section titles: numbered, coded, or a lone label in another column", () => {
    const hm = mapHeaders(["Item", "Description", "Part No", "Qty"]);
    const { rows } = parseBomRows(
      [
        [null, "110 BASE & STRUCTURE", null, null],
        [1, "PLATE", "P-1", 1],
        ["SINGULATOR ASSEMBLY", null, null, null],
        [2, "CYLINDER", "CDU16-25D", 2],
        [null, "MH063-130-00 INDEXER", null, null],
        [3, "MOTOR", "HG-KR13", 1],
        [4, "BRACKET (no part no yet)", null, null], // a part, not a section
      ],
      hm,
      2
    );
    expect(rows.map((r) => [r.description, r.sub_assembly])).toEqual([
      ["PLATE", "110 BASE & STRUCTURE"],
      ["CYLINDER", "SINGULATOR ASSEMBLY"],
      ["MOTOR", "MH063-130-00 INDEXER"],
      ["BRACKET (no part no yet)", "MH063-130-00 INDEXER"],
    ]);
  });
  it("fills the Sub-Assembly down when it is only written on the first row of each group", () => {
    const hm = mapHeaders(["Sub-Assembly", "Description", "Part No"]);
    const body = [
      ["110 BASE", "PLATE", "P-1"], [null, "LEG", "P-2"], [null, "FOOT", "P-3"],
      ["120 SINGULATOR", "CYLINDER", "C-1"], [null, "CUP", "C-2"], [null, "VALVE", "C-3"],
    ];
    const { rows, issues } = parseBomRows(body, hm, 2);
    expect(rows.map((r) => r.sub_assembly)).toEqual(["110 BASE", "110 BASE", "110 BASE", "120 SINGULATOR", "120 SINGULATOR", "120 SINGULATOR"]);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("note");
  });
  it("does not fill down a template-style sheet where a few rows are genuinely unassigned", () => {
    const hm = mapHeaders(["Sub-Assembly", "Description", "Part No"]);
    const body = [
      ["110 BASE", "PLATE", "P-1"], ["110 BASE", "LEG", "P-2"], ["110 BASE", "FOOT", "P-3"],
      [null, "SPARE FUSE", "F-1"],
    ];
    expect(parseBomRows(body, hm, 2).rows[3].sub_assembly).toBeUndefined();
  });
  it("uses Total Qty when that is the only quantity column", () => {
    const hm = mapHeaders(["Description", "Part No", "Total Qty"]);
    expect(parseBomRows([["CYLINDER", "C-1", 6]], hm, 2).rows[0].qty).toBe(6);
  });
});

describe("readBomSheets", () => {
  const header = ["Item", "Description", "Part No", "Qty"];
  it("template: uses the BOM sheet, not the formula-driven Customer View", () => {
    const sheets = readBomSheets([
      { name: "How to Use", rows: [["BOM Master List Template — How to Use"]] },
      { name: "BOM", rows: [["title"], header, [1, "CYLINDER", "C-1", 2]] },
      { name: "Customer View", rows: [header, [1, "CYLINDER", "C-1", 2]] },
    ]);
    expect(sheets.map((s) => [s.name, s.included])).toEqual([["BOM", true], ["Customer View", false]]);
  });
  it("blank template: the empty BOM sheet wins over the example row on the instructions sheet", () => {
    const sheets = readBomSheets([
      { name: "How to Use", rows: [["Example row:"], header, ["120-01", "CYLINDER", "CDU16-25D", 2]] },
      { name: "BOM", rows: [["title"], header, [null, null, null, null]] },
    ]);
    expect(sheets.map((s) => [s.name, s.included, s.rows.length])).toEqual([["How to Use", false, 1], ["BOM", true, 0]]);
  });
  it("one sheet per discipline: all read, discipline taken from the sheet name", () => {
    const sheets = readBomSheets([
      { name: "Mech BOM", rows: [header, [1, "PLATE", "P-1", 1]] },
      { name: "Electrical", rows: [header, [1, "PLC", "FX5U", 1]] },
      { name: "Pneumatic", rows: [header, [1, "CYLINDER", "C-1", 2]] },
      { name: "Mech BOM (old)", rows: [header, [1, "PLATE", "P-0", 1]] },
      { name: "Hidden", hidden: true, rows: [header, [1, "X", "Y", 1]] },
      { name: "Empty", rows: [header] },
    ]);
    expect(sheets.map((s) => [s.name, s.included, s.disciplineHint])).toEqual([
      ["Mech BOM", true, "mechanical"],
      ["Electrical", true, "electrical"],
      ["Pneumatic", true, "pneumatic"],
      ["Mech BOM (old)", false, "mechanical"],
      ["Hidden", false, null],
    ]);
    expect(sheets[1].rows[0]).toMatchObject({ discipline_hint: "electrical", source_sheet: "Electrical" });
  });
});

describe("planImport — re-uploading must be safe", () => {
  it("uploading the same file twice changes nothing, even with a part listed twice", () => {
    const file = [
      row({ source_row: 2, description: "M5 BOLT", part_no: "CB5-10", qty: 4 }),
      row({ source_row: 3, description: "M5 BOLT", part_no: "CB5-10", qty: 8 }),
      row({ source_row: 4, description: "BRACKET" }),
    ];
    const first = apply([], file);
    expect(first).toHaveLength(3);
    const again = planImport(file, first);
    expect(again.inserts).toHaveLength(0);
    expect(again.updates).toHaveLength(0);
    expect(again.unchanged).toBe(3);
    expect(again.duplicates).toEqual([{ label: "CB5-10", rows: [2, 3] }]);
  });
  it("adding the part no. later updates the row instead of duplicating it", () => {
    const first = apply([], [row({ description: "VACUUM CUP", qty: 2 })]);
    const plan = planImport([row({ description: "VACUUM CUP", part_no: "ZPT10BN", qty: 2 })], first);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates[0]).toMatchObject({ id: first[0].id, patch: { part_no: "ZPT10BN" } });
    expect(plan.rematched[0].how).toBe("part_no_changed");
  });
  it("a corrected part no. updates the row", () => {
    const plan = planImport([row({ description: "CYLINDER", part_no: "CDU16-30D" })], [item({ id: 5 })]);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates[0].patch).toEqual({ part_no: "CDU16-30D" });
  });
  it("a part moved to another sub-assembly is followed when it is unambiguous", () => {
    const plan = planImport([row({ sub_assembly: "130 INDEXER", description: "CYLINDER", part_no: "CDU16-25D" })], [item({ id: 5 })]);
    expect(plan.updates[0].patch).toEqual({ sub_assembly: "130 INDEXER" });
    expect(plan.rematched[0].how).toBe("moved");
  });
  it("the same part no. in two places is never guessed across sub-assemblies", () => {
    const existing = [item({ id: 5 }), item({ id: 6, sub_assembly: "130 INDEXER" })];
    const plan = planImport([row({ sub_assembly: "140 OUTFEED", description: "CYLINDER", part_no: "CDU16-25D" })], existing);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.updates).toHaveLength(0);
  });

  const ordered = item({ id: 5, status: "purchased", supplier: "SMC MY", po_no: "PO-9", eta: "2026-11-20" });
  it("a stale engineering file cannot roll back purchasing", () => {
    const plan = planImport(
      [row({ description: "CYLINDER", part_no: "CDU16-25D", qty: 4, status: "finalized", supplier: "TBA", eta: "2026-10-01", remarks: "rev B" })],
      [ordered]
    );
    expect(plan.updates[0].patch).toEqual({ qty: 4, remarks: "rev B" });
    expect(plan.kept.map((k) => k.field).sort()).toEqual(["eta", "status", "supplier"]);
  });
  it("purchasing columns in the file still fill blanks and move status forward", () => {
    const plan = planImport(
      [row({ description: "CYLINDER", part_no: "CDU16-25D", status: "received", do_invoice_no: "DO-77", qty_received: 2 })],
      [ordered]
    );
    expect(plan.updates[0].patch).toEqual({ status: "received", do_invoice_no: "DO-77", qty_received: 2 });
    expect(plan.kept).toHaveLength(0);
  });
  it("a cancelled part is not revived; the file can cancel only what nobody has ordered", () => {
    const part = row({ description: "CYLINDER", part_no: "CDU16-25D" });
    const revive = planImport([{ ...part, status: "finalized" }], [item({ id: 5, status: "cancelled" })]);
    expect(revive.updates).toHaveLength(0);
    expect(revive.kept).toHaveLength(1);
    const open = planImport([{ ...part, status: "cancelled" }], [item({ id: 5, status: "finalized" })]);
    expect(open.updates[0].patch).toEqual({ status: "cancelled" });
    const onOrder = planImport([{ ...part, status: "cancelled" }], [ordered]);
    expect(onOrder.updates).toHaveLength(0);
    expect(onOrder.kept[0]).toMatchObject({ field: "status", trackerValue: "purchased" });
  });
  it("flags engineering changes to a part that is already on order", () => {
    const plan = planImport([row({ description: "CYLINDER", part_no: "CDU16-25D", qty: 4, remarks: "rev B" })], [ordered]);
    expect(plan.updates[0].orderSensitive).toEqual(["qty"]);
    const notYet = planImport([row({ description: "CYLINDER", part_no: "CDU16-25D", qty: 4 })], [item({ id: 5 })]);
    expect(notYet.updates[0].orderSensitive).toEqual([]);
  });
  it("fileWins lets the file overwrite purchasing columns", () => {
    const plan = planImport([row({ description: "CYLINDER", part_no: "CDU16-25D", status: "finalized", supplier: "TBA" })], [ordered], { fileWins: true });
    expect(plan.updates[0].patch).toEqual({ status: "finalized", supplier: "TBA" });
    expect(plan.kept).toHaveLength(0);
  });

  it("flags parts the file dropped, only within what the file covers", () => {
    const existing = [
      item({ id: 1 }),
      item({ id: 2, description: "OLD BRACKET", part_no: "B-1" }),
      item({ id: 3, description: "OLD SENSOR", part_no: "S-1", status: "purchased" }),
      item({ id: 4, description: "GONE ALREADY", part_no: "G-1", status: "cancelled" }),
      item({ id: 5, description: "RELAY", part_no: "R-1", discipline: "electrical" }),
      item({ id: 6, description: "MOTOR", part_no: "M-1", sub_assembly: "130 INDEXER" }),
    ];
    const plan = planImport([row({ description: "CYLINDER", part_no: "CDU16-25D", discipline: "mechanical" })], existing);
    expect(plan.missing.map((m) => m.id)).toEqual([2, 3]);
  });
});

describe("Row IDs", () => {
  const SA1 = "MH063-110-00";
  it("match on Row ID even when the description and part no. were both rewritten", () => {
    const existing = [
      item({ id: 1, row_id: "R0001", sub_assembly: SA1, description: "Curtain Sensor", part_no: "BW20-32" }),
      item({ id: 2, row_id: "R0002", sub_assembly: SA1, description: "Handle", part_no: "EP-0516" }),
      item({ id: 3, row_id: "R0003", sub_assembly: SA1, description: "Lock", part_no: null }),
    ];
    const plan = planImport(
      [
        row({ row_id: "R0001", sub_assembly: SA1, description: "Curtain Sensor", part_no: "BW20-32" }),
        row({ row_id: "R0002", sub_assembly: SA1, description: "Handle", part_no: "EP-0516" }),
        row({ row_id: "R0003", sub_assembly: SA1, description: "Cam Lock", part_no: "CL-22" }),
      ],
      existing
    );
    expect(plan.rowIds).toBe("trusted");
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ id: 3, patch: { description: "Cam Lock", part_no: "CL-22" } });
  });
  it("a tracker numbered before the file existed: Row IDs are not believed, parts match by content", () => {
    // What the live MH063 project looks like today: R0001… sit on unrelated seed parts.
    const existing = [
      item({ id: 1, row_id: "R0001", sub_assembly: "MH063-110-00 BASE & STRUCTURE", description: "CASTER WHEEL", part_no: "WI-80F" }),
      item({ id: 2, row_id: "R0002", sub_assembly: "MH063-110-00 BASE & STRUCTURE", description: "HANDLE", part_no: "C-UPCB120-214", station_id: null }),
    ];
    const plan = planImport(
      [
        row({ source_row: 11, row_id: "R0001", sub_assembly: SA1, description: "Curtain Sensor", part_no: "BW20-32" }),
        row({ source_row: 12, row_id: "R0002", sub_assembly: SA1, description: "Bottom Drawer Handle", part_no: "EP-0516" }),
        row({ source_row: 15, row_id: "R0005", sub_assembly: SA1, description: "Handle", part_no: "C-UPCB120-214" }),
      ],
      existing
    );
    expect(plan.rowIds).toBe("mismatch");
    // Handle is found by sub-assembly code + part no.; its fuller sub-assembly name is kept.
    expect(plan.updates).toEqual([expect.objectContaining({ id: 2, patch: { description: "Handle" } })]);
    // The two new parts can't take R0001/R0002 — the seed parts hold them — so the database numbers them.
    expect(plan.inserts.map((r) => [r.description, r.row_id])).toEqual([["Curtain Sensor", undefined], ["Bottom Drawer Handle", undefined]]);
    expect(plan.rowIdClashes).toBe(2);
    expect(plan.missing.map((m) => m.description)).toEqual(["CASTER WHEEL"]);
  });
  it("a new part keeps the file's Row ID; a copy-pasted row with the same ID gets a fresh one", () => {
    const plan = planImport(
      [
        row({ row_id: "R0500", description: "NEW BRACKET", part_no: "B-9" }),
        row({ row_id: "R0500", description: "NEW BRACKET COPY", part_no: "B-10" }),
      ],
      [item({ id: 1 })]
    );
    expect(plan.inserts.map((r) => r.row_id)).toEqual(["R0500", undefined]);
  });
  it("never tries to change a Row ID on an existing part", () => {
    const plan = planImport([row({ row_id: "R0900", description: "CYLINDER", part_no: "CDU16-25D", qty: 9 })], [item({ id: 5 })]);
    expect(plan.updates[0].patch).toEqual({ qty: 9 });
  });
});

describe("readBomFile on real workbooks", () => {
  async function toFile(wb: ExcelJS.Workbook, name = "bom.xlsx") {
    const buf = await wb.xlsx.writeBuffer();
    return new File([buf], name);
  }

  it("reads a legacy master list the way an engineer keeps it", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("MECH");
    ws.addRow(["MH063 LIQUICK GO — BOM MASTER LIST"]);
    ws.mergeCells("A1:H1");
    ws.addRow(["Rev 3", null, "Updated:", new Date(Date.UTC(2026, 9, 1))]);
    ws.addRow([]);
    ws.addRow(["No.", "Item Description", "Model No.", "Maker", "Quantity", "UOM", "Delivery Date", "Status", "Remark"]);
    ws.addRow([null, "MH063-120-00 SINGULATOR"]);
    ws.addRow([1, "CYLINDER", "CDU16-25D", "SMC", 2, "pcs", new Date(Date.UTC(2026, 9, 15)), "Purchased – Not Received"]);
    ws.addRow([2, { richText: [{ text: "LINEAR " }, { text: "BUSHING" }] }, "E-LBHM12UU", "MISUMI", "4 pcs", null, "20/10/2026", "ordered"]);
    ws.addRow([3, "VACUUM CUP", { formula: 'CONCATENATE("ZPT","10")', result: "ZPT10" }, "SMC", { formula: "1+1", result: 2 }, "EA", "TBC", { formula: "VLOOKUP(1,A:A,9,0)", result: { error: "#N/A" } }]);
    ws.addRow([]);
    ws.addRow([null, "130 INDEXER"]);
    ws.addRow([4, "SERVO MOTOR", "HG-KR13", "MITSUBISHI", 1, "set", 46320, "Received"]);
    ws.addRow([null, "TOTAL", null, null, 9]);
    wb.addWorksheet("Revision Log").addRow(["Rev", "Date", "Changes", "By"]);

    const { sheets } = await readBomFile(await toFile(wb));
    expect(sheets).toHaveLength(1);
    const s = sheets[0];
    expect(s).toMatchObject({ name: "MECH", headerRow: 4, disciplineHint: "mechanical", skipped: 0, included: true });
    expect(s.rows).toEqual([
      { source_row: 6, source_sheet: "MECH", discipline_hint: "mechanical", sub_assembly: "MH063-120-00 SINGULATOR", description: "CYLINDER", part_no: "CDU16-25D", manufacturer: "SMC", qty: 2, unit: "Pcs", eta: "2026-10-15", status: "purchased" },
      { source_row: 7, source_sheet: "MECH", discipline_hint: "mechanical", sub_assembly: "MH063-120-00 SINGULATOR", description: "LINEAR BUSHING", part_no: "E-LBHM12UU", manufacturer: "MISUMI", qty: 4, unit: "Pcs", eta: "2026-10-20", status: "purchased" },
      { source_row: 8, source_sheet: "MECH", discipline_hint: "mechanical", sub_assembly: "MH063-120-00 SINGULATOR", description: "VACUUM CUP", part_no: "ZPT10", manufacturer: "SMC", qty: 2, unit: "Pcs" },
      { source_row: 11, source_sheet: "MECH", discipline_hint: "mechanical", sub_assembly: "130 INDEXER", description: "SERVO MOTOR", part_no: "HG-KR13", manufacturer: "MITSUBISHI", qty: 1, unit: "Set", eta: "2026-10-25", status: "received" },
    ]);
    expect(s.issues).toEqual([]);
  });

  it("explains old-format and unreadable files in plain words", async () => {
    await expect(readBomFile(new File(["x"], "old.xls"))).rejects.toThrow(/Save As/);
    await expect(readBomFile(new File(["not a zip"], "broken.xlsx"))).rejects.toThrow(/Couldn't open/);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Notes").addRow(["nothing here"]);
    await expect(readBomFile(await toFile(wb))).rejects.toThrow(/“Notes”/);
  });
});

describe("toInsertPayload", () => {
  const ctx = { projectId: "p", stationId: null, defaultDiscipline: "mechanical" as const, userId: null };
  it("every new row has the same columns and no blank in a required one", () => {
    const bare = toInsertPayload({ source_row: 14, description: "Magnet", source_sheet: "BOM", discipline_hint: "pneumatic" }, ctx);
    const full = toInsertPayload(
      { source_row: 15, description: "Handle", row_id: "R0005", make_buy: "stock", unit: "Set", multiple: 2, status: "received", qty: 3, eta: "2026-10-31", tracker_id: 9, station_name: "x" },
      ctx
    );
    expect(Object.keys(bare).sort()).toEqual(Object.keys(full).sort());
    expect(bare).toMatchObject({ make_buy: "buy", unit: "Pcs", multiple: 1, status: "not_finalized", discipline: "pneumatic", row_id: null, qty: null });
    expect(full).toMatchObject({ make_buy: "stock", unit: "Set", multiple: 2, status: "received", row_id: "R0005", eta: "2026-10-31" });
    for (const k of ["source_row", "source_sheet", "tracker_id", "station_name", "discipline_hint", "unit_price", "total_qty", "id"]) {
      expect(bare).not.toHaveProperty(k);
      expect(full).not.toHaveProperty(k);
    }
  });
  it("rejects impossible dates instead of sending them to the database", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("29/02/2028")).toBe("2028-02-29");
  });
});

describe("insertOrder", () => {
  it("sends rows with their own Row ID before rows the database will number", () => {
    const sent = insertOrder([{ row_id: "R0356", n: 1 }, { row_id: null, n: 2 }, { row_id: "R0357", n: 3 }, { row_id: null, n: 4 }]);
    expect(sent.map((p) => p.n)).toEqual([1, 3, 2, 4]);
  });
});

describe("assignRowIds", () => {
  it("numbers parts without a Row ID after the highest in the tracker or the file", () => {
    const out = assignRowIds([{ row_id: "R0356" }, { row_id: null }, { row_id: "R0449" }, { row_id: null }], ["R0010", "R0400", null]);
    expect(out.map((p) => p.row_id)).toEqual(["R0356", "R0450", "R0449", "R0451"]);
  });
  it("continues after the tracker when that is higher", () => {
    expect(assignRowIds([{ row_id: null }], ["R0627"]).map((p) => p.row_id)).toEqual(["R0628"]);
  });
});
