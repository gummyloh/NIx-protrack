import { Task } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(s: string): Date {
  // Parse as UTC noon to sidestep timezone-boundary off-by-one issues
  return new Date(s + "T12:00:00Z");
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export interface ScheduleUpdate {
  id: number;
  scheduled_start: string;
  scheduled_finish: string;
}

/**
 * Downstream auto-shift: when a task's scheduled_finish changes (via drag or
 * the click-to-edit panel in the Gantt view), push every dependent task's
 * scheduled_start/scheduled_finish forward or backward by the same delta,
 * preserving each task's own duration. Recurses through the whole chain of
 * successors.
 *
 * Deliberately does NOT touch planned_start/planned_finish (the frozen
 * baseline) -- that's what "days behind schedule" is still measured
 * against. This only moves the "current plan" (scheduled_*).
 */
export function cascadeSchedule(
  allTasks: Task[],
  changedTaskId: number
): ScheduleUpdate[] {
  // Work on a local copy so recursive steps see prior updates in the same pass
  const byId = new Map<number, Task>(
    allTasks.map((t) => [t.id, { ...t }])
  );
  const childrenOf = new Map<number, Task[]>();
  for (const t of byId.values()) {
    if (t.predecessor_id != null) {
      if (!childrenOf.has(t.predecessor_id)) childrenOf.set(t.predecessor_id, []);
      childrenOf.get(t.predecessor_id)!.push(t);
    }
  }

  const updates = new Map<number, ScheduleUpdate>();
  const visiting = new Set<number>(); // cycle guard

  function propagate(taskId: number) {
    if (visiting.has(taskId)) return; // defensive: a bad predecessor_id loop shouldn't hang the app
    visiting.add(taskId);

    const task = byId.get(taskId);
    if (!task) return;

    const effectiveFinish = parseDate(task.scheduled_finish);
    const children = childrenOf.get(taskId) || [];

    for (const child of children) {
      const newStart = addDays(effectiveFinish, 1 + (child.lag_days || 0));
      const oldStart = parseDate(child.scheduled_start);

      if (newStart.getTime() === oldStart.getTime()) continue; // no shift needed

      const durationDays = daysBetween(
        parseDate(child.scheduled_start),
        parseDate(child.scheduled_finish)
      );
      const newFinish = addDays(newStart, durationDays);

      child.scheduled_start = toISO(newStart);
      child.scheduled_finish = toISO(newFinish);
      byId.set(child.id, child);

      updates.set(child.id, {
        id: child.id,
        scheduled_start: child.scheduled_start,
        scheduled_finish: child.scheduled_finish,
      });

      propagate(child.id);
    }
  }

  propagate(changedTaskId);
  return Array.from(updates.values());
}
