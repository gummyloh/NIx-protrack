"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Task } from "@/lib/types";
import { useProjectId } from "@/lib/useProjectId";
import {
  computeStatus,
  daysBehind,
  summarize,
  overallProgress,
  STATUS_LABEL,
  STATUS_COLOR,
} from "@/lib/schedule";

interface ProjectRow {
  name: string;
  customer: string;
  project_code: string | null;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function Dashboard() {
  const projectId = useProjectId();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: taskData }, { data: projectData }] = await Promise.all([
        supabase
          .from("tasks")
          .select("*")
          .eq("project_id", projectId)
          .eq("is_active", true)
          .order("id", { ascending: true }),
        supabase
          .from("projects")
          .select("name, customer, project_code")
          .eq("id", projectId)
          .single(),
      ]);
      setTasks((taskData as Task[]) || []);
      setProject(projectData as ProjectRow);
      setLoading(false);
    })();
  }, [projectId]);

  const today = useMemo(() => new Date(), []);
  const leaf = useMemo(() => tasks.filter((t) => !t.is_summary), [tasks]);
  const summary = useMemo(() => summarize(tasks, today), [tasks, today]);
  const progress = useMemo(() => overallProgress(tasks), [tasks]);

  const departmentHealth = useMemo(() => {
    const map = new Map<
      string,
      { total: number; percentSum: number; atRisk: number; delayed: number; completed: number }
    >();
    for (const t of leaf) {
      if (!map.has(t.department)) {
        map.set(t.department, { total: 0, percentSum: 0, atRisk: 0, delayed: 0, completed: 0 });
      }
      const d = map.get(t.department)!;
      d.total += 1;
      d.percentSum += t.percent_complete;
      const status = computeStatus(t, today);
      if (status === "at_risk") d.atRisk += 1;
      if (status === "delayed") d.delayed += 1;
      if (status === "completed") d.completed += 1;
    }
    return Array.from(map.entries())
      .map(([department, d]) => ({
        department,
        avgPercent: Math.round(d.percentSum / d.total),
        ...d,
      }))
      .sort((a, b) => b.delayed - a.delayed || b.atRisk - a.atRisk);
  }, [leaf, today]);

  const needsAttention = useMemo(() => {
    return leaf
      .map((t) => ({ task: t, status: computeStatus(t, today), behind: daysBehind(t, today) }))
      .filter((x) => x.status === "at_risk" || x.status === "delayed")
      .sort((a, b) => b.behind - a.behind)
      .slice(0, 8);
  }, [leaf, today]);

  const recentActivity = useMemo(() => {
    return leaf
      .filter((t) => t.updated_at)
      .sort((a, b) => new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime())
      .slice(0, 10);
  }, [leaf]);

  const phaseProgress = useMemo(() => {
    const phases: Record<number, { total: number; percentSum: number; label: string }> = {
      1: { total: 0, percentSum: 0, label: "Kick-Off \u2192 Buy-Off" },
      2: { total: 0, percentSum: 0, label: "Buy-Off \u2192 Project Close" },
    };
    for (const t of leaf) {
      if (!phases[t.phase]) continue;
      phases[t.phase].total += 1;
      phases[t.phase].percentSum += t.percent_complete;
    }
    return Object.entries(phases).map(([phase, p]) => ({
      phase: Number(phase),
      label: p.label,
      avgPercent: p.total > 0 ? Math.round(p.percentSum / p.total) : 0,
    }));
  }, [leaf]);

  const overallStatus =
    summary.overallDaysBehind <= 0
      ? "On schedule"
      : `${summary.overallDaysBehind} day${summary.overallDaysBehind === 1 ? "" : "s"} behind schedule`;
  const overallColor =
    summary.overallDaysBehind <= 0
      ? "var(--accent)"
      : summary.overallDaysBehind <= 3
      ? "var(--amber)"
      : "var(--rust)";

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-[var(--ink)]/50">Loading dashboard…</p>
      </main>
    );
  }

  return (
    <main className="p-6 md:p-10 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase text-[var(--accent)] font-mono mb-2">
            Nixma Test Solutions
          </p>
          <h1 className="text-2xl font-semibold">
            {project?.name ?? "Project Dashboard"}
          </h1>
          <p className="text-sm text-[var(--ink)]/60 mt-1">
            {project?.customer}
            {project?.project_code ? ` · ${project.project_code}` : ""}
          </p>
        </div>
      </div>

      {/* Hero status band */}
      <div className="border border-[var(--line)] rounded-lg p-5 bg-white/60 mb-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
              Overall status
            </p>
            <p className="text-xl font-semibold mt-1" style={{ color: overallColor }}>
              {overallStatus}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
              Overall progress
            </p>
            <p className="text-3xl font-semibold mt-1 font-mono-num" style={{ color: "var(--accent)" }}>
              {progress.weightedPercent}%
            </p>
            <p className="text-xs text-[var(--ink)]/50 font-mono-num">
              {summary.completed} / {summary.totalTasks} tasks complete
            </p>
          </div>
        </div>
        <div className="h-2 bg-[var(--line)] rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-[var(--accent)]"
            style={{ width: `${progress.weightedPercent}%` }}
          />
        </div>
        <p className="text-xs text-[var(--ink)]/40 mb-4">
          Weighted by task duration ({progress.totalDurationDays} person-days total) so a 20-day task counts more than a 1-day one &mdash; this is the number to use for payment milestones.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "On track", value: summary.onTrack, color: "var(--accent)" },
            { label: "At risk", value: summary.atRisk, color: "var(--amber)" },
            { label: "Delayed", value: summary.delayed, color: "var(--rust)" },
            { label: "Not started", value: summary.notStarted, color: "#8a8578" },
          ].map((it) => (
            <div key={it.label} className="border border-[var(--line)] rounded-lg p-3">
              <div className="text-2xl font-semibold font-mono-num" style={{ color: it.color }}>
                {it.value}
              </div>
              <div className="text-xs text-[var(--ink)]/50 uppercase tracking-wide font-mono mt-0.5">
                {it.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Phase progress */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        {phaseProgress.map((p) => (
          <div key={p.phase} className="border border-[var(--line)] rounded-lg p-4 bg-white/60">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
                Phase {p.phase} &middot; {p.label}
              </span>
              <span className="text-xs font-mono-num text-[var(--ink)]/60">{p.avgPercent}%</span>
            </div>
            <div className="h-1.5 bg-[var(--line)] rounded-full overflow-hidden">
              <div className="h-full bg-[var(--accent)]" style={{ width: `${p.avgPercent}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Needs attention */}
        <div className="lg:col-span-2 border border-[var(--line)] rounded-lg p-5 bg-white/60">
          <h2 className="font-medium mb-4">Needs attention</h2>
          {needsAttention.length === 0 ? (
            <p className="text-sm text-[var(--ink)]/50">
              Nothing at risk or delayed right now.
            </p>
          ) : (
            <div className="space-y-3">
              {needsAttention.map(({ task, status, behind }) => (
                <div key={task.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{task.description}</p>
                    <p className="text-xs text-[var(--ink)]/50">{task.department}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border"
                      style={{
                        color: STATUS_COLOR[status],
                        borderColor: STATUS_COLOR[status] + "55",
                        backgroundColor: STATUS_COLOR[status] + "12",
                      }}
                    >
                      {STATUS_LABEL[status]}
                    </span>
                    <p className="text-xs text-[var(--ink)]/40 font-mono-num mt-1">
                      {Math.round(behind)}d behind
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Department health */}
        <div className="border border-[var(--line)] rounded-lg p-5 bg-white/60">
          <h2 className="font-medium mb-4">Department health</h2>
          <div className="space-y-3">
            {departmentHealth.map((d) => (
              <div key={d.department}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="truncate">{d.department}</span>
                  <span className="text-xs font-mono-num text-[var(--ink)]/50 shrink-0 ml-2">
                    {d.avgPercent}%
                  </span>
                </div>
                <div className="h-1 bg-[var(--line)] rounded-full overflow-hidden mb-1">
                  <div
                    className="h-full"
                    style={{
                      width: `${d.avgPercent}%`,
                      backgroundColor:
                        d.delayed > 0 ? "var(--rust)" : d.atRisk > 0 ? "var(--amber)" : "var(--accent)",
                    }}
                  />
                </div>
                {(d.delayed > 0 || d.atRisk > 0) && (
                  <p className="text-xs text-[var(--ink)]/50">
                    {d.delayed > 0 && `${d.delayed} delayed`}
                    {d.delayed > 0 && d.atRisk > 0 && " · "}
                    {d.atRisk > 0 && `${d.atRisk} at risk`}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="border border-[var(--line)] rounded-lg p-5 bg-white/60 mt-6">
        <h2 className="font-medium mb-4">Recent activity</h2>
        {recentActivity.length === 0 ? (
          <p className="text-sm text-[var(--ink)]/50">No updates logged yet.</p>
        ) : (
          <div className="space-y-2">
            {recentActivity.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">
                  <span className="text-[var(--ink)]/50">{t.updated_by || "Unknown"}</span> updated{" "}
                  <span className="font-medium">{t.description}</span>
                </span>
                <span className="text-xs text-[var(--ink)]/40 font-mono-num shrink-0">
                  {timeAgo(t.updated_at!)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
