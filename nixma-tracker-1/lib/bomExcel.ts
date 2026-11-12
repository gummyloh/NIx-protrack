"use client";

import type { Workbook, Worksheet } from "exceljs";
import { BomItem, ModuleRow, StationRow } from "./types";
import {
  BOM_DISCIPLINE_LABEL,
  BOM_FLAG_LABEL,
  BOM_MAKE_BUY_LABEL,
  BOM_STATUS_LABEL,
  CLIENT_STATUS_LABEL,
  bomFlags,
  readBomSheets,
  SheetRead,
  toClientStatus,
} from "./bom";

// exceljs is ~1MB; only load it when someone actually imports/exports.
async function loadExcel() {
  const mod = await import("exceljs");
  return (mod.default ?? mod) as typeof import("exceljs");
}

function cellValue(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === "object" && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    if ("error" in o) return null; // #N/A, #REF! …
    if ("result" in o) return cellValue(o.result); // formula (result may itself be an error)
    if ("formula" in o || "sharedFormula" in o) return null; // formula never calculated
    if ("richText" in o) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("text" in o) return cellValue(o.text); // hyperlink
    return null;
  }
  return v;
}

function sheetRows(ws: Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const vals = row.values as unknown[]; // 1-based
    rows[n - 1] = Array.from(vals.slice(1), cellValue);
  });
  return Array.from(rows, (r) => r ?? []);
}

export interface ReadResult {
  /** Every sheet that looks like a BOM; `included` says which are ticked by default. */
  sheets: SheetRead[];
}

/**
 * Reads a BOM workbook. All the judgement (which sheets, where the header
 * is, what each cell means) is in bomImport.ts so it can be tested without
 * a browser; this only gets the cells out of the file.
 */
export async function readBomFile(file: File): Promise<ReadResult> {
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "xls") {
    throw new Error("This is an old-format .xls file. Open it in Excel, choose File → Save As → Excel Workbook (.xlsx), and upload that.");
  }
  if (ext === "csv") {
    throw new Error("CSV files can't be imported. Open it in Excel, save as Excel Workbook (.xlsx), and upload that.");
  }
  const ExcelJS = await loadExcel();
  const wb: Workbook = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error("Couldn't open this file. If it's password-protected or still open in Excel, remove the password / close it and try again.");
  }
  const sheets = readBomSheets(
    wb.worksheets.map((ws) => ({ name: ws.name, rows: sheetRows(ws), hidden: ws.state !== "visible" }))
  );
  if (sheets.length === 0) {
    const names = wb.worksheets.map((w) => `“${w.name}”`).join(", ");
    throw new Error(
      `Couldn't find a parts list in this file (looked in ${names}). A sheet needs a header row with a Description column plus Part No. or Qty.`
    );
  }
  return { sheets };
}

// ─── Export ───────────────────────────────────────────────────────────

interface ExportArgs {
  items: BomItem[];
  modules: ModuleRow[];
  stations: StationRow[];
  project: { name: string; customer: string | null; project_code: string | null };
  mode: "internal" | "customer";
}

type Col = { header: string; width: number; get: (i: BomItem, ctx: Ctx) => unknown; date?: boolean; group: "E" | "P" | "A" | "x" };
interface Ctx { itemNo: string; station?: StationRow; module?: ModuleRow; flags: string }

const GROUP_FILL: Record<Col["group"], string> = { E: "FFDDEBF7", P: "FFE2EFDA", A: "FFFCE4D6", x: "FF1F3864" };

function sortedItems(items: BomItem[], modules: ModuleRow[], stations: StationRow[]) {
  const st = new Map(stations.map((s) => [s.id, s]));
  const md = new Map(modules.map((m) => [m.id, m]));
  const key = (i: BomItem) => {
    const s = i.station_id != null ? st.get(i.station_id) : undefined;
    const m = s ? md.get(s.module_id) : undefined;
    return [m?.sequence ?? 9999, s?.sequence ?? 9999, i.sub_assembly ?? "", i.sort_order ?? 0, i.id] as const;
  };
  return [...items].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let n = 0; n < ka.length; n++) if (ka[n] !== kb[n]) return ka[n] < kb[n] ? -1 : 1;
    return 0;
  });
}

