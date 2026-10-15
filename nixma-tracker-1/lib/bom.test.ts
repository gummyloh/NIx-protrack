import { describe, it, expect } from "vitest";
import { BomItem, ModuleRow, StationRow } from "./types";
import {
  bomFlags,
  computeBomRollup,
  mapHeaders,
  parseBomRows,
  parseDate,
  parseStatus,
  planImport,
  disciplineFromCategory,
  fileMayChangeStatus,
  guessStation,
  toClientStatus,
  normalizeBomItems,
} from "./bom";

function item(o: Partial<BomItem> & { id: number }): BomItem {
  return {
    row_id: `R${String(o.id).padStart(4, "0")}`,
    project_id: "p",
    station_id: 1,
    sub_assembly: "120 SINGULATOR",
    discipline: "mechanical",
    description: "CYLINDER",
    part_no: "CDU16-25D",
    manufacturer: "SMC",
    category: null,
    qty: 2,
    multiple: 1,
    total_qty: 2,
    unit: "Pcs",
    make_buy: "buy",
    drawing_no: null,
    nsw_part_no: null,
    engineer_pic: null,
    issue_date: null,
    required_date: null,
    status: "not_finalized",
    supplier: null,
    pr_no: null,
    po_no: null,
    po_date: null,
    eta: null,
    do_invoice_no: null,
    qty_received: null,
    received_date: null,
    unit_price: null,
    currency: "MYR",
    linked_po_id: null,
    linked_fab_id: null,
    qty_issued: null,
    issued_to: null,
    issued_date: null,
    show_to_client: true,
    remarks: null,
    sort_order: null,
    created_at: "",
    updated_at: "",
    ...o,
  };
}

const TODAY = "2026-10-09";

describe("bomFlags", () => {
  it("clean row has no flags", () => {
    expect(bomFlags(item({ id: 1 }), TODAY)).toEqual([]);
  });
  it("missing qty and part no on a bought item", () => {
    expect(bomFlags(item({ id: 1, qty: null, total_qty: null, part_no: null }), TODAY)).toEqual(["NO_QTY", "NO_PART_NO"]);
  });
  it("fabricated part without a part no is fine", () => {
    expect(bomFlags(item({ id: 1, make_buy: "make", part_no: null }), TODAY)).toEqual([]);
  });
  it("ETA in the past and not received is overdue", () => {
    expect(bomFlags(item({ id: 1, status: "purchased", eta: "2026-10-01" }), TODAY)).toContain("OVERDUE");
  });
  it("received item is never overdue", () => {
    expect(bomFlags(item({ id: 1, status: "received", eta: "2026-10-01" }), TODAY)).not.toContain("OVERDUE");
  });
  it("ETA after required date", () => {
    expect(bomFlags(item({ id: 1, status: "purchased", eta: "2026-11-01", required_date: "2026-10-20" }), TODAY)).toEqual(["LATE_VS_REQ"]);
  });
  it("finalized without PR needs PR", () => {
    expect(bomFlags(item({ id: 1, status: "finalized" }), TODAY)).toEqual(["NEED_PR"]);
    expect(bomFlags(item({ id: 1, status: "finalized", pr_no: "PR-1" }), TODAY)).toEqual([]);
  });
  it("short received", () => {
    expect(bomFlags(item({ id: 1, status: "received", qty_received: 1 }), TODAY)).toEqual(["SHORT"]);
  });
  it("cancelled rows carry no flags", () => {
    expect(bomFlags(item({ id: 1, status: "cancelled", qty: null }), TODAY)).toEqual([]);
  });
});

describe("computeBomRollup", () => {
  const modules: ModuleRow[] = [{ id: 10, project_id: "p", name: "Module 1", sequence: 1, created_at: "" }];
  const stations: StationRow[] = [
    { id: 1, module_id: 10, project_id: "p", name: "Singulator", sequence: 1, created_at: "" },
    { id: 2, module_id: 10, project_id: "p", name: "Indexer", sequence: 2, created_at: "" },
  ];
  it("counts per station, module and total; cancelled excluded", () => {
    const r = computeBomRollup(
      [
        item({ id: 1, status: "received" }),
        item({ id: 2, status: "purchased", station_id: 2, eta: "2026-10-01" }),
        item({ id: 3, status: "cancelled" }),
        item({ id: 4, station_id: null }),
      ],
      modules,
      stations,
      TODAY
    );
    expect(r.total).toMatchObject({ lines: 3, finalized: 2, ordered: 2, received: 1, overdue: 1 });
    expect(r.modules[0].stations[0].counts.lines).toBe(1);
    expect(r.modules[0].stations[1].counts.overdue).toBe(1);
    expect(r.modules[0].counts.lines).toBe(2);
    expect(r.unassigned.lines).toBe(1);
  });
});

