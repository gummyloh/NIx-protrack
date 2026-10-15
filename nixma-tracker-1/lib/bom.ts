import {
  BomItem,
  BomStatus,
  BomDiscipline,
  BomMakeBuy,
  BomClientStatus,
  ModuleRow,
  StationRow,
} from "./types";

// ─── Labels & colours ─────────────────────────────────────────────────
// Status names and colours follow the legend engineering already uses in
// their Excel master lists, so the tracker reads the same as the file.

export const BOM_STATUSES: BomStatus[] = [
  "not_finalized",
  "finalized",
  "purchased",
  "received",
  "nsw_purchased",
  "nsw_requested",
  "cancelled",
];

export const BOM_STATUS_LABEL: Record<BomStatus, string> = {
  not_finalized: "Not Finalized",
  finalized: "Finalized – Not Purchased",
  purchased: "Purchased – Not Received",
  received: "Received",
  nsw_purchased: "NSW Purchased",
  nsw_requested: "New Request to NSW",
  cancelled: "Cancelled",
};

/** Background tint + text colour for status chips. */
export const BOM_STATUS_STYLE: Record<BomStatus, { bg: string; fg: string }> = {
  not_finalized: { bg: "#FFE69966", fg: "#7a5b00" },
  finalized: { bg: "#e6e8f0", fg: "#1c2a24" },
  purchased: { bg: "#F8CBAD80", fg: "#8a3d0c" },
  received: { bg: "#92D05055", fg: "#2e5a0f" },
  nsw_purchased: { bg: "#00B0F033", fg: "#005a7a" },
  nsw_requested: { bg: "#FF000026", fg: "#a10000" },
  cancelled: { bg: "#c4c4c440", fg: "#6b6b6b" },
};

export const BOM_DISCIPLINES: BomDiscipline[] = ["mechanical", "electrical", "pneumatic", "software", "others"];
export const BOM_DISCIPLINE_LABEL: Record<BomDiscipline, string> = {
  mechanical: "Mechanical",
  electrical: "Electrical",
  pneumatic: "Pneumatic",
  software: "Software / Vision",
  others: "Others",
};

export const BOM_MAKE_BUY_LABEL: Record<BomMakeBuy, string> = {
  buy: "Buy",
  make: "Make (Fabricate)",
  customer: "Customer Supplied",
};

export const BOM_CATEGORIES = [
  "Fabricated Part",
  "Std Mechanical",
  "Pneumatic",
  "Vacuum",
  "Motion / Actuator",
  "Electrical / Control",
  "Sensor",
  "Vision",
  "Safety",
  "Consumable / Others",
];

export const BOM_UNITS = ["Pcs", "Set", "Mtr", "Lot", "Roll"];

export const CLIENT_STATUS_LABEL: Record<BomClientStatus, string> = {
  in_design: "In Design",
  released: "Design Released",
  ordered: "Ordered",
  received: "Received",
};

// ─── Status groupings ─────────────────────────────────────────────────

const ORDERED: BomStatus[] = ["purchased", "received", "nsw_purchased"];
const RECEIVED: BomStatus[] = ["received", "nsw_purchased"];

export const isActive = (i: Pick<BomItem, "status">) => i.status !== "cancelled";
export const isFinalized = (i: Pick<BomItem, "status">) => isActive(i) && i.status !== "not_finalized";
export const isOrdered = (i: Pick<BomItem, "status">) => ORDERED.includes(i.status);
export const isReceived = (i: Pick<BomItem, "status">) => RECEIVED.includes(i.status);

export function toClientStatus(s: BomStatus): BomClientStatus {
  if (RECEIVED.includes(s)) return "received";
  if (s === "purchased") return "ordered";
  if (s === "finalized" || s === "nsw_requested") return "released";
  return "in_design";
}

// ─── Flags ────────────────────────────────────────────────────────────

export type BomFlag = "NO_QTY" | "NO_PART_NO" | "OVERDUE" | "LATE_VS_REQ" | "NEED_PR" | "SHORT" | "NO_STATION";

export const BOM_FLAG_LABEL: Record<BomFlag, string> = {
  NO_QTY: "No qty",
  NO_PART_NO: "No part no.",
  OVERDUE: "Overdue",
  LATE_VS_REQ: "Late vs required",
  NEED_PR: "Need PR",
  SHORT: "Short received",
  NO_STATION: "No station",
};

