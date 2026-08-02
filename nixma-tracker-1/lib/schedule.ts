import { Task, TaskStatus } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/**
 * Where a task "should" be today, expressed as an expected percent complete,
 * based on straight-line time elapsed between planned_start and planned_finish.
 */
export function expectedPercent(task: Task, today: Date): number {
  const start = new Date(task.planned_start);
  const finish = new Date(task.planned_finish);
  const totalDays = Math.max(1, daysBetween(start, finish) + 1);
  const elapsedDays = daysBetween(start, today) + 1;
  if (elapsedDays <= 0) return 0;
  if (elapsedDays >= totalDays) return 100;
  return Math.round((elapsedDays / totalDays) * 100);
}

/**
 * Days a task is behind schedule right now. Positive = behind, negative = ahead.
 * For completed tasks, compares scheduled_finish (the date it was actually
 * edited to, via Gantt) to the frozen baseline planned_finish.
 * For in-progress/not-started tasks, infers an "effective date" from percent
 * complete against the planned pace, then compares to today.
 */
export function daysBehind(task: Task, today: Date): number {
  const plannedFinish = new Date(task.planned_finish);

  if (task.percent_complete >= 100) {
    return daysBetween(plannedFinish, new Date(task.scheduled_finish));
  }

  const plannedStart = new Date(task.planned_start);
  const totalDays = Math.max(1, daysBetween(plannedStart, plannedFinish) + 1);
  const expectedDaysElapsed = (task.percent_complete / 100) * totalDays;
  const effectiveDate = new Date(
    plannedStart.getTime() + expectedDaysElapsed * DAY_MS
  );
  const actualDaysElapsed = daysBetween(plannedStart, today) + 1;

  return actualDaysElapsed - expectedDaysElapsed;
}

export function computeStatus(task: Task, today: Date): TaskStatus {
  if (task.percent_complete >= 100) return "completed";

  const start = new Date(task.planned_start);
  const started = today.getTime() >= start.getTime();

  if (!started && task.percent_complete === 0) return "not_started";

  const behind = daysBehind(task, today);

  if (behind <= 0) return "on_track";
  if (behind <= 2) return "at_risk";
  return "delayed";
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: "Not started",
  on_track: "On track",
  at_risk: "At risk",
  delayed: "Delayed",
  completed: "Completed",
};

export const STATUS_COLOR: Record<TaskStatus, string> = {
  not_started: "#8a8578",
  on_track: "#2f6f4f",
  at_risk: "#b7791f",
  delayed: "#a13d2f",
  completed: "#3a5a8c",
};

export interface ProjectSummary {
  totalTasks: number;
  completed: number;
  onTrack: number;
  atRisk: number;
  delayed: number;
  notStarted: number;
  mostDelayedTask: Task | null;
  mostDelayedDays: number;
  overallDaysBehind: number;
}

export function summarize(tasks: Task[], today: Date): ProjectSummary {
  const leafTasks = tasks.filter((t) => !t.is_summary && t.is_active);
  let completed = 0,
    onTrack = 0,
    atRisk = 0,
    delayed = 0,
    notStarted = 0;
  let mostDelayedTask: Task | null = null;
  let mostDelayedDays = -Infinity;

  for (const t of leafTasks) {
    const status = computeStatus(t, today);
    if (status === "completed") completed++;
    else if (status === "on_track") onTrack++;
    else if (status === "at_risk") atRisk++;
    else if (status === "delayed") delayed++;
    else if (status === "not_started") notStarted++;

    if (status !== "completed" && status !== "not_started") {
      const behind = daysBehind(t, today);
      if (behind > mostDelayedDays) {
        mostDelayedDays = behind;
        mostDelayedTask = t;
      }
    }
  }

  // Overall project variance: use the critical, latest-finishing incomplete
  // task's slip as a simple proxy for how far the whole project has drifted.
  const inFlight = leafTasks.filter((t) => t.percent_complete < 100);
  let overallDaysBehind = 0;
  if (inFlight.length > 0) {
    overallDaysBehind = Math.round(
      inFlight.reduce((sum, t) => sum + Math.max(0, daysBehind(t, today)), 0) /
        inFlight.length
    );
  }

  return {
    totalTasks: leafTasks.length,
    completed,
    onTrack,
    atRisk,
    delayed,
    notStarted,
    mostDelayedTask,
    mostDelayedDays: mostDelayedTask ? mostDelayedDays : 0,
    overallDaysBehind,
  };
}
