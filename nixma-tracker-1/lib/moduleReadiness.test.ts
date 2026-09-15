import { describe, it, expect } from "vitest";
import { ModuleRow, StationRow, PunchItem } from "./types";
import { openBlockingItems, stationReady, computeModuleRollup } from "./moduleReadiness";

function makeModule(overrides: Partial<ModuleRow>): ModuleRow {
  return {
    id: 1,
    project_id: "test-project",
    name: "Test module",
    sequence: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeStation(overrides: Partial<StationRow>): StationRow {
  return {
    id: 1,
    module_id: 1,
    project_id: "test-project",
    name: "Test station",
    sequence: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePunchItem(overrides: Partial<PunchItem>): PunchItem {
  return {
    id: 1,
    station_id: 1,
    project_id: "test-project",
    description: "Test punch item",
    severity: "blocker",
    status: "open",
    show_to_client: false,
    linked_task_id: null,
    created_at: "2026-01-01T00:00:00Z",
    created_by: null,
    closed_at: null,
    closed_by: null,
    item_no: null,
    category: null,
    priority: null,
    percent_complete: null,
    target_date: null,
    pic: null,
    remarks: null,
    acceptance_criteria: null,
    source: "manual",
    ...overrides,
  };
}

describe("openBlockingItems / stationReady", () => {
  it("only blocker-severity, open items count as blocking", () => {
    const items = [
      makePunchItem({ id: 1, severity: "blocker", status: "open" }),
      makePunchItem({ id: 2, severity: "minor", status: "open" }),
      makePunchItem({ id: 3, severity: "cosmetic", status: "open" }),
    ];
    expect(openBlockingItems(items)).toHaveLength(1);
    expect(stationReady(items)).toBe(false);
  });

  it("is ready when minor/cosmetic items are open but no blockers are", () => {
    const items = [
      makePunchItem({ id: 1, severity: "minor", status: "open" }),
      makePunchItem({ id: 2, severity: "cosmetic", status: "open" }),
    ];
    expect(stationReady(items)).toBe(true);
  });

  it("treats waived the same as closed -- neither blocks", () => {
    const items = [
      makePunchItem({ id: 1, severity: "blocker", status: "closed" }),
      makePunchItem({ id: 2, severity: "blocker", status: "waived" }),
    ];
    expect(stationReady(items)).toBe(true);
  });

  it("is ready with no punch items at all", () => {
    expect(stationReady([])).toBe(true);
  });
});

describe("computeModuleRollup", () => {
  it("groups stations under their module and items under their station", () => {
    const modules = [makeModule({ id: 1, name: "Module A", sequence: 0 })];
    const stations = [
      makeStation({ id: 10, module_id: 1, name: "Station A1", sequence: 0 }),
      makeStation({ id: 11, module_id: 1, name: "Station A2", sequence: 1 }),
    ];
    const items = [
      makePunchItem({ id: 100, station_id: 10, severity: "blocker", status: "open" }),
      makePunchItem({ id: 101, station_id: 11, severity: "minor", status: "open" }),
    ];

    const rollup = computeModuleRollup(modules, stations, items);

    expect(rollup).toHaveLength(1);
    expect(rollup[0].stations).toHaveLength(2);
    expect(rollup[0].stations[0].openBlockerCount).toBe(1);
    expect(rollup[0].stations[0].ready).toBe(false);
    expect(rollup[0].stations[1].ready).toBe(true);
  });

  it("a module is only ready when every one of its stations is ready", () => {
    const modules = [makeModule({ id: 1 })];
    const stations = [
      makeStation({ id: 10, module_id: 1, sequence: 0 }),
      makeStation({ id: 11, module_id: 1, sequence: 1 }),
    ];
    const items = [makePunchItem({ id: 100, station_id: 10, severity: "blocker", status: "open" })];

    const rollup = computeModuleRollup(modules, stations, items);

    expect(rollup[0].ready).toBe(false);
    expect(rollup[0].openBlockerCount).toBe(1);
  });

  it("a module with no open blockers anywhere is ready", () => {
    const modules = [makeModule({ id: 1 })];
    const stations = [makeStation({ id: 10, module_id: 1 })];
    const items = [makePunchItem({ id: 100, station_id: 10, severity: "blocker", status: "closed" })];

    const rollup = computeModuleRollup(modules, stations, items);

    expect(rollup[0].ready).toBe(true);
  });

  it("sorts modules and stations by sequence, then id", () => {
    const modules = [
      makeModule({ id: 2, sequence: 1, name: "Second" }),
      makeModule({ id: 1, sequence: 0, name: "First" }),
    ];
    const rollup = computeModuleRollup(modules, [], []);
    expect(rollup.map((r) => r.module.name)).toEqual(["First", "Second"]);
  });

  it("a station with no punch items at all is ready", () => {
    const modules = [makeModule({ id: 1 })];
    const stations = [makeStation({ id: 10, module_id: 1 })];
    const rollup = computeModuleRollup(modules, stations, []);
    expect(rollup[0].stations[0].ready).toBe(true);
    expect(rollup[0].ready).toBe(true);
  });
});
