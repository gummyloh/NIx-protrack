import { describe, it, expect } from "vitest";
import { Task } from "./types";
import {
  daysBetween,
  computeStatus,
  daysBehind,
  overallProgress,
  summarize,
} from "./schedule";

// Full Task fixture with sensible defaults -- only override what a given
// test actually cares about, so each test stays readable.
function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 1,
    project_id: "test-project",
    phase: 1,
    task_no: 1,
    description: "Test task",
    duration_days: 10,
    planned_start: "2026-01-01",
    planned_finish: "2026-01-10",
    indent_level: 1,
    parent_id: null,
    department: "Mechanical",
    is_summary: false,
    is_active: true,
    assignee: null,
    predecessor_id: null,
    lag_days: 0,
    scheduled_start: "2026-01-01",
    scheduled_finish: "2026-01-10",
    actual_start: null,
    actual_finish: null,
    percent_complete: 0,
    status_note: null,
    updated_by: null,
    updated_at: null,
    show_to_client: true,
    modules: null,
    stations: null,
    ...overrides,
  };
}

describe("daysBetween", () => {
  it("counts whole days between two dates", () => {
    expect(daysBetween(new Date("2026-01-01"), new Date("2026-01-11"))).toBe(10);
  });

  it("is negative when the second date is earlier", () => {
    expect(daysBetween(new Date("2026-01-11"), new Date("2026-01-01"))).toBe(-10);
  });
});

describe("computeStatus", () => {
  // start=Jan1, finish=Jan10 -> totalDays=10. today=Jan6 -> actualDaysElapsed=6.
  const today = new Date("2026-01-06");

  it("is completed at 100%, regardless of dates", () => {
    const t = makeTask({ percent_complete: 100, planned_start: "2099-01-01" });
    expect(computeStatus(t, today)).toBe("completed");
  });

  it("is not_started when today is before planned_start and nothing's logged", () => {
    const t = makeTask({ planned_start: "2026-02-01", planned_finish: "2026-02-10", percent_complete: 0 });
    expect(computeStatus(t, today)).toBe("not_started");
  });

  it("is on_track exactly on pace (60% through a 10-day task on day 6)", () => {
    const t = makeTask({ percent_complete: 60 });
    expect(daysBehind(t, today)).toBe(0);
    expect(computeStatus(t, today)).toBe("on_track");
  });

  it("is at_risk 1-2 days behind pace", () => {
    const t = makeTask({ percent_complete: 50 });
    expect(daysBehind(t, today)).toBe(1);
    expect(computeStatus(t, today)).toBe("at_risk");
  });

  it("is delayed more than 2 days behind pace", () => {
    const t = makeTask({ percent_complete: 20 });
    expect(daysBehind(t, today)).toBe(4);
    expect(computeStatus(t, today)).toBe("delayed");
  });

  it("is delayed, not not_started, when a task has started but nothing's logged yet", () => {
    // planned_start is in the past relative to `today`, so `started` is
    // true even though percent_complete is still 0 -- this is the one
    // case the H090/Liquick audits kept catching in real data (a task
    // that's actually overdue, not merely unstarted).
    const t = makeTask({ percent_complete: 0 });
    expect(computeStatus(t, today)).toBe("delayed");
  });

  it("for a completed task, compares scheduled_finish to the frozen planned_finish, not today", () => {
    const t = makeTask({
      percent_complete: 100,
      planned_finish: "2026-01-10",
      scheduled_finish: "2026-01-12",
    });
    expect(daysBehind(t, today)).toBe(2);
  });
});

describe("overallProgress", () => {
  it("weights by duration, not a plain average across tasks", () => {
    const tasks = [
      makeTask({ id: 1, duration_days: 20, percent_complete: 0 }),
      makeTask({ id: 2, duration_days: 5, percent_complete: 100 }),
    ];
    const result = overallProgress(tasks);
    // weighted: (20*0 + 5*100) / 25 = 20
    expect(result.weightedPercent).toBe(20);
    // simple: (0 + 100) / 2 = 50 -- deliberately different from weighted,
    // demonstrating exactly the skew the weighted number exists to avoid.
    expect(result.simplePercent).toBe(50);
    expect(result.totalDurationDays).toBe(25);
  });

  it("excludes summary rows and inactive tasks from the calculation", () => {
    const tasks = [
      makeTask({ id: 1, duration_days: 10, percent_complete: 50 }),
      makeTask({ id: 2, duration_days: 1000, percent_complete: 0, is_summary: true }),
      makeTask({ id: 3, duration_days: 1000, percent_complete: 0, is_active: false }),
    ];
    const result = overallProgress(tasks);
    expect(result.weightedPercent).toBe(50);
    expect(result.totalDurationDays).toBe(10);
  });
});

describe("summarize", () => {
  const today = new Date("2026-01-06");

  it("buckets tasks by status and finds the single most-delayed task", () => {
    const onTrack = makeTask({ id: 1, percent_complete: 60, description: "On track task" });
    const atRisk = makeTask({ id: 2, percent_complete: 50, description: "At risk task" });
    const delayed = makeTask({ id: 3, percent_complete: 20, description: "Delayed task" });
    const completed = makeTask({ id: 4, percent_complete: 100, description: "Done task" });
    const notStarted = makeTask({
      id: 5,
      percent_complete: 0,
      planned_start: "2026-02-01",
      planned_finish: "2026-02-10",
      description: "Future task",
    });

    const result = summarize([onTrack, atRisk, delayed, completed, notStarted], today);

    expect(result.totalTasks).toBe(5);
    expect(result.onTrack).toBe(1);
    expect(result.atRisk).toBe(1);
    expect(result.delayed).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.notStarted).toBe(1);
    expect(result.mostDelayedTask?.description).toBe("Delayed task");
    expect(result.mostDelayedDays).toBe(4);
  });

  it("computes overallDaysBehind only from in-flight tasks, treating ahead-of-pace as zero", () => {
    const onTrack = makeTask({ id: 1, percent_complete: 60 }); // behind 0
    const atRisk = makeTask({ id: 2, percent_complete: 50 }); // behind 1
    const delayed = makeTask({ id: 3, percent_complete: 20 }); // behind 4
    const notStarted = makeTask({
      id: 4,
      percent_complete: 0,
      planned_start: "2026-02-01",
      planned_finish: "2026-02-10",
    }); // hasn't started -- behind is negative, floors to 0, still counted as in-flight
    const completed = makeTask({ id: 5, percent_complete: 100 }); // excluded, not in-flight

    const result = summarize([onTrack, atRisk, delayed, notStarted, completed], today);

    // (0 + 1 + 4 + 0) / 4 in-flight tasks = 1.25 -> rounds to 1
    expect(result.overallDaysBehind).toBe(1);
  });

  it("only considers active, non-summary tasks", () => {
    const real = makeTask({ id: 1, percent_complete: 50 });
    const summary = makeTask({ id: 2, is_summary: true, percent_complete: 0 });
    const inactive = makeTask({ id: 3, is_active: false, percent_complete: 0 });
    const result = summarize([real, summary, inactive], today);
    expect(result.totalTasks).toBe(1);
  });
});
