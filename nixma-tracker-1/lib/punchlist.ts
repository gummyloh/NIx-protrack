import { Task } from "./types";

export interface PunchItem {
  id: string;
  project_id: string;
  item_no: number | null;
  module: string;
  station: string;
  category: string; // Design / POC / Procurement / Assembly / Testing
  item_scope: string;
  acceptance_criteria: string | null;
  priority: string; // Critical / High / Medium / Low
  status: string; // Not Started / In Progress / Completed
  percent_complete: number;
  target_date: string | null; // ISO date
  pic: string | null;
  remarks: string | null;
  source: string;
  created_at: string;
  updated_at: string | null;
}

export type StationRag = "on_track" | "at_risk" | "blocked";

export const RAG_LABEL: Record<StationRag, string> = {
  on_track: "On track",
  at_risk: "At risk",
  blocked: "Blocked",
};

export const RAG_COLOR: Record<StationRag, string> = {
  on_track: "var(--accent)",
  at_risk: "var(--amber)",
  blocked: "var(--rust)",
};

export interface StationRollup {
  module: string;
  station: string;
  items: PunchItem[];
  avgPercent: number;
  rag: StationRag;
  ragReason: string | null;
  nextTargetDate: string | null;
  linkedTasks: Task[];
}

export interface ModuleRollup {
  module: string;
  stations: StationRollup[];
  onTrack: number;
  atRisk: number;
  blocked: number;
}

// Canonical display order -- matches the order Teleflex's own punch list
// uses, not alphabetical, so the rollup reads the same way their sheet does.
export const MODULE_ORDER = [
  "Module 1: Pouch Loading (Singulator)",
  "Module 2: Rotary Indexer (Section 1)",
  "Module 3: Packing & Sealing (Section 2)",
];

export const STATION_ORDER = [
  "Pouch Singulator (Loading)",
  "Transfer & Rotary Indexer",
  "Vacuum Suction & Mandrel Insertion",
  "Manual Catheter Insertion",
  "Automated Top Sealing",
  "Gantry Transfer (to Section 2)",
  "Unloading Conveyor",
  "Manual Coiling & Packing",
  "Cavity & Bottom Sealing",
  "Loading Conveyor & Inspection Handoff",
];

export const CATEGORY_ORDER = ["Design", "POC", "Procurement", "Assembly", "Testing"];

function orderIndex(order: string[], value: string): number {
  const i = order.indexOf(value);
  return i === -1 ? order.length : i;
}

/**
 * A station's RAG status, derived entirely from what's on the punch list --
 * no hidden thresholds. Checks run in priority order:
 *   1. blocked  -- any item's remarks literally flag it as not yet scoped
 *      (e.g. "concept not discussed")
 *   2. at risk  -- a target date has already passed while the item is still
 *      incomplete; or an item's design is marked "concept finalised" in
 *      remarks but its own status field still reads "Not Started" (a
 *      tracking mismatch, not just a scheduling one); or a target date
 *      lands within the next 14 days with the item still incomplete
 *   3. on track -- none of the above
 */
export function computeStationRag(
  items: PunchItem[],
  today: Date
): { rag: StationRag; reason: string | null } {
  const blocker = items.find((it) =>
    (it.remarks || "").toLowerCase().includes("not discussed")
  );
  if (blocker) {
    return { rag: "blocked", reason: `${blocker.item_scope}: concept not discussed` };
  }

  const overdue = items.find(
    (it) =>
      it.target_date &&
      it.percent_complete < 100 &&
      new Date(it.target_date + "T12:00:00Z").getTime() < today.getTime()
  );
  if (overdue) {
    return { rag: "at_risk", reason: `${overdue.item_scope}: target date passed` };
  }

  const mismatch = items.find(
    (it) =>
      (it.remarks || "").toLowerCase().includes("concept finalised") &&
      it.status === "Not Started"
  );
  if (mismatch) {
    return {
      rag: "at_risk",
      reason: `${mismatch.item_scope}: concept finalised but status not updated`,
    };
  }

  const upcoming = items.find(
    (it) => it.target_date && it.percent_complete < 100 && daysUntil(it.target_date, today) <= 14
  );
  if (upcoming) {
    return { rag: "at_risk", reason: `${upcoming.item_scope}: due ${upcoming.target_date}` };
  }

  return { rag: "on_track", reason: null };
}

function daysUntil(iso: string, today: Date): number {
  const target = new Date(iso + "T12:00:00Z").getTime();
  return Math.round((target - today.getTime()) / (24 * 60 * 60 * 1000));
}

export function buildModuleRollup(
  punchItems: PunchItem[],
  tasks: Task[],
  today: Date
): ModuleRollup[] {
  const byModule = new Map<string, Map<string, PunchItem[]>>();

  for (const item of punchItems) {
    if (!byModule.has(item.module)) byModule.set(item.module, new Map());
    const byStation = byModule.get(item.module)!;
    if (!byStation.has(item.station)) byStation.set(item.station, []);
    byStation.get(item.station)!.push(item);
  }

  const modules: ModuleRollup[] = Array.from(byModule.entries())
    .sort((a, b) => orderIndex(MODULE_ORDER, a[0]) - orderIndex(MODULE_ORDER, b[0]))
    .map(([module, byStation]) => {
      const stations: StationRollup[] = Array.from(byStation.entries())
        .sort((a, b) => orderIndex(STATION_ORDER, a[0]) - orderIndex(STATION_ORDER, b[0]))
        .map(([station, items]) => {
          const avgPercent = Math.round(
            items.reduce((sum, it) => sum + it.percent_complete, 0) / items.length
          );
          const { rag, reason } = computeStationRag(items, today);
          const targets = items
            .filter((it) => it.target_date && it.percent_complete < 100)
            .map((it) => it.target_date as string)
            .sort();
          const linkedTasks = tasks.filter((t) => t.stations && t.stations.includes(station));
          return {
            module,
            station,
            items: [...items].sort(
              (a, b) =>
                orderIndex(CATEGORY_ORDER, a.category) - orderIndex(CATEGORY_ORDER, b.category)
            ),
            avgPercent,
            rag,
            ragReason: reason,
            nextTargetDate: targets[0] || null,
            linkedTasks,
          };
        });

      return {
        module,
        stations,
        onTrack: stations.filter((s) => s.rag === "on_track").length,
        atRisk: stations.filter((s) => s.rag === "at_risk").length,
        blocked: stations.filter((s) => s.rag === "blocked").length,
      };
    });

  return modules;
}