describe("parsing", () => {
  it("maps template and legacy headers", () => {
    const m = mapHeaders(["Item", "Sub-Assembly", "Description", "Manufacturer Part No.", "Qty / Set", "Unit Price (RM)", "Remark"]);
    expect([...m.values()]).toEqual(["sub_assembly", "description", "part_no", "qty", "unit_price", "remarks"]);
  });
  it("status labels from the legend and loose wording", () => {
    expect(parseStatus("Not yet finalize")).toBe("not_finalized");
    expect(parseStatus("Finalized but yet purchase")).toBe("finalized");
    expect(parseStatus("Finalized – Not Purchased")).toBe("finalized");
    expect(parseStatus("Purchased – Not Received")).toBe("purchased");
    expect(parseStatus("Item received")).toBe("received");
    expect(parseStatus("NSW purchased")).toBe("nsw_purchased");
    expect(parseStatus("New request to NSW purchase")).toBe("nsw_requested");
    expect(parseStatus("")).toBeNull();
  });
  it("dates", () => {
    expect(parseDate("15-Oct-26")).toBe("2026-10-15");
    expect(parseDate("03/11/2026")).toBe("2026-11-03");
    expect(parseDate(new Date(Date.UTC(2026, 9, 1)))).toBe("2026-10-01");
    expect(parseDate("tbc")).toBeNull();
  });
  it("legacy section rows become sub-assembly", () => {
    const hm = mapHeaders(["Item", "Description", "Manufacturer Part No.", "Manufacturer", "Qty"]);
    const { rows } = parseBomRows(
      [
        [null, "MH063-120-00 SINGULATOR", null, null, null],
        [16, "LINEAR BUSHING", "E-LBHM12UU", "MISUMI", null],
        [17, "CYLINDER", "CDU16-25D", "SMC", 2],
        [null, null, null, null, null],
        [null, "MH042-00-T HIGH PRESSURE LINE", null, null, null],
      ],
      hm,
      13
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sub_assembly: "MH063-120-00 SINGULATOR", description: "LINEAR BUSHING", source_row: 14 });
    expect(rows[1].qty).toBe(2);
  });
});

describe("planImport", () => {
  const existing = [item({ id: 5, status: "purchased", po_no: "PO-9" })];
  it("matches by part no and only patches non-empty changed cells", () => {
    const plan = planImport(
      [
        { source_row: 11, sub_assembly: "120 SINGULATOR", description: "CYLINDER", part_no: "CDU16-25D", qty: 4 },
        { source_row: 12, sub_assembly: "120 SINGULATOR", description: "VACUUM CUP" },
      ],
      existing
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ id: 5, patch: { qty: 4 }, changed: ["qty"] });
    expect(plan.inserts).toHaveLength(1);
  });
  it("tracker id wins over key", () => {
    const plan = planImport([{ source_row: 2, tracker_id: 5, description: "RENAMED", part_no: "X" }], existing);
    expect(plan.updates[0].id).toBe(5);
  });
  it("identical row is unchanged", () => {
    const plan = planImport([{ source_row: 2, sub_assembly: "120 SINGULATOR", description: "CYLINDER", part_no: "CDU16-25D", qty: 2 }], existing);
    expect(plan.unchanged).toBe(1);
  });
});

