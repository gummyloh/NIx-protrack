"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Task } from "@/lib/types";
import { useProjectId, withProject } from "@/lib/useProjectId";
import { PunchItem, buildModuleRollup, RAG_LABEL, RAG_COLOR } from "@/lib/punchlist";

function fmtDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ModuleRollup() {
  const projectId = useProjectId();
  const [punchItems, setPunchItems] = useState<PunchItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      const [
        { data: punchData, error: punchErr },
        { data: taskData, error: taskErr },
      ] = await Promise.all([
        supabase
          .from("punch_list_items")
          .select("*")
          .eq("project_id", projectId)
          .order("item_no", { ascending: true }),
        supabase
          .from("tasks")
          .select("*")
          .eq("project_id", projectId)
          .eq("is_active", true)
          .eq("is_summary", false)
          .not("modules", "is", null),
      ]);
      if (punchErr) setError(punchErr.message);
      else if (taskErr) setError(taskErr.message);
      else {
        setPunchItems((punchData as PunchItem[]) || []);
        setTasks((taskData as Task[]) || []);
      }
      setLoading(false);
    })();
  }, [projectId]);

  const today = useMemo(() => new Date(), []);
  const modules = useMemo(
    () => buildModuleRollup(punchItems, tasks, today),
    [punchItems, tasks, today]
  );

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-[var(--ink)]/50">Loading module rollup…</p>
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
          <h1 className="text-2xl font-semibold mt-1">Module rollup</h1>
          <p className="text-sm text-[var(--ink)]/60">
            Teleflex punch list, rolled up by machine module and station.{" "}
            <Link
              href={withProject("/internal/board", projectId)}
              className="underline hover:text-[var(--accent)]"
            >
              Board
            </Link>{" "}
            &middot;{" "}
            <Link
              href={withProject("/internal/gantt", projectId)}
              className="underline hover:text-[var(--accent)]"
            >
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

      {!loading && !error && punchItems.length === 0 && (
        <p className="text-sm text-[var(--ink)]/50">
          No punch list items loaded for this project yet.
        </p>
      )}

      <div className="space-y-6">
        {modules.map((mod) => (
          <div
            key={mod.module}
            className="rounded-lg overflow-hidden border border-[var(--line)] bg-white/60"
          >
            <div className="flex items-center justify-between px-4 py-3 flex-wrap gap-2 bg-white/70 border-b border-[var(--line)]">
              <span className="font-semibold">{mod.module}</span>
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wide">
                {mod.onTrack > 0 && (
                  <span
                    className="px-2 py-0.5 rounded-full"
                    style={{
                      color: RAG_COLOR.on_track,
                      backgroundColor: RAG_COLOR.on_track + "18",
                    }}
                  >
                    {mod.onTrack} on track
                  </span>
                )}
                {mod.atRisk > 0 && (
                  <span
                    className="px-2 py-0.5 rounded-full"
                    style={{
                      color: RAG_COLOR.at_risk,
                      backgroundColor: RAG_COLOR.at_risk + "18",
                    }}
                  >
                    {mod.atRisk} at risk
                  </span>
                )}
                {mod.blocked > 0 && (
                  <span
                    className="px-2 py-0.5 rounded-full"
                    style={{
                      color: RAG_COLOR.blocked,
                      backgroundColor: RAG_COLOR.blocked + "18",
                    }}
                  >
                    {mod.blocked} blocked
                  </span>
                )}
              </div>
            </div>

            <div>
              {mod.stations.map((st) => {
                const key = `${mod.module}::${st.station}`;
                const isOpen = expanded.has(key);
                return (
                  <div key={key} className="border-b border-[var(--line)] last:border-0">
                    <button
                      onClick={() => toggle(key)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/50"
                    >
                      <span className="text-xs shrink-0">{isOpen ? "▼" : "▶"}</span>
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: RAG_COLOR[st.rag] }}
                      />
                      <span className="text-sm flex-1 min-w-0">
                        <span className="font-medium">{st.station}</span>
                        {st.ragReason && (
                          <span className="block text-xs text-[var(--ink)]/50 truncate">
                            {st.ragReason}
                          </span>
                        )}
                      </span>
                      {st.linkedTasks.length > 0 && (
                        <span className="text-xs text-[var(--ink)]/40 font-mono shrink-0 hidden sm:inline">
                          {st.linkedTasks.length} internal task
                          {st.linkedTasks.length === 1 ? "" : "s"}
                        </span>
                      )}
                      {st.nextTargetDate && (
                        <span className="text-xs text-[var(--ink)]/50 font-mono-num shrink-0">
                          due {fmtDate(st.nextTargetDate)}
                        </span>
                      )}
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded shrink-0"
                        style={{
                          color: RAG_COLOR[st.rag],
                          backgroundColor: RAG_COLOR[st.rag] + "18",
                        }}
                      >
                        {st.avgPercent}%
                      </span>
                    </button>

                    {isOpen && (
                      <div className="overflow-x-auto bg-white/40">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left font-mono uppercase tracking-wide text-[var(--ink)]/40 border-t border-[var(--line)]">
                              <th className="p-2 pl-11 w-28">Category</th>
                              <th className="p-2 min-w-[220px]">Item</th>
                              <th className="p-2 w-20">Priority</th>
                              <th className="p-2 w-28">Status</th>
                              <th className="p-2 w-14">%</th>
                              <th className="p-2 w-24">Target</th>
                            </tr>
                          </thead>
                          <tbody>
                            {st.items.map((it) => (
                              <tr key={it.id} className="border-t border-[var(--line)]">
                                <td className="p-2 pl-11 text-[var(--ink)]/60">{it.category}</td>
                                <td className="p-2">{it.item_scope}</td>
                                <td className="p-2 text-[var(--ink)]/60">{it.priority}</td>
                                <td className="p-2 text-[var(--ink)]/60">{it.status}</td>
                                <td className="p-2 font-mono-num">{it.percent_complete}</td>
                                <td className="p-2 font-mono-num text-[var(--ink)]/60">
                                  {it.target_date ? fmtDate(it.target_date) : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {st.linkedTasks.length > 0 && (
                          <div className="px-4 pl-11 py-2 border-t border-[var(--line)] text-xs text-[var(--ink)]/50">
                            Internal Gantt:{" "}
                            {st.linkedTasks
                              .map((t) => `${t.description} (${t.percent_complete}%)`)
                              .join(", ")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
