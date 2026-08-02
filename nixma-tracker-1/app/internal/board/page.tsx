"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Task } from "@/lib/types";
import { useProjectId, withProject } from "@/lib/useProjectId";
import { computeStatus, STATUS_LABEL, STATUS_COLOR } from "@/lib/schedule";
import { cascadeSchedule } from "@/lib/cascade";

type Priority = "High" | "Medium" | "Low";

const PRIORITY_COLOR: Record<Priority, string> = {
  High: "#a13d2f",
  Medium: "#b7791f",
  Low: "#3a5a8c",
};

function priorityFor(status: ReturnType<typeof computeStatus>): Priority {
  if (status === "delayed") return "High";
  if (status === "at_risk") return "Medium";
  return "Low";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic color from a string, so the same person/department always
// gets the same avatar color across the board.
const AVATAR_PALETTE = ["#2f6f4f", "#3a5a8c", "#b7791f", "#7a4f9e", "#2f7f8a", "#a13d2f"];
function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Board() {
  const projectId = useProjectId();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<string | null>(null);

  async function loadTasks() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("tasks")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_summary", false)
      .eq("is_active", true)
      .order("id", { ascending: true });
    if (err) setError(err.message);
    else setTasks((data as Task[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    loadTasks();
  }, [projectId]);

  const today = useMemo(() => new Date(), []);

  async function updateTask(id: number, patch: Partial<Task>) {
    const cascaded =
      patch.scheduled_finish !== undefined
        ? cascadeSchedule(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)), id)
        : [];

    setTasks((prev) => {
      const cascadedById = new Map(cascaded.map((u) => [u.id, u]));
      return prev.map((t) => {
        if (t.id === id) return { ...t, ...patch };
        const c = cascadedById.get(t.id);
        return c ? { ...t, ...c } : t;
      });
    });

    const { error: err } = await supabase.from("tasks").update(patch).eq("id", id);
    for (const u of cascaded) {
      await supabase
        .from("tasks")
        .update({ scheduled_start: u.scheduled_start, scheduled_finish: u.scheduled_finish })
        .eq("id", u.id);
    }
    if (err) setError(err.message);
    setEditingCell(null);
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!map.has(t.department)) map.set(t.department, []);
      map.get(t.department)!.push(t);
    }
    // worst-health departments first, same ordering logic as the dashboard
    return Array.from(map.entries()).sort((a, b) => {
      const aBad = a[1].filter((t) => {
        const s = computeStatus(t, today);
        return s === "delayed" || s === "at_risk";
      }).length;
      const bBad = b[1].filter((t) => {
        const s = computeStatus(t, today);
        return s === "delayed" || s === "at_risk";
      }).length;
      return bBad - aBad;
    });
  }, [tasks, today]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-[var(--ink)]/50">Loading board…</p>
      </main>
    );
  }

  return (
    <main className="p-6 md:p-10 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <Link
            href={withProject("/internal", projectId)}
            className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 hover:text-[var(--accent)]"
          >
            &larr; Dashboard
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Board</h1>
          <p className="text-sm text-[var(--ink)]/60">
            Grouped by department, worst health first.{" "}
            <Link href={withProject("/internal/tasks", projectId)} className="underline hover:text-[var(--accent)]">
              Table
            </Link>{" "}
            &middot;{" "}
            <Link href={withProject("/internal/gantt", projectId)} className="underline hover:text-[var(--accent)]">
              Gantt
            </Link>
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {grouped.map(([department, deptTasks]) => {
          const isCollapsed = collapsed.has(department);
          const counts = { on_track: 0, at_risk: 0, delayed: 0, completed: 0, not_started: 0 };
          for (const t of deptTasks) counts[computeStatus(t, today)]++;
          const total = deptTasks.length;
          const barColor =
            counts.delayed > 0 ? "var(--rust)" : counts.at_risk > 0 ? "var(--amber)" : "var(--accent)";

          return (
            <div key={department} className="rounded-lg overflow-hidden border border-[var(--line)]">
              <button
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    next.has(department) ? next.delete(department) : next.add(department);
                    return next;
                  })
                }
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-white/70 text-left"
                style={{ borderLeft: `4px solid ${barColor}` }}
              >
                <span className="text-xs">{isCollapsed ? "▶" : "▼"}</span>
                <span className="font-semibold" style={{ color: barColor }}>
                  {department}
                </span>
                <span className="text-xs text-[var(--ink)]/40 font-mono-num">({total})</span>
              </button>

              {!isCollapsed && (
                <>
                  <div className="overflow-x-auto bg-white/40">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs font-mono uppercase tracking-wide text-[var(--ink)]/40 border-b border-[var(--line)]">
                          <th className="p-2.5 min-w-[220px]">Task</th>
                          <th className="p-2.5 w-36">Owner</th>
                          <th className="p-2.5 w-32">Status</th>
                          <th className="p-2.5 w-28">Due date</th>
                          <th className="p-2.5 w-24">Priority</th>
                          <th className="p-2.5 w-44">Timeline</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deptTasks.map((t) => {
                          const status = computeStatus(t, today);
                          const priority = priorityFor(status);
                          const ownerName = t.assignee || t.department;
                          const overdue =
                            status !== "completed" &&
                            new Date(t.scheduled_finish + "T12:00:00Z").getTime() < today.getTime();
                          const ownerKey = `${t.id}-owner`;
                          const dateKey = `${t.id}-date`;

                          return (
                            <tr key={t.id} className="border-b border-[var(--line)] last:border-0">
                              <td className="p-2.5">
                                <p className="font-medium">{t.description}</p>
                                <p className="text-xs text-[var(--ink)]/40 font-mono">
                                  #{t.task_no} &middot; {t.percent_complete}%
                                </p>
                              </td>

                              <td className="p-2.5">
                                {editingCell === ownerKey ? (
                                  <input
                                    autoFocus
                                    defaultValue={t.assignee ?? ""}
                                    onBlur={(e) => updateTask(t.id, { assignee: e.target.value || null })}
                                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                                    className="border border-[var(--line)] rounded px-1.5 py-0.5 text-xs w-28 bg-white"
                                  />
                                ) : (
                                  <button
                                    onClick={() => setEditingCell(ownerKey)}
                                    className="flex items-center gap-1.5 hover:opacity-80"
                                  >
                                    <span
                                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                                      style={{ backgroundColor: colorFor(ownerName) }}
                                    >
                                      {initials(ownerName)}
                                    </span>
                                    <span className="text-xs truncate max-w-[80px]">
                                      {t.assignee || <span className="text-[var(--ink)]/30 italic">unassigned</span>}
                                    </span>
                                  </button>
                                )}
                              </td>

                              <td className="p-2.5">
                                <span
                                  className="inline-block text-xs font-medium px-2.5 py-1 rounded text-white whitespace-nowrap"
                                  style={{ backgroundColor: STATUS_COLOR[status] }}
                                >
                                  {STATUS_LABEL[status]}
                                </span>
                              </td>

                              <td className="p-2.5">
                                {editingCell === dateKey ? (
                                  <input
                                    autoFocus
                                    type="date"
                                    defaultValue={t.scheduled_finish}
                                    onBlur={(e) => {
                                      if (!e.target.value) {
                                        setEditingCell(null);
                                        return;
                                      }
                                      updateTask(t.id, {
                                        scheduled_finish: e.target.value,
                                        percent_complete: 100,
                                      });
                                    }}
                                    className="border border-[var(--line)] rounded px-1.5 py-0.5 text-xs w-32 bg-white"
                                  />
                                ) : (
                                  <button
                                    onClick={() => setEditingCell(dateKey)}
                                    className="flex items-center gap-1 text-xs hover:opacity-80"
                                  >
                                    {overdue && <span title="Overdue">⚠️</span>}
                                    <span className="font-mono-num">{fmtDate(t.scheduled_finish)}</span>
                                  </button>
                                )}
                              </td>

                              <td className="p-2.5">
                                <span
                                  className="inline-block text-xs font-medium px-2.5 py-1 rounded text-white whitespace-nowrap"
                                  style={{ backgroundColor: PRIORITY_COLOR[priority] }}
                                >
                                  {priority}
                                </span>
                              </td>

                              <td className="p-2.5">
                                <div className="relative h-6 bg-[var(--line)] rounded-full overflow-hidden w-full min-w-[140px]">
                                  <div
                                    className="absolute inset-y-0 left-0 rounded-full opacity-90"
                                    style={{
                                      width: `${t.percent_complete}%`,
                                      backgroundColor: STATUS_COLOR[status],
                                    }}
                                  />
                                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono-num text-[var(--ink)]/70">
                                    {fmtDate(t.scheduled_start)} &rarr; {fmtDate(t.scheduled_finish)}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* segmented health bar, footer of group */}
                  <div className="h-2 flex">
                    {(["completed", "on_track", "at_risk", "delayed", "not_started"] as const).map(
                      (s) =>
                        counts[s] > 0 && (
                          <div
                            key={s}
                            style={{
                              width: `${(counts[s] / total) * 100}%`,
                              backgroundColor: STATUS_COLOR[s],
                            }}
                          />
                        )
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