describe("misc", () => {
  it("guesses station from sub-assembly words", () => {
    const st: StationRow[] = [
      { id: 1, module_id: 1, project_id: "p", name: "Pouch Singulator (Loading)", sequence: 1, created_at: "" },
      { id: 2, module_id: 1, project_id: "p", name: "Transfer & Rotary Indexer", sequence: 2, created_at: "" },
    ];
    expect(guessStation("MH063-120-00 SINGULATOR", st)).toBe(1);
    expect(guessStation("130 ROTARY TABLE", st)).toBe(2);
    expect(guessStation("110 BASE & STRUCTURE", st)).toBeNull();
  });
  it("client status collapse", () => {
    expect(toClientStatus("nsw_purchased")).toBe("received");
    expect(toClientStatus("nsw_requested")).toBe("released");
  });
});

describe("normalizeBomItems", () => {
  it("turns PostgREST numeric strings into numbers so comparisons work", () => {
    const [n] = normalizeBomItems([{ id: 1, qty: "4.000", total_qty: "10.000", qty_received: "4.000", unit_price: null }]);
    expect(n.total_qty).toBe(10);
    expect(n.unit_price).toBeNull();
    expect(bomFlags({ ...item({ id: 1 }), ...n, status: "received" }, TODAY)).toContain("SHORT");
  });
});

