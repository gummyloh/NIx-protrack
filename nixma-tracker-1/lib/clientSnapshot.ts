import { Task, TaskStatus, PunchSeverity } from "@/lib/types";
import { computeStatus, summarize, overallProgress } from "@/lib/schedule";
import { ModuleRollup } from "@/lib/moduleReadiness";

// A module's readiness state and open-item counts are always included --
// that's the whole point of showing the client the truth even when it's
// red. Only the text of a specific punch item is gated by that item's own
// show_to_client flag, since item text can carry internal detail
// (vendor/supplier issues, who missed what) that the rollup color itself
// doesn't need to expose.
export interface ClientModuleRollup {
  name: string;
  ready: boolean;
  openBlockerCount: number;
  stations: {
    name: string;
    ready: boolean;
    visibleItems: { description: string; severity: PunchSeverity }[];
  }[];
}

// The frozen payload a "Publish update to client" click stores in
// nixma.client_updates.snapshot. Built once, client-side, from whatever
// tasks are currently checked "Client" -- the customer page just renders
// this verbatim, it never recomputes schedule math itself.
export interface ClientSnapshot {
  overallStatus: string;
  overallPercent: number;
  totalDurationDays: number;
  completed: number;
  totalTasks: number;
  mostDelayed: { description: string; department: string } | null;
  departments: {
    department: string;
    avgPercent: number;
    tasks: { id: number; description: string; status: TaskStatus }[];
  }[];
  // Absent entirely for projects with no modules set up yet, rather than an
  // empty array -- lets the customer page skip the section instead of
  // rendering a header for nothing.
  moduleRollup?: ClientModuleRollup[];
}

/**
 * Converts the internal module rollup (which includes every punch item,
 * for the team's own view) into the client-safe version: rollup state and
 * counts always present, item text filtered to show_to_client.
 */
export function buildModuleRollupSnapshot(rollup: ModuleRollup[]): ClientModuleRollup[] {
  return rollup.map((m) => ({
    name: m.module.name,
    ready: m.ready,
    openBlockerCount: m.openBlockerCount,
    stations: m.stations.map((s) => ({
      name: s.station.name,
      ready: s.ready,
      visibleItems: s.items
        .filter((i) => i.show_to_client && i.status === "open")
        .map((i) => ({ description: i.description, severity: i.severity })),
    })),
  }));
}

/**
 * Builds a ClientSnapshot from whichever tasks should currently be visible
 * to the client (already filtered by the caller -- typically
 * show_to_client && is_active && !is_summary). Overall progress and "most
 * attention needed" are computed from this same filtered set, so the
 * numbers shown to the client always match the task list they can see.
 */
export function buildClientSnapshot(visibleTasks: Task[], today: Date): ClientSnapshot {
  const summary = summarize(visibleTasks, today);
  const progress = overallProgress(visibleTasks);

  const overallStatus =
    summary.overallDaysBehind <= 0
      ? "On schedule"
      : `${summary.overallDaysBehind} day${summary.overallDaysBehind === 1 ? "" : "s"} behind schedule`;

  const byDept = new Map<string, Task[]>();
  for (const t of visibleTasks) {
    if (t.is_summary) continue;
    if (!byDept.has(t.department)) byDept.set(t.department, []);
    byDept.get(t.department)!.push(t);
  }

  const departments = Array.from(byDept.entries()).map(([department, deptTasks]) => ({
    department,
    avgPercent: Math.round(
      deptTasks.reduce((s, t) => s + t.percent_complete, 0) / deptTasks.length
    ),
    tasks: deptTasks.map((t) => ({
      id: t.id,
      description: t.description,
      status: computeStatus(t, today),
    })),
  }));

  return {
    overallStatus,
    overallPercent: progress.weightedPercent,
    totalDurationDays: progress.totalDurationDays,
    completed: summary.completed,
    totalTasks: summary.totalTasks,
    mostDelayed: summary.mostDelayedTask
      ? { description: summary.mostDelayedTask.description, department: summary.mostDelayedTask.department }
      : null,
    departments,
  };
}