export const BOM_FLAG_HELP: Record<BomFlag, string> = {
  NO_QTY: "Qty per set is blank — engineer to fill",
  NO_PART_NO: "Bought item without a manufacturer part no.",
  OVERDUE: "ETA has passed and the item isn't received — chase supplier",
  LATE_VS_REQ: "Supplier ETA is after the required date — escalate",
  NEED_PR: "Finalized but no PR raised yet",
  SHORT: "Received less than the total qty",
  NO_STATION: "Not linked to a station — won't roll up",
};

/** Flags that mean something is late or blocking, vs. data still missing. */
export const BOM_FLAG_SEVERE: BomFlag[] = ["OVERDUE", "LATE_VS_REQ", "SHORT"];

type FlagInput = Pick<
  BomItem,
  "status" | "qty" | "make_buy" | "part_no" | "eta" | "required_date" | "pr_no" | "qty_received" | "total_qty" | "station_id"
>;

/** ISO yyyy-mm-dd for "today" in local time; passed in so tests are deterministic. */
export function todayIso(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function bomFlags(item: FlagInput, today: string = todayIso()): BomFlag[] {
  if (item.status === "cancelled") return [];
  const flags: BomFlag[] = [];
  const received = isReceived(item);
  if (item.qty == null) flags.push("NO_QTY");
  if (item.make_buy === "buy" && !item.part_no?.trim()) flags.push("NO_PART_NO");
  if (item.eta && !received && item.eta < today) flags.push("OVERDUE");
  if (item.eta && item.required_date && item.eta > item.required_date && !received) flags.push("LATE_VS_REQ");
  if (item.status === "finalized" && !item.pr_no?.trim()) flags.push("NEED_PR");
  if (item.qty_received != null && item.total_qty != null && item.qty_received < item.total_qty) flags.push("SHORT");
  if (item.station_id == null) flags.push("NO_STATION");
  return flags;
}

// ─── Rollup ───────────────────────────────────────────────────────────

export interface BomCounts {
  lines: number;
  finalized: number;
  ordered: number;
  received: number;
  overdue: number;
  flagged: number;
}

function emptyCounts(): BomCounts {
  return { lines: 0, finalized: 0, ordered: 0, received: 0, overdue: 0, flagged: 0 };
}

function addTo(c: BomCounts, item: BomItem, today: string) {
  if (!isActive(item)) return;
  const flags = bomFlags(item, today);
  c.lines += 1;
  if (isFinalized(item)) c.finalized += 1;
  if (isOrdered(item)) c.ordered += 1;
  if (isReceived(item)) c.received += 1;
  if (flags.includes("OVERDUE")) c.overdue += 1;
  if (flags.length) c.flagged += 1;
}

export interface StationBomRollup {
  station: StationRow;
  counts: BomCounts;
}
export interface ModuleBomRollup {
  module: ModuleRow;
  counts: BomCounts;
  stations: StationBomRollup[];
}
export interface BomRollup {
  total: BomCounts;
  modules: ModuleBomRollup[];
  unassigned: BomCounts;
}

export function computeBomRollup(
  items: BomItem[],
  modules: ModuleRow[],
  stations: StationRow[],
  today: string = todayIso()
): BomRollup {
  const total = emptyCounts();
  const unassigned = emptyCounts();
  const byStation = new Map<number, BomCounts>();
  for (const s of stations) byStation.set(s.id, emptyCounts());

  for (const it of items) {
    addTo(total, it, today);
    const c = it.station_id != null ? byStation.get(it.station_id) : undefined;
    addTo(c ?? unassigned, it, today);
  }

  const mods = [...modules]
    .sort((a, b) => a.sequence - b.sequence)
    .map((m) => {
      const st = stations
        .filter((s) => s.module_id === m.id)
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => ({ station: s, counts: byStation.get(s.id)! }));
      const counts = emptyCounts();
      for (const s of st) {
        (Object.keys(counts) as (keyof BomCounts)[]).forEach((k) => (counts[k] += s.counts[k]));
      }
      return { module: m, counts, stations: st };
    });

  return { total, modules: mods, unassigned };
}

export const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));

// ─── Excel import mapping ─────────────────────────────────────────────
// Header names accepted from the company template and from older master
// lists engineers copy forward from previous projects.

