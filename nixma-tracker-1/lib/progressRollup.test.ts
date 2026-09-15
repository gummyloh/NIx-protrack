import { describe, it, expect } from "vitest";
import { ProgressNode } from "./types";
import { buildProgressTree, disciplinesIn } from "./progressRollup";

function makeNode(overrides: Partial<ProgressNode> & { id: number }): ProgressNode {
  return {
    project_id: "test-project",
    discipline: "Mechanical",
    parent_id: null,
    name: "Node",
    sequence: 0,
    percent_complete: null,
    confirmed_by: null,
    updated_by: null,
    updated_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildProgressTree", () => {
  it("a leaf's computed percent is exactly what was entered", () => {
    const nodes = [makeNode({ id: 1, name: "Leaf", percent_complete: 80 })];
    const tree = buildProgressTree(nodes);
    expect(tree[0].computedPercent).toBe(80);
    expect(tree[0].confirmedLeafCount).toBe(1);
    expect(tree[0].totalLeafCount).toBe(1);
  });

  it("a never-fact-checked leaf has a null computed percent, not zero", () => {
    const nodes = [makeNode({ id: 1, name: "Leaf", percent_complete: null })];
    const tree = buildProgressTree(nodes);
    expect(tree[0].computedPercent).toBeNull();
    expect(tree[0].confirmedLeafCount).toBe(0);
    expect(tree[0].totalLeafCount).toBe(1);
  });

  it("a parent's percent is the average of its children's computed percents", () => {
    const nodes = [
      makeNode({ id: 1, name: "Module", parent_id: null }),
      makeNode({ id: 2, name: "Sub A", parent_id: 1, percent_complete: 50 }),
      makeNode({ id: 3, name: "Sub B", parent_id: 1, percent_complete: 100 }),
    ];
    const tree = buildProgressTree(nodes);
    expect(tree[0].computedPercent).toBe(75);
    expect(tree[0].confirmedLeafCount).toBe(2);
    expect(tree[0].totalLeafCount).toBe(2);
  });

  it("excludes an unconfirmed child from the average instead of counting it as 0%", () => {
    // This is the specific behavior the rollup was designed around: a
    // branch nobody's checked yet shouldn't silently drag the parent's
    // number down as if it were known to be 0% done.
    const nodes = [
      makeNode({ id: 1, name: "Module" }),
      makeNode({ id: 2, name: "Confirmed", parent_id: 1, percent_complete: 80 }),
      makeNode({ id: 3, name: "Never checked", parent_id: 1, percent_complete: null }),
    ];
    const tree = buildProgressTree(nodes);
    // Average of just the one known child (80), not (80+0)/2 = 40.
    expect(tree[0].computedPercent).toBe(80);
    expect(tree[0].confirmedLeafCount).toBe(1);
    expect(tree[0].totalLeafCount).toBe(2);
  });

  it("a parent with zero confirmed children anywhere below it has a null computed percent", () => {
    const nodes = [
      makeNode({ id: 1, name: "Module" }),
      makeNode({ id: 2, name: "Unchecked A", parent_id: 1, percent_complete: null }),
      makeNode({ id: 3, name: "Unchecked B", parent_id: 1, percent_complete: null }),
    ];
    const tree = buildProgressTree(nodes);
    expect(tree[0].computedPercent).toBeNull();
    expect(tree[0].confirmedLeafCount).toBe(0);
    expect(tree[0].totalLeafCount).toBe(2);
  });

  it("rolls up correctly across three levels, mixing a nested branch with a direct leaf", () => {
    const nodes = [
      makeNode({ id: 1, name: "Root" }),
      makeNode({ id: 2, name: "Branch", parent_id: 1 }),
      makeNode({ id: 3, name: "Deep leaf", parent_id: 2, percent_complete: 40 }),
      makeNode({ id: 4, name: "Direct leaf", parent_id: 1, percent_complete: 60 }),
    ];
    const tree = buildProgressTree(nodes);
    const root = tree[0];
    const branch = root.children.find((c) => c.node.name === "Branch")!;

    expect(branch.computedPercent).toBe(40);
    expect(branch.confirmedLeafCount).toBe(1);
    // Root averages Branch's computed 40 with Direct leaf's 60 -> 50.
    expect(root.computedPercent).toBe(50);
    expect(root.confirmedLeafCount).toBe(2);
    expect(root.totalLeafCount).toBe(2);
  });

  it("only groups top-level nodes as roots -- children never appear twice", () => {
    const nodes = [
      makeNode({ id: 1, name: "Root A" }),
      makeNode({ id: 2, name: "Child of A", parent_id: 1, percent_complete: 10 }),
      makeNode({ id: 3, name: "Root B" }),
    ];
    const tree = buildProgressTree(nodes);
    expect(tree).toHaveLength(2);
    expect(tree.map((r) => r.node.name)).toEqual(["Root A", "Root B"]);
  });
});

describe("disciplinesIn", () => {
  it("returns each discipline once, alphabetically", () => {
    const nodes = [
      makeNode({ id: 1, discipline: "Software" }),
      makeNode({ id: 2, discipline: "Mechanical" }),
      makeNode({ id: 3, discipline: "Mechanical" }),
      makeNode({ id: 4, discipline: "Wiring" }),
    ];
    expect(disciplinesIn(nodes)).toEqual(["Mechanical", "Software", "Wiring"]);
  });

  it("returns an empty list for no nodes", () => {
    expect(disciplinesIn([])).toEqual([]);
  });
});
