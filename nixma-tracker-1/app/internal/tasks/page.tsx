"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Task, DEPARTMENTS } from "@/lib/types";
import { useProjectId, withProject } from "@/lib/useProjectId";
import {
  computeStatus,
  summarize,
  overallProgress,
  STATUS_LABEL,
  STATUS_COLOR,
} from "@/lib/schedule";
import { exportTasksPdf } from "@/lib/exportPdf";
import { useTaskRealtime } from "@/lib/useTaskRealtime";
import { buildClientSnapshot } from "@/lib/clientSnapshot";

interface TaskHistoryRow {
  id: number;
  changed_at: string;
  changed_by_name: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
}

const HISTORY_FIELD_LABEL: Record<string, string> = {
  scheduled_start: "Scheduled start",
  scheduled_finish: "Scheduled finish",
  percent_complete: "% complete",
  assignee: "Owner",
  status_note: "Note",
  is_active: "In use",
};

function fmtHistoryTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
  const [projectInfo, setProjectInfo] = useState<{ name: string; customer: string; project_code: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const { staleNotice, dismissStaleNotice, markLocalWrite } = useTaskRealtime(projectId);
  const [historyTask, setHistoryTask] = useState<Task | null>(null);
  const [historyRows, setHistoryRows] = useState<TaskHistoryRow[] | null>(null);
  const [publishNote, setPublishNote] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [lastPublished, setLastPublished] = useState<string | null>(null);

  async function loadLastPublished() {
    const { data } = await supabase
      .from("client_updates")
      .select("published_at")
      .eq("project_id", projectId)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastPublished((data as { published_at: string } | null)?.published_at ?? null);
  }

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
    loadLastPublished();
    supabase
      .from("projects")
      .select("name, customer, project_code")
      .eq("id", projectId)
      .single()
      .then(({ data }) => setProjectInfo(data as typeof projectInfo));
  }, [projectId]);

  function handleExportPdf() {
    exportTasksPdf(tasks, {
      projectName: projectInfo?.name ?? projectId,
      customer: projectInfo?.customer,
      projectCode: projectInfo?.project_code,
    });
  }

  const today = useMemo(() => new Date(), []);
  const summary = useMemo(() => summarize(tasks, today), [tasks, today]);
  const progress = useMemo(() => overallProgress(tasks), [tasks]);

  async function updateTask(id: number, patch: Partial<Task>) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setSavingIds((prev) => new Set(prev).add(id));
    markLocalWrite();
    const { error: err } = await supabase.from("tasks").update(patch).eq("id", id);
    markLocalWrite();
    setSavingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (err) setError(err.message);
  }

  const trimmedSearch = search.trim().toLowerCase();
  const visibleTasks = tasks.filter((t) => {
    if (t.is_summary) return false;
    if (deptFilter !== "All" && t.department !== deptFilter) return false;
    if (!showInactive && !t.is_active) return false;
    if (statusFilter !== "All" && computeStatus(t, today) !== statusFilter) return false;
    if (trimmedSearch) {
      const haystack = `${t.description} ${t.task_no} ${t.assignee ?? ""} ${t.status_note ?? ""}`.toLowerCase();
      if (!haystack.includes(trimmedSearch)) return false;
    }
    return true;
  });

  const allVisibleActive =
    visibleTasks.length > 0 && visibleTasks.every((t) => t.is_active);

  async function openHistory(t: Task) {
    setHistoryTask(t);
    setHistoryRows(null);
    const { data, error: err } = await supabase.rpc("get_task_history", { p_task_id: t.id });
    if (err) {
      setError(err.message);
      setHistoryRows([]);
    } else {
      setHistoryRows((data as TaskHistoryRow[]) || []);
    }
  }

  async function updateAllVisible(active: boolean) {
    const ids = visibleTasks.map((t) => t.id);
    if (ids.length === 0) return;
    setTasks((prev) =>
      prev.map((t) => (ids.includes(t.id) ? { ...t, is_active: active } : t))
    );
    setSavingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    markLocalWrite();
    const { error: err } = await supabase
      .from("tasks")
      .update({ is_active: active })
      .in("id", ids);
    markLocalWrite();
    setSavingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    if (err) setError(err.message);
  }

  // Publishing always reflects the full, project-wide curated set -- every
  // active, non-summary task currently checked "Client" -- regardless of
  // whatever search/department/status filters happen to be applied to the
  // table on screen right now. What the admin is filtering by is just a way
  // of navigating the table; it should never silently change what the
  // client ends up seeing.
  async function handlePublish() {
    setPublishing(true);
    setPublishMessage(null);
    const clientVisible = tasks.filter(
      (t) => t.show_to_client && t.is_active && !t.is_summary
    );
    const snapshot = buildClientSnapshot(clientVisible, today);
    const { error: err } = await supabase.rpc("publish_client_update", {
      p_project_id: projectId,
      p_note: publishNote.trim() || null,
      p_snapshot: snapshot,
    });
    setPublishing(false);
    if (err) {
      setPublishMessage(`Couldn't publish: ${err.message}`);
    } else {
      setPublishNote("");
      setPublishMessage(`Published — the client's page now shows this update.`);
      loadLastPublished();
    }
  }

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
        <button
          onClick={handleExportPdf}
          className="text-xs font-mono uppercase tracking-wide bg-[var(--accent)] text-white rounded px-3 py-2 hover:opacity-90 shrink-0"
        >
          Export PDF
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      {staleNotice && (
        <div className="mb-4 flex items-center justify-between gap-3 text-sm text-[var(--amber)] bg-[var(--amber)]/10 border border-[var(--amber)]/30 rounded px-3 py-2">
          <span>Someone else updated this project's tasks. Refresh to see the latest.</span>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => {
                dismissStaleNotice();
                loadTasks();
              }}
              className="underline font-medium hover:opacity-80"
            >
              Refresh
            </button>
            <button onClick={dismissStaleNotice} className="text-[var(--ink)]/40 hover:text-[var(--ink)]/70">
              Dismiss
            </button>
          </div>
        </div>
      )}

      <SummaryCards summary={summary} progress={progress} />

      <div className="mt-6 border border-[var(--line)] rounded-lg p-4 bg-white/60">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <div>
            <h2 className="text-sm font-semibold">Publish update to client</h2>
            <p className="text-xs text-[var(--ink)]/50 mt-0.5">
              The client's status page only ever shows the last update you
              publish here — tick "Client" on the tasks below to include
              them, then publish. Editing tasks doesn't change what the
              client sees until you publish again.
            </p>
          </div>
          <span className="text-xs text-[var(--ink)]/40 shrink-0">
            {lastPublished
              ? `Last published: ${fmtHistoryTimestamp(lastPublished)}`
              : "Never published yet"}
          </span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            value={publishNote}
            onChange={(e) => setPublishNote(e.target.value)}
            placeholder="Optional note for the client (e.g. what changed)"
            className="border border-[var(--line)] rounded px-2.5 py-1.5 text-sm bg-white flex-1 min-w-[220px]"
          />
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="text-xs font-mono uppercase tracking-wide bg-[var(--accent)] text-white rounded px-3 py-2 hover:opacity-90 disabled:opacity-50 shrink-0"
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
        {publishMessage && (
          <p className="text-xs mt-2 text-[var(--ink)]/60">{publishMessage}</p>
        )}
      </div>

      <div className="flex items-center gap-4 my-6 flex-wrap">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks, owner, notes…"
          className="border border-[var(--line)] rounded px-2.5 py-1 text-sm bg-white min-w-[200px]"
        />
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
        <div className="flex items-center gap-3">
          <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-[var(--line)] rounded px-2 py-1 text-sm bg-white"
          >
            <option>All</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
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
        {(trimmedSearch || deptFilter !== "All" || statusFilter !== "All") && (
          <span className="text-xs text-[var(--ink)]/40">
            {visibleTasks.length} match{visibleTasks.length === 1 ? "" : "es"}
          </span>
        )}
      </div>

      <div className="overflow-x-auto border border-[var(--line)] rounded-lg bg-white/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
              <th className="p-3 w-16">
                <div className="flex flex-col gap-1">
                  <input
                    type="checkbox"
                    checked={allVisibleActive}
                    onChange={(e) => updateAllVisible(e.target.checked)}
                    title={
                      allVisibleActive
                        ? "Deselect all visible tasks"
                        : "Select all visible tasks"
                    }
                  />
                  <span>In use</span>
                </div>
              </th>
              <th className="p-3 min-w-[240px]">Task</th>
              <th className="p-3 w-16">Client</th>
              <th className="p-3">Dept</th>
              <th className="p-3 whitespace-nowrap">Planned</th>
              <th className="p-3 whitespace-nowrap">Scheduled</th>
              <th className="p-3">Status</th>
              <th className="p-3 min-w-[200px]">Note</th>
              <th className="p-3 w-20">History</th>
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
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={t.show_to_client}
                      onChange={(e) => updateTask(t.id, { show_to_client: e.target.checked })}
                      title="Include this task in the next published client update"
                    />
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
                  <td className="p-3">
                    <button
                      onClick={() => openHistory(t)}
                      className="text-xs underline text-[var(--ink)]/50 hover:text-[var(--accent)]"
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {historyTask && (
        <HistoryModal
          task={historyTask}
          rows={historyRows}
          onClose={() => {
            setHistoryTask(null);
            setHistoryRows(null);
          }}
        />
      )}
    </main>
  );
}