const iso = (d: string | null) => (d ? new Date(d + "T00:00:00Z") : null);

export async function exportBomXlsx(a: ExportArgs): Promise<Blob> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Nixtecs Project Tracker";
  const ws = wb.addWorksheet("BOM", { views: [{ state: "frozen", xSplit: 0, ySplit: 5 }] });

  const internal: Col[] = [
    { header: "Tracker ID", width: 9, group: "x", get: (i) => i.id },
    { header: "Item", width: 7, group: "x", get: (_, c) => c.itemNo },
    { header: "Module", width: 22, group: "E", get: (_, c) => c.module?.name ?? "" },
    { header: "Station", width: 26, group: "E", get: (_, c) => c.station?.name ?? "" },
    { header: "Sub-Assembly", width: 24, group: "E", get: (i) => i.sub_assembly },
    { header: "Discipline", width: 12, group: "E", get: (i) => BOM_DISCIPLINE_LABEL[i.discipline] },
    { header: "Description", width: 28, group: "E", get: (i) => i.description },
    { header: "Manufacturer Part No.", width: 20, group: "E", get: (i) => i.part_no },
    { header: "Manufacturer", width: 13, group: "E", get: (i) => i.manufacturer },
    { header: "Category", width: 16, group: "E", get: (i) => i.category },
    { header: "Qty / Set", width: 8, group: "E", get: (i) => i.qty },
    { header: "Multiple", width: 8, group: "E", get: (i) => i.multiple },
    { header: "Total Qty", width: 8, group: "x", get: (i) => i.total_qty },
    { header: "Unit", width: 7, group: "E", get: (i) => i.unit },
    { header: "Make / Buy", width: 13, group: "E", get: (i) => BOM_MAKE_BUY_LABEL[i.make_buy] },
    { header: "Drawing No. / Rev", width: 17, group: "E", get: (i) => i.drawing_no },
    { header: "NSW Part No.", width: 13, group: "E", get: (i) => i.nsw_part_no },
    { header: "Engineer PIC", width: 12, group: "E", get: (i) => i.engineer_pic },
    { header: "Issue Date", width: 11, group: "E", date: true, get: (i) => iso(i.issue_date) },
    { header: "Required Date", width: 11, group: "E", date: true, get: (i) => iso(i.required_date) },
    { header: "Status", width: 24, group: "P", get: (i) => BOM_STATUS_LABEL[i.status] },
    { header: "Supplier", width: 16, group: "P", get: (i) => i.supplier },
    { header: "PR No.", width: 10, group: "P", get: (i) => i.pr_no },
    { header: "PO No.", width: 10, group: "P", get: (i) => i.po_no },
    { header: "PO Date", width: 11, group: "P", date: true, get: (i) => iso(i.po_date) },
    { header: "ETA", width: 11, group: "P", date: true, get: (i) => iso(i.eta) },
    { header: "DO / Invoice No.", width: 13, group: "P", get: (i) => i.do_invoice_no },
    { header: "Qty Received", width: 9, group: "P", get: (i) => i.qty_received },
    { header: "Received Date", width: 11, group: "P", date: true, get: (i) => iso(i.received_date) },
    { header: "Qty Issued", width: 8, group: "A", get: (i) => i.qty_issued },
    { header: "Taken By", width: 11, group: "A", get: (i) => i.issued_to },
    { header: "Issue Date (Assy)", width: 11, group: "A", date: true, get: (i) => iso(i.issued_date) },
    { header: "Flags", width: 22, group: "x", get: (_, c) => c.flags },
    { header: "Remarks", width: 30, group: "E", get: (i) => i.remarks },
  ];

  const customer: Col[] = [
    { header: "Item", width: 7, group: "x", get: (_, c) => c.itemNo },
    { header: "Module", width: 24, group: "x", get: (_, c) => c.module?.name ?? "" },
    { header: "Station", width: 28, group: "x", get: (_, c) => c.station?.name ?? "" },
    { header: "Sub-Assembly", width: 24, group: "x", get: (i) => i.sub_assembly },
    { header: "Discipline", width: 12, group: "x", get: (i) => BOM_DISCIPLINE_LABEL[i.discipline] },
    { header: "Description", width: 30, group: "x", get: (i) => i.description },
    { header: "Manufacturer Part No.", width: 20, group: "x", get: (i) => i.part_no },
    { header: "Manufacturer", width: 14, group: "x", get: (i) => i.manufacturer },
    { header: "Total Qty", width: 9, group: "x", get: (i) => i.total_qty },
    { header: "Unit", width: 7, group: "x", get: (i) => i.unit },
    { header: "Drawing No. / Rev", width: 18, group: "x", get: (i) => i.drawing_no },
    { header: "Status", width: 16, group: "x", get: (i) => CLIENT_STATUS_LABEL[toClientStatus(i.status)] },
    { header: "ETA", width: 11, group: "x", date: true, get: (i) => iso(i.eta) },
  ];

  const cols = a.mode === "internal" ? internal : customer;
  const rows =
    a.mode === "internal"
      ? a.items
      : a.items.filter((i) => i.show_to_client && i.status !== "cancelled");

  const today = new Date();
  ws.getCell("A1").value = a.mode === "internal" ? `${a.project.project_code ?? ""} — BOM Master List (internal)` : "Bill of Materials";
  ws.getCell("A1").font = { name: "Arial", bold: true, size: 14, color: { argb: "FF1F3864" } };
  ws.getCell("A2").value = [a.project.name, a.project.customer, a.project.project_code].filter(Boolean).join(" · ");
  ws.getCell("A3").value = `Exported ${today.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} from Nixtecs Project Tracker`;
  ws.getCell("A2").font = ws.getCell("A3").font = { name: "Arial", size: 9, italic: true, color: { argb: "FF595959" } };
  if (a.mode === "internal") {
    ws.getCell("A4").value = "Keep the Tracker ID column when editing and re-importing — it's how rows are matched.";
    ws.getCell("A4").font = { name: "Arial", size: 9, color: { argb: "FFC00000" } };
  }

  const HR = 5;
  cols.forEach((c, idx) => {
    const cell = ws.getRow(HR).getCell(idx + 1);
    cell.value = c.header;
    cell.font = { name: "Arial", bold: true, size: 9, color: { argb: c.group === "x" ? "FFFFFFFF" : "FF000000" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_FILL[c.group] } };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    ws.getColumn(idx + 1).width = c.width;
  });
  ws.getRow(HR).height = 30;

  const st = new Map(a.stations.map((s) => [s.id, s]));
  const md = new Map(a.modules.map((m) => [m.id, m]));
  const todayStr = new Date().toISOString().slice(0, 10);
  sortedItems(rows, a.modules, a.stations).forEach((it, n) => {
    const station = it.station_id != null ? st.get(it.station_id) : undefined;
    const ctx: Ctx = {
      itemNo: String(n + 1),
      station,
      module: station ? md.get(station.module_id) : undefined,
      flags: bomFlags(it, todayStr).map((f) => BOM_FLAG_LABEL[f]).join(", "),
    };
    const row = ws.getRow(HR + 1 + n);
    cols.forEach((c, idx) => {
      const cell = row.getCell(idx + 1);
      const v = c.get(it, ctx);
      cell.value = (v ?? null) as never;
      cell.font = { name: "Arial", size: 10 };
      if (c.date) cell.numFmt = "dd-mmm-yy";
      cell.border = { bottom: { style: "hair", color: { argb: "FFBFBFBF" } } };
    });
  });
  ws.autoFilter = { from: { row: HR, column: 1 }, to: { row: HR, column: cols.length } };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
