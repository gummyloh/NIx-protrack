import { Task, TaskStatus } from "@/lib/types";
import { computeStatus, summarize, overallProgress } from "@/lib/schedule";

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
