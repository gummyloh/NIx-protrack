"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { withProject } from "@/lib/useProjectId";
import { useInternalAuth } from "@/lib/internalAuth";
import { ProjectRow, Task } from "@/lib/types";
import { summarize, overallProgress, STATUS_COLOR, ProjectSummary } from "@/lib/schedule";

/**
 * Cross-project overview -- deliberately built in the app's own visual
 * language (flat hairline-bordered cards, mono for numbers, color used only
 * for real status) rather than importing a generic rounded-card-with-shadow
 * SaaS look. Reuses lib/schedule.ts's exact same status math the per-project
 * Dashboard already uses, so a project flagged "at risk" here means the same
 * thing it means there -- no separate scoring system to keep in sync.
 *
 * Two things deliberately left out rather than faked:
 * - Trend deltas ("+2 since last week") on the stat cards. There's no
 *   historical snapshot data to compare against yet -- inventing a number
 *   would be worse than not showing one. Comes for free later if daily/
 *   weekly snapshots ever get built.
 * - A real "team workload" table (active task count, next due, per person).
 *   tasks.assignee is free text and unset on all but 3 of 236 active tasks
 *   (checked directly before building this) -- there's no reliable
 *   per-person task assignment to compute that from. What's shown instead
 *   is honest: who's on which projects, from real project_members data.
 */

interface ProjectHealth {
  project: ProjectRow;
  summary: ProjectSummary;
  weightedPercent: number;
}

interface MemberRow {
  id: string;
  full_name: string | null;
  email: string;
  is_admin: boolean;
  projectNames: string[];
}

function severityFor(overallDaysBehind: number): "critical" | "at_risk" | "on_track" {
  if (overallDaysBehind >= 14) return "critical";
  if (overallDaysBehind >= 1) return "at_risk";
  return "on_track";
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  at_risk: "At risk",
  on_track: "On track",
};
const SEVERITY_COLOR: Record<string, string> = {
  critical: STATUS_COLOR.delayed,
  at_risk: STATUS_COLOR.at_risk,
  on_track: STATUS_COLOR.on_track,
};

