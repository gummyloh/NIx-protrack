"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MeetingNote } from "@/lib/types";
import { ClientSnapshot } from "@/lib/clientSnapshot";
import { STATUS_LABEL, STATUS_COLOR } from "@/lib/schedule";

function fmtNoteDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtPublishedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface ProjectRow {
  name: string;
  customer: string;
  project_code: string | null;
  kickoff_date: string | null;
  target_buyoff_date: string | null;
  target_end_date: string | null;
}

interface ClientUpdate {
  published_at: string;
  note: string | null;
  snapshot: ClientSnapshot;
}

export default function CustomerView() {
  const [update, setUpdate] = useState<ClientUpdate | null>(null);
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

      // The customer page renders only the last snapshot the team
      // explicitly published -- never a live query -- so what's shown here
      // is always exactly what the team chose to share, as of when they
      // clicked "Publish".
      const [updateRes, projectRes, notesRes] = await Promise.all([
        fetch("/api/customer-update").then((r) => r.json()),
        fetch("/api/customer-project").then((r) => r.json()),
        fetch("/api/customer-meeting-notes").then((r) => r.json()),
      ]);
      if (!updateRes.ok || !projectRes.ok) {
        router.replace("/customer/login");
        return;
      }
      setUpdate(updateRes.update as ClientUpdate | null);
      setProject(projectRes.project as ProjectRow);
      setNotes(notesRes.ok ? notesRes.notes : []);
      setLoading(false);
    })();
  }, [router]);

  const snapshot = update?.snapshot ?? null;

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

      {!snapshot ? (
        <div className="border border-[var(--line)] rounded-lg p-5 bg-white/60 mb-8">
          <p className="text-sm text-[var(--ink)]/60">
            No progress update has been published yet. Check back soon, or
            reach out to your project contact.
          </p>
        </div>
      ) : (
        <>
          <div className="border border-[var(--line)] rounded-lg p-5 bg-white/60 mb-2">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <div>
                <p className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
                  Overall status
                </p>
                <p
                  className="text-xl font-semibold mt-1"
                  style={{
                    color: snapshot.overallStatus === "On schedule" ? "var(--accent)" : "var(--amber)",
                  }}
                >
                  {snapshot.overallStatus}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
                  Overall progress
                </p>
                <p className="text-3xl font-semibold mt-1 font-mono-num" style={{ color: "var(--accent)" }}>
                  {snapshot.overallPercent}%
                </p>
                <p className="text-xs text-[var(--ink)]/50 font-mono-num">
                  {snapshot.completed} / {snapshot.totalTasks} tasks complete
                </p>
              </div>
            </div>
            <div className="h-2 bg-[var(--line)] rounded-full overflow-hidden mt-4 mb-2">
              <div
                className="h-full bg-[var(--accent)]"
                style={{ width: `${snapshot.overallPercent}%` }}
              />
            </div>
            <p className="text-xs text-[var(--ink)]/40">
              Progress is weighted by task duration ({snapshot.totalDurationDays} person-days across the shared tasks), so it reflects actual effort completed rather than a simple task count.
            </p>
            {snapshot.mostDelayed && (
              <p className="text-sm text-[var(--ink)]/60 mt-3 pt-3 border-t border-[var(--line)]">
                Most attention needed:{" "}
                <span className="font-medium text-[var(--ink)]">
                  {snapshot.mostDelayed.description}
                </span>{" "}
                ({snapshot.mostDelayed.department})
              </p>
            )}
          </div>
          <p className="text-xs text-[var(--ink)]/40 mb-8">
            Last updated {fmtPublishedAt(update!.published_at)}
            {update?.note ? ` — ${update.note}` : ""}
          </p>

          {snapshot.moduleRollup && snapshot.moduleRollup.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-mono uppercase tracking-wide text-[var(--ink)]/50 mb-3">
                Machine Readiness
              </h2>
              <div className="space-y-4">
                {snapshot.moduleRollup.map((mod) => (
                  <div
                    key={mod.name}
                    className="border border-[var(--line)] rounded-lg p-5 bg-white/60"
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                      <h3 className="font-medium">{mod.name}</h3>
                      <span
                        className="text-xs font-medium whitespace-nowrap px-2 py-0.5 rounded-full border shrink-0"
                        style={
                          mod.ready
                            ? {
                                color: "var(--accent)",
                                borderColor: "var(--accent)55",
                                backgroundColor: "var(--accent)12",
                              }
                            : {
                                color: "var(--rust)",
                                borderColor: "var(--rust)55",
                                backgroundColor: "var(--rust)12",
                              }
                        }
                      >
                        {mod.ready
                          ? "Ready"
                          : `${mod.openBlockerCount} open blocker${mod.openBlockerCount === 1 ? "" : "s"}`}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {mod.stations.map((s) => (
                        <div key={s.name} className="text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[var(--ink)]/80">{s.name}</span>
                            <span
                              className="text-xs font-medium whitespace-nowrap px-2 py-0.5 rounded-full border shrink-0"
                              style={
                                s.ready
                                  ? {
                                      color: "var(--accent)",
                                      borderColor: "var(--accent)55",
                                      backgroundColor: "var(--accent)12",
                                    }
                                  : {
                                      color: "var(--rust)",
                                      borderColor: "var(--rust)55",
                                      backgroundColor: "var(--rust)12",
                                    }
                              }
                            >
                              {s.ready ? "Ready" : "Not ready"}
                            </span>
                          </div>
                          {s.visibleItems.length > 0 && (
                            <ul className="mt-1 ml-3 list-disc text-xs text-[var(--ink)]/60 space-y-0.5">
                              {s.visibleItems.map((item, i) => (
                                <li key={i}>
                                  {item.description}
                                  {item.severity === "blocker" ? " (blocker)" : ""}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-6">
            {snapshot.departments.map((dept) => (
              <div
                key={dept.department}
                className="border border-[var(--line)] rounded-lg p-5 bg-white/60"
              >
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-medium">{dept.department}</h2>
                  <span className="text-xs font-mono-num text-[var(--ink)]/50">
                    {dept.avgPercent}% avg
                  </span>
                </div>
                <div className="h-1.5 bg-[var(--line)] rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full bg-[var(--accent)]"
                    style={{ width: `${dept.avgPercent}%` }}
                  />
                </div>
                <div className="space-y-2">
                  {dept.tasks.map((t) => (
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
                          color: STATUS_COLOR[t.status],
                          borderColor: STATUS_COLOR[t.status] + "55",
                          backgroundColor: STATUS_COLOR[t.status] + "12",
                        }}
                      >
                        {STATUS_LABEL[t.status]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

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
