"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Task, MeetingNote } from "@/lib/types";
import {
  computeStatus,
  summarize,
  STATUS_LABEL,
  STATUS_COLOR,
} from "@/lib/schedule";

function fmtNoteDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface ProjectRow {
  name: string;
  customer: string;
  project_code: string | null;
  kickoff_date: string | null;
  target_buyoff_date: string | null;
  target_end_date: string | null;
}

export default function CustomerView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const sessionRes = await fetch("/api/customer-session").then((r) => r.json());
      if (!sessionRes.ok) {
        router.replace("/customer/login");
        return;
      }
      const projectId = sessionRes.project_id as string;

      const [{ data: taskData }, { data: projectData }, notesRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("*")
          .eq("project_id", projectId)
          .eq("is_active", true)
          .order("id", { ascending: true }),
        supabase
          .from("projects")
          .select("name, customer, project_code, kickoff_date, target_buyoff_date, target_end_date")
          .eq("id", projectId)
          .single(),
        fetch("/api/customer-meeting-notes").then((r) => r.json()),
      ]);
      setTasks((taskData as Task[]) || []);
      setProject(projectData as ProjectRow);
      setNotes(notesRes.ok ? notesRes.notes : []);
      setLoading(false);
    })();
  }, [router]);

  const today = useMemo(() => new Date(), []);
  const summary = useMemo(() => summarize(tasks, today), [tasks, today]);

  const byDepartment = useMemo(() => {
    const leaf = tasks.filter((t) => !t.is_summary);
    const map = new Map<string, Task[]>();
    for (const t of leaf) {
      if (!map.has(t.department)) map.set(t.department, []);
      map.get(t.department)!.push(t);
    }
    return Array.from(map.entries());
  }, [tasks]);

  async function logout() {
    await fetch("/api/customer-logout", { method: "POST" });
    router.push("/customer/login");
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-[var(--ink)]/50">Loading project status…</p>
      </main>
    );
  }

  const overallStatus =
    summary.overallDaysBehind <= 0
      ? "On schedule"
      : `${summary.overallDaysBehind} day${summary.overallDaysBehind === 1 ? "" : "s"} behind schedule`;

  return (
    <main className="p-6 md:p-10 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase text-[var(--accent)] font-mono mb-2">
            Nixma Test Solutions
          </p>
          <h1 className="text-2xl font-semibold">
            {project?.name ?? "Project status"}
          </h1>
          <p className="text-sm text-[var(--ink)]/60 mt-1">
            {project?.customer}
            {project?.project_code ? ` · ${project.project_code}` : ""}
          </p>
        </div>
        <button
          onClick={logout}
          className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/40 hover:text-[var(--rust)]"
        >
          Sign out
        </button>
      </div>

      <div className="border border-[var(--line)] rounded-lg p-5 bg-white/60 mb-8">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <p className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
              Overall status
            </p>
            <p
              className="text-xl font-semibold mt-1"
              style={{
                color:
                  summary.overallDaysBehind <= 0
                    ? "var(--accent)"
                    : summary.overallDaysBehind <= 3
                    ? "var(--amber)"
                    : "var(--rust)",
              }}
            >
              {overallStatus}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
              Progress
            </p>
            <p className="text-xl font-semibold mt-1 font-mono-num">
              {summary.completed} / {summary.totalTasks} tasks complete
            </p>
          </div>
        </div>
        {summary.mostDelayedTask && (
          <p className="text-sm text-[var(--ink)]/60 mt-3 pt-3 border-t border-[var(--line)]">
            Most attention needed:{" "}
            <span className="font-medium text-[var(--ink)]">
              {summary.mostDelayedTask.description}
            </span>{" "}
            ({summary.mostDelayedTask.department})
          </p>
        )}
      </div>

      <div className="space-y-6">
        {byDepartment.map(([dept, deptTasks]) => {
          const total = deptTasks.length;
          const avgPercent = Math.round(
            deptTasks.reduce((s, t) => s + t.percent_complete, 0) / total
          );
          return (
            <div
              key={dept}
              className="border border-[var(--line)] rounded-lg p-5 bg-white/60"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-medium">{dept}</h2>
                <span className="text-xs font-mono-num text-[var(--ink)]/50">
                  {avgPercent}% avg
                </span>
              </div>
              <div className="h-1.5 bg-[var(--line)] rounded-full overflow-hidden mb-4">
                <div
                  className="h-full bg-[var(--accent)]"
                  style={{ width: `${avgPercent}%` }}
                />
              </div>
              <div className="space-y-2">
                {deptTasks.map((t) => {
                  const status = computeStatus(t, today);
                  return (
                    <div
                      key={t.id}
                      className="flex items-center justify-between text-sm gap-3"
                    >
                      <span className="text-[var(--ink)]/80 truncate">
                        {t.description}
                      </span>
                      <span
                        className="text-xs font-medium whitespace-nowrap px-2 py-0.5 rounded-full border shrink-0"
                        style={{
                          color: STATUS_COLOR[status],
                          borderColor: STATUS_COLOR[status] + "55",
                          backgroundColor: STATUS_COLOR[status] + "12",
                        }}
                      >
                        {STATUS_LABEL[status]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {notes.length > 0 && (
        <div className="mt-6 space-y-4">
          <h2 className="text-sm font-mono uppercase tracking-wide text-[var(--ink)]/50">
            Updates
          </h2>
          {notes.map((n) => (
            <div key={n.id} className="border border-[var(--line)] rounded-lg p-5 bg-white/60">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="font-medium">{n.title}</h3>
                <span className="text-xs text-[var(--ink)]/50 font-mono-num">
                  {fmtNoteDate(n.meeting_date)}
                </span>
              </div>
              <p className="text-sm text-[var(--ink)]/80 whitespace-pre-wrap">
                {n.formatted_content}
              </p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
