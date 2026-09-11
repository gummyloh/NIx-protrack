import { ProgressNode } from "@/lib/types";

/**
 * Builds a nested tree per discipline and computes each node's percentage
 * bottom-up. A leaf (no children) shows exactly what was entered for it --
 * null if it's never been fact-checked yet. A node with children always
 * shows the average of its children's *computed* percentages, never a
 * stored value of its own, so there's only ever one source of truth for
 * any non-leaf number.
 *
 * Averaging only counts children whose own computed percentage is known.
 * A child with zero confirmed leaves under it is excluded rather than
 * silently treated as 0% -- that would understate the parent's progress
 * just because one branch hasn't been checked yet, which is worse than
 * being honest that the parent's number is partial. confirmedLeafCount /
 * totalLeafCount travel up alongside the percentage so the UI can show
 * e.g. "80% (4 of 5 confirmed)" instead of a falsely precise number.
 */
export interface ProgressRollup {
  node: ProgressNode;
  children: ProgressRollup[];
  computedPercent: number | null;
  confirmedLeafCount: number;
  totalLeafCount: number;
}

export function buildProgressTree(nodes: ProgressNode[]): ProgressRollup[] {
  const byParent = new Map<number | null, ProgressNode[]>();
  for (const n of nodes) {
    const key = n.parent_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sequence - b.sequence || a.id - b.id);
  }

  function build(node: ProgressNode): ProgressRollup {
    const childNodes = byParent.get(node.id) ?? [];

    if (childNodes.length === 0) {
      return {
        node,
        children: [],
        computedPercent: node.percent_complete,
        confirmedLeafCount: node.percent_complete != null ? 1 : 0,
        totalLeafCount: 1,
      };
    }

    const children = childNodes.map(build);
    const confirmedLeafCount = children.reduce((sum, c) => sum + c.confirmedLeafCount, 0);
    const totalLeafCount = children.reduce((sum, c) => sum + c.totalLeafCount, 0);
    const knownChildren = children.filter((c) => c.computedPercent != null);
    const computedPercent =
      knownChildren.length > 0
        ? Math.round(
            knownChildren.reduce((sum, c) => sum + (c.computedPercent as number), 0) /
              knownChildren.length
          )
        : null;

    return { node, children, computedPercent, confirmedLeafCount, totalLeafCount };
  }

  return (byParent.get(null) ?? []).map(build);
}

export function disciplinesIn(nodes: ProgressNode[]): string[] {
  const seen = new Set<string>();
  for (const n of nodes) seen.add(n.discipline);
  return Array.from(seen).sort();
}
