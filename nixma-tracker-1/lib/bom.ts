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
  stock: "From Stock",
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
  // Parts taken from store stock are never requisitioned.
  if (item.status === "finalized" && !item.pr_no?.trim() && item.make_buy !== "stock") flags.push("NEED_PR");
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

// ─── Excel import ─────────────────────────────────────────────────────
// Header mapping, row parsing, sheet detection and import planning live in
// bomImport.ts; re-exported so existing imports from "./bom" keep working.
export * from "./bomImport";

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