export type BomField = keyof Pick<
  BomItem,
  | "row_id" | "sub_assembly" | "discipline" | "description" | "part_no" | "manufacturer" | "category"
  | "qty" | "multiple" | "unit" | "make_buy" | "drawing_no" | "nsw_part_no" | "engineer_pic"
  | "issue_date" | "required_date" | "status" | "supplier" | "pr_no" | "po_no" | "po_date"
  | "eta" | "do_invoice_no" | "qty_received" | "received_date" | "unit_price"
  | "qty_issued" | "issued_to" | "issued_date" | "remarks"
> | "tracker_id" | "station_name";


// ─── Who owns which column ────────────────────────────────────────────
// Mirrors the colour bands of the company BOM template. Engineering's Excel
// stays the source for the blue columns: a re-import refreshes them. The
// green (purchasing) and orange (assembly) columns belong to the tracker once
// a part exists here — values for them in a re-imported file are ignored, so a
// stale Excel can never roll back a PO or a goods-received entry. They are
// only read when a part is first created (seeding a new project).

export const ENGINEERING_FIELDS = [
  "sub_assembly", "discipline", "description", "part_no", "manufacturer", "category",
  "qty", "multiple", "unit", "make_buy", "drawing_no", "nsw_part_no", "engineer_pic",
  "issue_date", "required_date", "remarks",
] as const;

export const PURCHASING_FIELDS = [
  "status", "supplier", "pr_no", "po_no", "po_date", "eta", "do_invoice_no", "qty_received", "received_date",
] as const;

export const ASSEMBLY_FIELDS = ["qty_issued", "issued_to", "issued_date"] as const;

/** Engineering edits that matter once a part has been ordered — shown as a warning in the import preview. */
export const ORDER_SENSITIVE_FIELDS = ["description", "part_no", "manufacturer", "qty", "multiple", "unit", "make_buy", "drawing_no"] as const;

/**
 * The one purchasing-column value a file may still change on an existing part:
 * engineering can release a design (Not Finalized → Finalized) or cancel a
 * part that hasn't been ordered. Anything else about Status stays in the tracker.
 */