describe("v4 template: Row ID, ownership and revisions", () => {
  const hm = mapHeaders(["Item", "Sub-Assembly", "Description", "Manufacturer Part No.", "Manufacturer", "Qty / Set", "Status", "Supplier", "Remarks", "Row ID"]);

  it("reads the hidden Row ID column", () => {
    expect([...hm.values()]).toContain("row_id");
  });

  it("title rows and the UNASSIGNED banner are ignored; a real part that names its sub-assembly is kept even without qty", () => {
    const { rows, sections } = parseBomRows(
      [
        ["MH063-100  ·  MACHINE BASE", null, "MH063-100  ·  MACHINE BASE", null, null, null, null, null, null, null],
        ["MH063-110-00", null, "MH063-110-00", null, null, null, null, null, null, null],
        ["110-01", "MH063-110-00", "Curtain Sensor", "BW20-32", "Autonics", 1, "Finalized – Not Purchased", null, null, "R0001"],
        ["110-02", "MH063-110-00", "MH063-110-005", null, null, null, null, null, null, "R0002"], // fabricated part, qty not filled yet
        [null, null, "UNASSIGNED  ·  ⚠  Sub-Assembly not set", null, null, null, null, null, null, null],
        [null, null, "Sample", null, null, 8, null, null, null, "R0003"],
      ],
      hm,
      11
    );
    expect(sections).toBe(3);
    expect(rows.map((r) => r.description)).toEqual(["Curtain Sensor", "MH063-110-005", "Sample"]);
    expect(rows[0].row_id).toBe("R0001");
  });

  it("matches by Row ID even when the description changed", () => {
    const existing = [item({ id: 1 })];
    const plan = planImport([{ source_row: 11, row_id: "R0001", description: "CYLINDER (revised)", part_no: "CDU16-25D", sub_assembly: "120 SINGULATOR" }], existing);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates[0]).toMatchObject({ id: 1, changed: ["description"] });
  });

  it("re-importing the same file twice never multiplies identical lines", () => {
    // Three identical "Air Cylinder" lines, as in MH063.
    const file = ["R0001", "R0002", "R0003"].map((row_id, n) => ({
      source_row: 11 + n, row_id, sub_assembly: "MH063-120-00", description: "Air Cylinder", qty: 2,
    }));
    const first = planImport(file, []);
    expect(first.inserts).toHaveLength(3);
    const existing = file.map((r, n) => item({ id: n + 1, row_id: r.row_id, sub_assembly: r.sub_assembly, description: r.description, part_no: null, qty: 2, total_qty: 2 }));
    const second = planImport(file, existing);
    expect(second.inserts).toHaveLength(0);
    expect(second.unchanged).toBe(3);
  });

  it("legacy files without Row IDs pair identical lines one-to-one (no duplicates on re-import)", () => {
    const line = { sub_assembly: "MH063-120-00", description: "06-050", qty: 2 };
    const existing = [1, 2, 3].map((id) => item({ id, ...line, part_no: null, total_qty: 2 }));
    const plan = planImport([1, 2, 3].map((n) => ({ source_row: n, ...line })), existing);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.unchanged).toBe(3);
    // one more line in the file than in the tracker → exactly one new part
    expect(planImport([1, 2, 3, 4].map((n) => ({ source_row: n, ...line })), existing).inserts).toHaveLength(1);
  });

  it("engineering columns refresh; purchasing and assembly columns are never overwritten on existing parts", () => {
    const existing = [item({ id: 1, status: "purchased", supplier: "Misumi", po_no: "PO-1", eta: "2026-11-01", qty_issued: 1 })];
    const plan = planImport(
      [{ source_row: 11, row_id: "R0001", qty: 4, status: "finalized", supplier: "Someone else", po_no: "PO-2", eta: "2026-12-01", qty_issued: 9 }],
      existing
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].patch).toEqual({ qty: 4 });
    expect(plan.ignoredOwned).toBe(5);
  });

  it("new parts are seeded with everything in the file, purchasing columns included", () => {
    const plan = planImport([{ source_row: 11, row_id: "R0100", description: "NEW", status: "purchased", supplier: "SMC", po_no: "PO-7" }], []);
    expect(plan.inserts[0]).toMatchObject({ status: "purchased", supplier: "SMC", po_no: "PO-7", row_id: "R0100" });
  });

  it("a file may release a design or cancel an unordered part, nothing else about status", () => {
    expect(fileMayChangeStatus("not_finalized", "finalized")).toBe(true);
    expect(fileMayChangeStatus("finalized", "cancelled")).toBe(true);
    expect(fileMayChangeStatus("purchased", "cancelled")).toBe(false);
    expect(fileMayChangeStatus("received", "finalized")).toBe(false);
    expect(fileMayChangeStatus("purchased", "not_finalized")).toBe(false);
    const plan = planImport([{ source_row: 1, row_id: "R0001", status: "finalized" }], [item({ id: 1, status: "not_finalized" })]);
    expect(plan.updates[0].patch.status).toBe("finalized");
  });

  it("flags engineering changes to parts that are already ordered", () => {
    const existing = [item({ id: 1, status: "purchased" }), item({ id: 2, status: "not_finalized" })];
    const plan = planImport(
      [
        { source_row: 1, row_id: "R0001", qty: 8, remarks: "rev B" },
        { source_row: 2, row_id: "R0002", qty: 8 },
      ],
      existing
    );
    expect(plan.updates.find((u) => u.id === 1)!.orderSensitive).toEqual(["qty"]);
    expect(plan.updates.find((u) => u.id === 2)!.orderSensitive).toEqual([]);
  });

  it("lists parts the new revision dropped, but only when the file carries Row IDs", () => {
    const existing = [item({ id: 1 }), item({ id: 2 }), item({ id: 3, status: "cancelled" })];
    const withIds = planImport([{ source_row: 1, row_id: "R0001", description: "CYLINDER" }], existing);
    expect(withIds.missing.map((m) => m.id)).toEqual([2]); // 3 is already cancelled
    const withoutIds = planImport([{ source_row: 1, sub_assembly: "120 SINGULATOR", description: "CYLINDER", part_no: "CDU16-25D" }], existing);
    expect(withoutIds.missing).toEqual([]);
    // rows the user chose to leave out of the import still count as "in the file"
    const skipped = planImport([{ source_row: 1, row_id: "R0001", description: "CYLINDER" }], existing, { presentRowIds: ["R0001", "R0002"] });
    expect(skipped.missing).toEqual([]);
  });

  it("a Row ID repeated inside the file gets a fresh id for the extra copy", () => {
    const plan = planImport(
      [
        { source_row: 1, row_id: "R0500", description: "A" },
        { source_row: 2, row_id: "R0500", description: "A copy" },
      ],
      []
    );
    expect(plan.inserts[0].row_id).toBe("R0500");
    expect(plan.inserts[1].row_id).toBeUndefined();
  });

  it("discipline falls back to the category", () => {
    expect(disciplineFromCategory("Pneumatic")).toBe("pneumatic");
    expect(disciplineFromCategory("Electrical / Control")).toBe("electrical");
    expect(disciplineFromCategory("Sensor")).toBe("electrical");
    expect(disciplineFromCategory("Fabricated Part")).toBe("mechanical");
    expect(disciplineFromCategory("Vision")).toBe("software");
    expect(disciplineFromCategory("Something else")).toBeNull();
    expect(disciplineFromCategory(null)).toBeNull();
  });
});
