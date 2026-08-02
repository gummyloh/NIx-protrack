"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Task, DEPARTMENTS } from "@/lib/types";
import { useProjectId, withProject } from "@/lib/useProjectId";
import {
  computeStatus,
  summarize,
  STATUS_LABEL,
  STATUS_COLOR,
} from "@/lib/schedule";

function StatusBadge({ status }: { status: ReturnType<typeof computeStatus> }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border"
      style={{
        color: STATUS_COLOR[status],
        borderColor: STATUS_COLOR[status] + "55",
        backgroundColor: STATUS_COLOR[status] + "12",
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: STATUS_COLOR[status] }}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function InternalView() {
  const projectId = useProjectId();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState<string>("All");
  const [showInactive, setShowInactive] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());

  async function loadTasks() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("tasks")
      .select("*")
      .eq("project_id", projectId)
      .order("id", { ascending: true });
    if (err) {
      setError(err.message);
    } else {
      setTasks((data as Task[]) || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadTasks();
  }, [projectId]);

  const today = useMemo(() => new Date(), []);
  const summary = useMemo(() => summarize(tasks, today), [tasks, today]);

  async function updateTask(id: number, patch: Partial<Task>) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setSavingIds((prev) => new Set(prev).add(id));
    const { error: err } = await supabase.from("tasks").update(patch).eq("id", id);
    setSavingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (err) setError(err.message);
  }

  const visibleTasks = tasks.filter(
    (t) =>
      !t.is_summary &&
      (deptFilter === "All" || t.department === deptFilter) &&
      (showInactive || t.is_active)
  );

  return (
    <main className="p-6 md:p-10 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <Link
            href={withProject("/internal", projectId)}
            className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 hover:text-[var(--accent)]"
          >
            &larr; Dashboard
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Task Table</h1>
          <p className="text-sm text-[var(--ink)]/60">
            Liquick GO Pack N Seal (MH063) &mdash; check which tasks apply to
            this project and jot quick notes. Dates and % complete are edited
            in the{" "}
            <Link href={withProject("/internal/gantt", projectId)} className="underline hover:text-[var(--accent)]">
              Gantt view
            </Link>
            . <Link href={withProject("/internal/board", projectId)} className="underline hover:text-[var(--accent)]">Board &rarr;</Link>
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      <SummaryCards summary={summary} />

      <div className="flex items-center gap-4 my-6 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
            Department
          </label>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="border border-[var(--line)] rounded px-2 py-1 text-sm bg-white"
          >
            <option>All</option>
            {DEPARTMENTS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[var(--ink)]/60">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show excluded tasks
        </label>
        {loading && <span className="text-xs text-[var(--ink)]/50">Loading…</span>}
      </div>

      <div className="overflow-x-auto border border-[var(--line)] rounded-lg bg-white/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
              <th className="p-3 w-16">In use</th>
              <th className="p-3 min-w-[240px]">Task</th>
              <th className="p-3">Dept</th>
              <th className="p-3 whitespace-nowrap">Planned</th>
              <th className="p-3 whitespace-nowrap">Scheduled</th>
              <th className="p-3">Status</th>
              <th className="p-3 min-w-[200px]">Note</th>
            </tr>
          </thead>
          <tbody>
            {visibleTasks.map((t) => {
              const status = computeStatus(t, today);
              const saving = savingIds.has(t.id);
              const dateDrifted =
                t.planned_start !== t.scheduled_start ||
                t.planned_finish !== t.scheduled_finish;
              return (
                <tr
                  key={t.id}
                  className={`border-b border-[var(--line)] last:border-0 align-top ${
                    !t.is_active ? "opacity-40" : ""
                  }`}
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={t.is_active}
                      onChange={(e) => updateTask(t.id, { is_active: e.target.checked })}
                      title="Include this task in the current project"
                    />
                  </td>
                  <td className="p-3">
                    <div className="font-medium">{t.description}</div>
                    <div className="text-xs text-[var(--ink)]/40 font-mono">
                      #{t.task_no} · Phase {t.phase} · {t.duration_days}d
                    </div>
                  </td>
                  <td className="p-3 whitespace-nowrap text-xs">{t.department}</td>
                  <td className="p-3 whitespace-nowrap text-xs font-mono-num">
                    {t.planned_start.slice(5)} &rarr; {t.planned_finish.slice(5)}
                  </td>
                  <td className="p-3 whitespace-nowrap text-xs font-mono-num">
                    <span className={dateDrifted ? "text-[var(--amber)] font-medium" : ""}>
                      {t.scheduled_start.slice(5)} &rarr; {t.scheduled_finish.slice(5)}
                    </span>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={status} />
                    {saving && (
                      <span className="block text-[10px] text-[var(--ink)]/40 mt-1">Saving…</span>
                    )}
                  </td>
                  <td className="p-3">
                    <input
                      defaultValue={t.status_note ?? ""}
                      onBlur={(e) =>
                        e.target.value !== (t.status_note ?? "") &&
                        updateTask(t.id, { status_note: e.target.value })
                      }
                      placeholder="Optional note"
                      className="border border-[var(--line)] rounded px-1.5 py-1 text-xs w-full bg-white"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function SummaryCards({ summary }: { summary: ReturnType<typeof summarize> }) {
  const items = [
    { label: "Active tasks", value: summary.totalTasks, color: "var(--ink)" },
    { label: "Completed", value: summary.completed, color: "#3a5a8c" },
    { label: "On track", value: summary.onTrack, color: "var(--accent)" },
    { label: "At risk", value: summary.atRisk, color: "var(--amber)" },
    { label: "Delayed", value: summary.delayed, color: "var(--rust)" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {items.map((it) => (
        <div key={it.label} className="border border-[var(--line)] rounded-lg p-3 bg-white/60">
          <div className="text-2xl font-semibold font-mono-num" style={{ color: it.color }}>
            {it.value}
          </div>
          <div className="text-xs text-[var(--ink)]/50 uppercase tracking-wide font-mono mt-0.5">
            {it.label}
          </div>
        </div>
      ))}
    </div>
  );
}