function HistoryModal({
  task,
  rows,
  onClose,
}: {
  task: Task;
  rows: TaskHistoryRow[] | null;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4 gap-3">
          <div>
            <h2 className="font-semibold">{task.description}</h2>
            <p className="text-xs text-[var(--ink)]/40 font-mono">Change history</p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--ink)]/40 hover:text-[var(--ink)]/70 text-sm"
          >
            Close
          </button>
        </div>

        {rows === null ? (
          <p className="text-sm text-[var(--ink)]/50">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--ink)]/50">No changes recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="text-sm border-b border-[var(--line)] pb-2 last:border-0">
                <p>
                  <span className="font-medium">{HISTORY_FIELD_LABEL[r.field] ?? r.field}</span>{" "}
                  changed from{" "}
                  <span className="font-mono-num text-[var(--ink)]/70">{r.old_value ?? "—"}</span>{" "}
                  to{" "}
                  <span className="font-mono-num text-[var(--accent)]">{r.new_value ?? "—"}</span>
                </p>
                <p className="text-xs text-[var(--ink)]/40 mt-0.5">
                  {r.changed_by_name} &middot; {fmtHistoryTimestamp(r.changed_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SummaryCards({
  summary,
  progress,
}: {
  summary: ReturnType<typeof summarize>;
  progress: ReturnType<typeof overallProgress>;
}) {
  const items = [
    { label: "Overall progress", value: `${progress.weightedPercent}%`, color: "var(--accent)" },
    { label: "Active tasks", value: summary.totalTasks, color: "var(--ink)" },
    { label: "Completed", value: summary.completed, color: "#3a5a8c" },
    { label: "On track", value: summary.onTrack, color: "var(--accent)" },
    { label: "At risk", value: summary.atRisk, color: "var(--amber)" },
    { label: "Delayed", value: summary.delayed, color: "var(--rust)" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
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