export default function PortfolioPage() {
  const { isAdmin } = useInternalAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectHealth[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      setError(null);
      const today = new Date();

      const { data: projectData, error: projErr } = await supabase.rpc("list_projects");
      if (projErr) {
        setError(projErr.message);
        setLoading(false);
        return;
      }
      const projectRows = (projectData as ProjectRow[]) || [];

      const healths = await Promise.all(
        projectRows.map(async (p) => {
          const { data: taskData } = await supabase
            .from("tasks")
            .select("*")
            .eq("project_id", p.id)
            .eq("is_active", true);
          const tasks = (taskData as Task[]) || [];
          return {
            project: p,
            summary: summarize(tasks, today),
            weightedPercent: overallProgress(tasks).weightedPercent,
          };
        })
      );
      setProjects(healths);

      const [{ data: profileData }, { data: memberLinkData }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, is_admin, approved"),
        supabase.from("project_members").select("user_id, project_id"),
      ]);
      const profileRows = ((profileData as {
        id: string;
        full_name: string | null;
        email: string;
        is_admin: boolean;
        approved: boolean;
      }[]) || []).filter((p) => p.approved);
      const links = (memberLinkData as { user_id: string; project_id: string }[]) || [];
      const nameByProjectId = new Map(projectRows.map((p) => [p.id, p.name]));

      setMembers(
        profileRows.map((p) => ({
          id: p.id,
          full_name: p.full_name,
          email: p.email,
          is_admin: p.is_admin,
          projectNames: links
            .filter((l) => l.user_id === p.id)
            .map((l) => nameByProjectId.get(l.project_id))
            .filter((n): n is string => !!n),
        }))
      );

      setLoading(false);
    })();
  }, [isAdmin]);

  if (loading) {
    return (
      <main className="p-6 md:p-10 max-w-5xl mx-auto">
        <p className="text-sm text-[var(--ink)]/50">Loading…</p>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="p-6 md:p-10 max-w-5xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Portfolio</h1>
        <p className="text-sm text-[var(--ink)]/60">
          Only admins can view the cross-project overview -- it pulls every project
          regardless of your own membership, which isn't something to show partially.
        </p>
      </main>
    );
  }

  const atRisk = projects.filter((p) => severityFor(p.summary.overallDaysBehind) !== "on_track");
  const totalDelayedTasks = projects.reduce((s, p) => s + p.summary.delayed, 0);
  const totalActiveTasks = projects.reduce((s, p) => s + p.summary.totalTasks, 0);

  return (
    <main className="p-6 md:p-10 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Portfolio</h1>
      <p className="text-sm text-[var(--ink)]/60 mb-8">
        Every project's health at a glance -- same status math as each project's own
        Dashboard, just rolled up.
      </p>

      {error && (
        <div className="mb-4 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Stat strip -- current counts only, no invented trend arrows */}
      <div className="grid sm:grid-cols-3 gap-4 mb-8">
        <div className="panel p-5">
          <p className="text-3xl font-semibold font-mono-num">{projects.length}</p>
          <p className="text-xs text-[var(--ink)]/50 mt-1">Active projects</p>
        </div>
        <div className="panel p-5">
          <p className="text-3xl font-semibold font-mono-num" style={{ color: atRisk.length > 0 ? STATUS_COLOR.delayed : "var(--ink)" }}>
            {atRisk.length}
          </p>
          <p className="text-xs text-[var(--ink)]/50 mt-1">Flagged at risk or critical</p>
        </div>
        <div className="panel p-5">
          <p className="text-3xl font-semibold font-mono-num">
            {totalDelayedTasks}
            <span className="text-base text-[var(--ink)]/40"> / {totalActiveTasks}</span>
          </p>
          <p className="text-xs text-[var(--ink)]/50 mt-1">Delayed tasks, across all projects</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* At-risk projects */}
        <section>
          <h2 className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 mb-3">
            At-risk projects
          </h2>
          {atRisk.length === 0 ? (
            <p className="text-sm text-[var(--ink)]/50">Nothing flagged -- every project's on track.</p>
          ) : (
            <div className="panel divide-y divide-[var(--line)]">
              {atRisk
                .sort((a, b) => b.summary.overallDaysBehind - a.summary.overallDaysBehind)
                .map((p) => {
                  const sev = severityFor(p.summary.overallDaysBehind);
                  return (
                    <Link
                      key={p.project.id}
                      href={withProject("/internal", p.project.id)}
                      className="block p-4 hover:bg-[var(--accent)]/5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-sm truncate">{p.project.name}</p>
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full border shrink-0"
                          style={{
                            color: SEVERITY_COLOR[sev],
                            borderColor: SEVERITY_COLOR[sev] + "55",
                            backgroundColor: SEVERITY_COLOR[sev] + "12",
                          }}
                        >
                          {SEVERITY_LABEL[sev]}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--ink)]/50 mt-0.5">{p.project.customer}</p>
                      {p.summary.mostDelayedTask && (
                        <p className="text-xs text-[var(--ink)]/60 mt-1.5">
                          {p.summary.mostDelayedTask.description} &mdash;{" "}
                          <span className="font-mono-num">{p.summary.mostDelayedDays}d</span> behind
                        </p>
                      )}
                    </Link>
                  );
                })}
            </div>
          )}
        </section>

        {/* Team, honestly -- who's on which projects, not a fabricated workload count */}
        <section>
          <h2 className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 mb-3">
            Team
          </h2>
          <div className="panel divide-y divide-[var(--line)]">
            {members.map((m) => (
              <div key={m.id} className="p-4">
                <p className="font-medium text-sm">
                  {m.full_name || m.email}
                  {m.is_admin && (
                    <span className="ml-2 text-[10px] font-mono uppercase tracking-wide text-[var(--accent)] border border-[var(--accent)]/40 rounded px-1.5 py-0.5">
                      Admin
                    </span>
                  )}
                </p>
                <p className="text-xs text-[var(--ink)]/50 mt-0.5">
                  {m.projectNames.length > 0 ? m.projectNames.join(", ") : "Not on any project"}
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--ink)]/40 mt-2">
            Per-person task load and next-due dates aren&apos;t shown -- tasks don&apos;t
            currently have reliable individual assignment, so that number would be
            guessed rather than real.
          </p>
        </section>
      </div>
    </main>
  );
}