export function fileMayChangeStatus(current: BomStatus, fromFile: BomStatus): boolean {
  if (current === fromFile) return false;
  if (fromFile === "cancelled") return current !== "purchased" && current !== "received" && current !== "nsw_purchased";
  return current === "not_finalized" && fromFile === "finalized";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const HEADER_ALIASES: Record<string, BomField> = {
  trackerid: "tracker_id",
  rowid: "row_id",
  station: "station_name",
  subassembly: "sub_assembly",
  subassy: "sub_assembly",
  discipline: "discipline",
  description: "description",
  manufacturerpartno: "part_no",
  partno: "part_no",
  partnumber: "part_no",
  manufacturer: "manufacturer",
  brand: "manufacturer",
  brandmaker: "manufacturer",
  category: "category",
  qtyset: "qty",
  qty: "qty",
  multiple: "multiple",
  unit: "unit",
  makebuy: "make_buy",
  drawingnorev: "drawing_no",
  drawingno: "drawing_no",
  nswpartno: "nsw_part_no",
  engineerpic: "engineer_pic",
  issuedate: "issue_date",
  requireddate: "required_date",
  status: "status",
  procurementstatus: "status",
  supplier: "supplier",
  prno: "pr_no",
  pono: "po_no",
  podate: "po_date",
  eta: "eta",
  doinvoiceno: "do_invoice_no",
  qtyreceived: "qty_received",
  receiveddate: "received_date",
  unitpricerm: "unit_price",
  unitprice: "unit_price",
  qtyissued: "qty_issued",
  takenby: "issued_to",
  issuedateassy: "issued_date",
  remarks: "remarks",
  remark: "remarks",
};

/** Maps a header row to column index → field. Unknown headers are ignored. */
export function mapHeaders(headers: (string | null | undefined)[]): Map<number, BomField> {
  const out = new Map<number, BomField>();
  const seen = new Set<BomField>();
  headers.forEach((h, i) => {
    if (!h) return;
    const f = HEADER_ALIASES[norm(String(h))];
    // First match wins: older lists have both "Issue Date" (engineering)
    // and a later "Date" under Assembly; template has "Issue Date (Assy)".
    if (f && !seen.has(f)) {
      out.set(i, f);
      seen.add(f);
    }
  });
  return out;
}

export function parseStatus(v: string | null | undefined): BomStatus | null {
  if (!v) return null;
  const n = norm(v);
  if (!n) return null;
  if (n.includes("cancel")) return "cancelled";
  if (n.includes("nsw") && (n.includes("request") || n.includes("new"))) return "nsw_requested";
  if (n.includes("nsw")) return "nsw_purchased";
  if (n.startsWith("not") || n.includes("notyet") || n.includes("indesign")) return "not_finalized";
  // "Finalized – Not Purchased" contains "purchased", so test it first.
  if (n.startsWith("final") || n.includes("released")) return "finalized";
  if (n.includes("purchased") || n.includes("ordered") || n.includes("poissued") || n.includes("intransit")) return "purchased";
  if (n.includes("received")) return "received";
  if (n.includes("final") || n.includes("released")) return "finalized";
  return null;
}

export function parseDiscipline(v: string | null | undefined): BomDiscipline | null {
  if (!v) return null;
  const n = norm(v);
  if (n.startsWith("mech")) return "mechanical";
  if (n.startsWith("elec")) return "electrical";
  if (n.startsWith("pneu")) return "pneumatic";
  if (n.startsWith("soft") || n.includes("vision")) return "software";
  if (n) return "others";
  return null;
}

/** The v4 template has no Discipline column; infer it from Category so the BOM page's filter still works. */
export function disciplineFromCategory(category: string | null | undefined): BomDiscipline | null {
  if (!category) return null;
  const n = norm(category);
  if (n.startsWith("electr") || n === "sensor") return "electrical";
  if (n.startsWith("pneu") || n.startsWith("vacuum")) return "pneumatic";
  if (n.startsWith("vision") || n.startsWith("soft")) return "software";
  if (n.startsWith("fabricated") || n.startsWith("stdmech") || n.startsWith("motion") || n.startsWith("safety")) return "mechanical";
  if (n.startsWith("consumable")) return "others";
  return null;
}

export function parseMakeBuy(v: string | null | undefined): BomMakeBuy | null {
  if (!v) return null;
  const n = norm(v);
  if (n.startsWith("make") || n.includes("fabric")) return "make";
  if (n.startsWith("cust")) return "customer";
  if (n.startsWith("buy")) return "buy";
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Accepts a JS Date, ISO string, dd-mmm-yy(yy), or dd/mm/yyyy. Returns yyyy-mm-dd or null. */
export function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    // exceljs returns dates as UTC midnight
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/](\d{2,4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function parseNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return isFinite(n) ? n : null;
}

function parseText(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export type ParsedBomRow = Partial<Omit<BomItem, "id" | "project_id" | "station_id" | "total_qty">> & {
  tracker_id?: number;
  station_name?: string;
  source_row: number;
};

const SECTION_RE = /^[A-Z]{1,4}\d{2,4}(-[0-9A-Z]{1,4})+(\s|$)/;
// The v4 template keeps title rows ("MH063-100 · MACHINE BASE") and an UNASSIGNED banner in the data area.
const BANNER_RE = /^unassigned\b/i;

/**
 * Turns raw sheet rows (already sliced below the header) into BOM rows.
 * Old-style master lists group parts under section title rows such as
 * "MH063-120-00 SINGULATOR" — those become the sub_assembly of the rows
 * beneath them when the file has no Sub-Assembly column.
 */
export function parseBomRows(
  cells: unknown[][],
  headerMap: Map<number, BomField>,
  firstRowNumber: number
): { rows: ParsedBomRow[]; skipped: number; sections: number } {
  const rows: ParsedBomRow[] = [];
  let skipped = 0;
  let sections = 0;
  let section: string | null = null;
  const hasSubAssyCol = [...headerMap.values()].includes("sub_assembly");

  cells.forEach((row, idx) => {
    const get = (f: BomField) => {
      for (const [i, field] of headerMap) if (field === f) return row[i];
      return undefined;
    };
    const desc = parseText(get("description"));
    const pn = parseText(get("part_no"));
    const qty = parseNum(get("qty"));
    const mfr = parseText(get("manufacturer"));

    if (!desc) {
      if (row.some((c) => parseText(c))) skipped += 1;
      return;
    }
    // Title/banner rows carry no part data. When the file has a Sub-Assembly
    // column, a row that names its sub-assembly is always a real part.
    const subCell = parseText(get("sub_assembly"));
    const idCell = parseText(get("row_id"));
    const titleLike = SECTION_RE.test(desc) || BANNER_RE.test(desc);
    if (titleLike && !pn && qty == null && !mfr && !idCell && !(hasSubAssyCol && subCell)) {
      sections += 1;
      if (!hasSubAssyCol) section = desc;
      return;
    }

    const out: ParsedBomRow = { description: desc, source_row: firstRowNumber + idx };
    for (const [i, field] of headerMap) {
      const raw = row[i];
      switch (field) {
        case "tracker_id": {
          const n = parseNum(raw);
          if (n != null) out.tracker_id = n;
          break;
        }
        case "description":
          break;
        case "qty": case "multiple": case "qty_received": case "unit_price": case "qty_issued": {
          const n = parseNum(raw);
          if (n != null) out[field] = n;
          break;
        }
        case "issue_date": case "required_date": case "po_date": case "eta":
        case "received_date": case "issued_date": {
          const d = parseDate(raw);
          if (d) out[field] = d;
          break;
        }
        case "status": {
          const s = parseStatus(parseText(raw));
          if (s) out.status = s;
          break;
        }
        case "discipline": {
          const d = parseDiscipline(parseText(raw));
          if (d) out.discipline = d;
          break;
        }
        case "make_buy": {
          const m = parseMakeBuy(parseText(raw));
          if (m) out.make_buy = m;
          break;
        }
        default: {
          const t = parseText(raw);
          if (t) (out as Record<string, unknown>)[field] = t;
        }
      }
    }
    if (!out.sub_assembly && section) out.sub_assembly = section;
    if (out.unit) out.unit = normalizeUnit(out.unit);
    rows.push(out);
  });
  return { rows, skipped, sections };
}

export function normalizeUnit(u: string): string {
  const n = norm(u);
  if (n.startsWith("pc")) return "Pcs";
  if (n.startsWith("set")) return "Set";
  if (n.startsWith("m")) return "Mtr";
  if (n.startsWith("lot")) return "Lot";
  if (n.startsWith("roll")) return "Roll";
  return u.trim();
}

/** Identity used to match a re-imported row when the file carries no Row ID (older master lists). */
export function matchKey(r: { sub_assembly?: string | null; part_no?: string | null; description?: string | null }): string {
  const sa = norm(r.sub_assembly ?? "");
  return r.part_no?.trim() ? `${sa}|pn:${norm(r.part_no)}` : `${sa}|d:${norm(r.description ?? "")}`;
}

export interface ImportUpdate {
  id: number;
  patch: Partial<BomItem>;
  changed: string[];
  row: ParsedBomRow;
  /** Engineering edits that affect a part which has already been ordered/received — procurement should look. */
  orderSensitive: string[];
}

export interface ImportPlan {
  inserts: ParsedBomRow[];
  updates: ImportUpdate[];
  unchanged: number;
  /** Tracker parts the file no longer lists. Only computed when the file carries Row IDs. Never deleted automatically. */
  missing: BomItem[];
  /** Purchasing/assembly cells in the file that were ignored because the tracker already owns them. */
  ignoredOwned: number;
}

const OWNED_BY_TRACKER = new Set<string>([...PURCHASING_FIELDS, ...ASSEMBLY_FIELDS]);
const ENGINEERING = new Set<string>(ENGINEERING_FIELDS);
const SKIP_KEYS = new Set(["source_row", "tracker_id", "station_name", "row_id", "unit_price"]);

/**
 * Plans an import without touching the database.
 *
 * Matching, in order: Row ID (the template's hidden column), Tracker ID
 * (files exported from the tracker), then — only for rows that carry neither —
 * sub-assembly + part no. (or description). Each existing part can be matched
 * once, so repeated identical lines pair up one-to-one instead of multiplying
 * on every re-import.
 *
 * For matched parts only engineering columns are refreshed, and only from
 * non-empty cells (a blank in Excel never wipes tracker data). Purchasing and
 * assembly columns are left alone — see ENGINEERING_FIELDS above — except the
 * narrow status moves allowed by fileMayChangeStatus. Unmatched rows are
 * inserted with everything the file has, which is how a new project is seeded.
 */
export function planImport(
  parsed: ParsedBomRow[],
  existing: BomItem[],
  opts: { presentRowIds?: Iterable<string> } = {}
): ImportPlan {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const byRowId = new Map<string, BomItem>();
  for (const e of existing) if (e.row_id) byRowId.set(e.row_id, e);
  const byKey = new Map<string, BomItem[]>();
  for (const e of existing) {
    const k = matchKey(e);
    const list = byKey.get(k);
    if (list) list.push(e); else byKey.set(k, [e]);
  }

  const plan: ImportPlan = { inserts: [], updates: [], unchanged: 0, missing: [], ignoredOwned: 0 };
  const claimed = new Set<number>();
  const newRowIds = new Set<string>();

  for (const row of parsed) {
    let hit: BomItem | undefined;
    if (row.row_id) hit = byRowId.get(row.row_id);
    if (!hit && row.tracker_id != null) hit = byId.get(row.tracker_id);
    if (!hit && !row.row_id) hit = byKey.get(matchKey(row))?.find((e) => !claimed.has(e.id));

    if (!hit || claimed.has(hit.id)) {
      // A Row ID that repeats inside the file (copy-pasted row) would break the
      // unique key: let the database assign a fresh one to the extra copy.
      const dup = !!row.row_id && (!!hit || newRowIds.has(row.row_id));
      if (row.row_id && !dup) newRowIds.add(row.row_id);
      if (dup) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { row_id, ...rest } = row;
        plan.inserts.push(rest);
      } else {
        plan.inserts.push(row);
      }
      continue;
    }

    claimed.add(hit.id);
    const patch: Partial<BomItem> = {};
    const changed: string[] = [];
    for (const [k, v] of Object.entries(row)) {
      if (SKIP_KEYS.has(k) || v == null) continue;
      const cur = (hit as unknown as Record<string, unknown>)[k];
      const same = typeof v === "number" ? Number(cur) === v : cur === v;
      if (same) continue;
      if (k === "status") {
        if (fileMayChangeStatus(hit.status, v as BomStatus)) {
          (patch as Record<string, unknown>).status = v;
          changed.push("status");
        } else {
          plan.ignoredOwned += 1;
        }
        continue;
      }
      if (OWNED_BY_TRACKER.has(k)) { plan.ignoredOwned += 1; continue; }
      if (!ENGINEERING.has(k)) continue;
      (patch as Record<string, unknown>)[k] = v;
      changed.push(k);
    }
    if (changed.length) {
      const ordered = isOrdered(hit);
      const orderSensitive = ordered ? changed.filter((c) => (ORDER_SENSITIVE_FIELDS as readonly string[]).includes(c)) : [];
      plan.updates.push({ id: hit.id, patch, changed, row, orderSensitive });
    } else {
      plan.unchanged += 1;
    }
  }

  const present = new Set(opts.presentRowIds ?? parsed.map((r) => r.row_id).filter((x): x is string => !!x));
  if (present.size > 0) {
    plan.missing = existing.filter((e) => e.row_id && !present.has(e.row_id) && e.status !== "cancelled");
  }
  return plan;
}

/** Best-guess station for a sub-assembly name, by shared words. */
export function guessStation(subAssembly: string, stations: StationRow[]): number | null {
  const words = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
  const sa = words(subAssembly);
  let best: { id: number; score: number } | null = null;
  for (const st of stations) {
    const sw = words(st.name);
    let score = 0;
    sa.forEach((w) => {
      if ([...sw].some((x) => x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))) score += 1;
    });
    if (score > 0 && (!best || score > best.score)) best = { id: st.id, score };
  }
  return best?.id ?? null;
}

// PostgREST returns numeric(…) columns as strings ("4.000"); convert them
// once on load so comparisons and Excel export see real numbers.
const NUMERIC_FIELDS = ["qty", "multiple", "total_qty", "qty_received", "unit_price", "qty_issued"] as const;
export function normalizeBomItems(rows: unknown[] | null | undefined): BomItem[] {
  return (rows ?? []).map((r) => {
    const o = { ...(r as Record<string, unknown>) };
    for (const k of NUMERIC_FIELDS) {
      if (o[k] != null) o[k] = Number(o[k]);
    }
    return o as unknown as BomItem;
  });
}
