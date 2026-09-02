import { ModuleRow, StationRow, PunchItem } from "@/lib/types";

// Readiness is always derived from the current punch items, never stored --
// the same "compute it, don't cache it" choice lib/schedule.ts already
// makes for task status. Only "blocker" severity gates readiness; "minor"
// and "cosmetic" stay visible as open work without turning a station red,
// so the signal doesn't get noisy enough to ignore. "waived" counts the
// same as "closed" -- both just stop blocking.

export function openBlockingItems(items: PunchItem[]): PunchItem[] {
  return items.filter((i) => i.status === "open" && i.severity === "blocker");
}

export function stationReady(items: PunchItem[]): boolean {
  return openBlockingItems(items).length === 0;
}

export interface StationRollup {
  station: StationRow;
  items: PunchItem[];
  ready: boolean;
  openBlockerCount: number;
  openMinorCount: number;
  openCosmeticCount: number;
}

export interface ModuleRollup {
  module: ModuleRow;
  stations: StationRollup[];
  ready: boolean;
  openBlockerCount: number;
}

/**
 * Groups raw modules/stations/punch_items rows (as fetched straight from
 * Supabase) into a nested, sorted, readiness-annotated structure the UI and
 * the client-snapshot builder both consume. Pure function, no I/O -- easy
 * to unit test and reuse in both places without re-fetching.
 */
export function computeModuleRollup(
  modules: ModuleRow[],
  stations: StationRow[],
  punchItems: PunchItem[]
): ModuleRollup[] {
  const stationsByModule = new Map<number, StationRow[]>();
  for (const s of stations) {
    if (!stationsByModule.has(s.module_id)) stationsByModule.set(s.module_id, []);
    stationsByModule.get(s.module_id)!.push(s);
  }

  const itemsByStation = new Map<number, PunchItem[]>();
  for (const p of punchItems) {
    if (!itemsByStation.has(p.station_id)) itemsByStation.set(p.station_id, []);
    itemsByStation.get(p.station_id)!.push(p);
  }

  return [...modules]
    .sort((a, b) => a.sequence - b.sequence || a.id - b.id)
    .map((module) => {
      const moduleStations = (stationsByModule.get(module.id) ?? [])
        .slice()
        .sort((a, b) => a.sequence - b.sequence || a.id - b.id);

      const stationRollups: StationRollup[] = moduleStations.map((station) => {
        const items = itemsByStation.get(station.id) ?? [];
        return {
          station,
          items,
          ready: stationReady(items),
          openBlockerCount: items.filter((i) => i.status === "open" && i.severity === "blocker").length,
          openMinorCount: items.filter((i) => i.status === "open" && i.severity === "minor").length,
          openCosmeticCount: items.filter((i) => i.status === "open" && i.severity === "cosmetic").length,
        };
      });

      return {
        module,
        stations: stationRollups,
        ready: stationRollups.every((s) => s.ready),
        openBlockerCount: stationRollups.reduce((sum, s) => sum + s.openBlockerCount, 0),
      };
    });
}
