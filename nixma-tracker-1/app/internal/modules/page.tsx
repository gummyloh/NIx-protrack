"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ModuleRow, StationRow, PunchItem, PunchSeverity, Task, ProjectRow } from "@/lib/types";
import { useProjectId, withProject } from "@/lib/useProjectId";
import { useInternalAuth } from "@/lib/internalAuth";
import { computeModuleRollup, ModuleRollup } from "@/lib/moduleReadiness";

const SEVERITY_LABEL: Record<PunchSeverity, string> = {
  blocker: "Blocker",
  minor: "Minor",
  cosmetic: "Cosmetic",
};

const SEVERITY_COLOR: Record<PunchSeverity, string> = {
  blocker: "var(--rust)",
  minor: "var(--amber)",
  cosmetic: "var(--ink)",
};

function readinessBadge(ready: boolean, hasStations: boolean) {
  if (!hasStations) {
    return { label: "No stations yet", color: "var(--ink)", dim: true };
  }
  return ready
    ? { label: "Ready", color: "var(--accent)", dim: false }
    : { label: "Blocked", color: "var(--rust)", dim: false };
}

function fmtTargetDate(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function ModulesPage() {
  const projectId = useProjectId();
  const { isAdmin } = useInternalAuth();

  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [stations, setStations] = useState<StationRow[]>([]);
  const [punchItems, setPunchItems] = useState<PunchItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [otherProjects, setOtherProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newModuleName, setNewModuleName] = useState("");
  const [addingModule, setAddingModule] = useState(false);
  const [cloneSourceId, setCloneSourceId] = useState("");
  const [cloning, setCloning] = useState(false);

  const [newStationName, setNewStationName] = useState<Record<number, string>>({});
  const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set());

  const [punchForm, setPunchForm] = useState<Record<
    number,
    { description: string; severity: PunchSeverity; linkedTaskId: string }
  >>({});

  async function loadAll() {
    setLoading(true);
    setError(null);
    const [modulesRes, stationsRes, itemsRes, tasksRes, projectsRes] = await Promise.all([
      supabase.from("modules").select("*").eq("project_id", projectId),
      supabase.from("stations").select("*").eq("project_id", projectId),
      supabase.from("punch_items").select("*").eq("project_id", projectId),
      supabase
        .from("tasks")
        .select("*")
        .eq("project_id", projectId)
        .eq("is_active", true)
        .eq("is_summary", false)
        .order("id", { ascending: true }),
      supabase.rpc("list_projects"),
    ]);
    if (modulesRes.error) setError(modulesRes.error.message);
    else setModules(modulesRes.data as ModuleRow[]);
    if (stationsRes.data) setStations(stationsRes.data as StationRow[]);
    if (itemsRes.data) setPunchItems(itemsRes.data as PunchItem[]);
    if (tasksRes.data) setTasks(tasksRes.data as Task[]);
    if (projectsRes.data) {
      setOtherProjects((projectsRes.data as ProjectRow[]).filter((p) => p.id !== projectId));
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const rollup = useMemo(
    () => computeModuleRollup(modules, stations, punchItems),
    [modules, stations, punchItems]
  );

  // Separate from linked_task_id (an explicit link set on one punch item):
  // this reads the schedule side's own tasks.stations tagging, so a station
  // shows which master-schedule tasks already claim to cover it even before
  // anyone links a specific punch item to one.
  const tasksByStation = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      for (const stationName of t.stations ?? []) {
        if (!map.has(stationName)) map.set(stationName, []);
        map.get(stationName)!.push(t);
      }
    }
    return map;
  }, [tasks]);

  function toggleExpanded(moduleId: number) {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      next.has(moduleId) ? next.delete(moduleId) : next.add(moduleId);
      return next;
    });
  }

  async function handleAddModule() {
    if (!newModuleName.trim()) return;
    setAddingModule(true);
    setError(null);
    const nextSequence = modules.length
      ? Math.max(...modules.map((m) => m.sequence)) + 1
      : 0;
    const { error: err } = await supabase
      .from("modules")
      .insert({ project_id: projectId, name: newModuleName.trim(), sequence: nextSequence });
    setAddingModule(false);
    if (err) {
      setError(err.message);
      return;
    }
    setNewModuleName("");
    await loadAll();
  }

  async function handleClone() {
    if (!cloneSourceId) return;
    setCloning(true);
    setError(null);
    const { error: err } = await supabase.rpc("clone_modules_from_project", {
      p_source_project_id: cloneSourceId,
      p_target_project_id: projectId,
    });
    setCloning(false);
    if (err) {
      setError(err.message);
      return;
    }
    await loadAll();
  }

  async function handleAddStation(moduleId: number) {
    const name = (newStationName[moduleId] ?? "").trim();
    if (!name) return;
    const moduleStations = stations.filter((s) => s.module_id === moduleId);
    const nextSequence = moduleStations.length
      ? Math.max(...moduleStations.map((s) => s.sequence)) + 1
      : 0;
    const { error: err } = await supabase
      .from("stations")
      .insert({ module_id: moduleId, project_id: projectId, name, sequence: nextSequence });
    if (err) {
      setError(err.message);
      return;
    }
    setNewStationName((prev) => ({ ...prev, [moduleId]: "" }));
    await loadAll();
  }

  function punchFormFor(stationId: number) {
    return punchForm[stationId] ?? { description: "", severity: "minor" as PunchSeverity, linkedTaskId: "" };
  }

  async function handleAddPunchItem(stationId: number) {
    const form = punchFormFor(stationId);
    if (!form.description.trim()) return;
    const { error: err } = await supabase.from("punch_items").insert({
      station_id: stationId,
      project_id: projectId,
      description: form.description.trim(),
      severity: form.severity,
      linked_task_id: form.linkedTaskId ? Number(form.linkedTaskId) : null,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setPunchForm((prev) => ({ ...prev, [stationId]: { description: "", severity: "minor", linkedTaskId: "" } }));
    await loadAll();
  }

  async function handleSetStatus(itemId: number, status: "open" | "closed" | "waived") {
    const { error: err } = await supabase.rpc("set_punch_item_status", {
      p_punch_item_id: itemId,
      p_status: status,
    });
    if (err) {
      setError(err.message);
      return;
    }
    await loadAll();
  }

  async function handleToggleClientVisible(itemId: number, value: boolean) {
    const { error: err } = await supabase
      .from("punch_items")
      .update({ show_to_client: value })
      .eq("id", itemId);
    if (err) {
      setError(err.message);
      return;
    }
    setPunchItems((prev) => prev.map((p) => (p.id === itemId ? { ...p, show_to_client: value } : p)));
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-[var(--ink)]/50">Loading module rollup…</p>
      </main>
    );
  }

  return (
    <main className="p-6 md:p-10 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <Link
            href={withProject("/internal", projectId)}
            className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 hover:text-[var(--accent)]"
          >
            &larr; Dashboard
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Module Rollup</h1>
          <p className="text-sm text-[var(--ink)]/60">
            Machine readiness, separate from schedule progress — a module
            isn&rsquo;t ready until every station under it has no open
            blocker items. Modules and stations are just names you set up
            per project; nothing here is hardcoded to this machine.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      {modules.length === 0 && (
        <div className="border border-[var(--line)] rounded-lg p-5 bg-white/60 mb-6 space-y-4">
          <p className="text-sm text-[var(--ink)]/70">
            No modules set up for this project yet. Start from scratch, or
            {isAdmin ? " clone the module/station structure from a similar past project." : " ask an admin to set these up."}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={newModuleName}
              onChange={(e) => setNewModuleName(e.target.value)}
              placeholder="First module name, e.g. Pouch Loading"
              className="border border-[var(--line)] rounded px-2.5 py-1.5 text-sm bg-white flex-1 min-w-[200px]"
            />
            <button
              onClick={handleAddModule}
              disabled={addingModule || !newModuleName.trim()}
              className="text-xs font-mono uppercase tracking-wide bg-[var(--accent)] text-white rounded px-3 py-2 hover:opacity-90 disabled:opacity-50"
            >
              {addingModule ? "Adding…" : "Add module"}
            </button>
          </div>
          {isAdmin && otherProjects.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-[var(--line)]">
              <span className="text-xs text-[var(--ink)]/50">or</span>
              <select
                value={cloneSourceId}
                onChange={(e) => setCloneSourceId(e.target.value)}
                className="border border-[var(--line)] rounded px-2 py-1.5 text-sm bg-white"
              >
                <option value="">Clone modules from…</option>
                {otherProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.customer})
                  </option>
                ))}
              </select>
              <button
                onClick={handleClone}
                disabled={cloning || !cloneSourceId}
                className="text-xs font-mono uppercase tracking-wide border border-[var(--accent)] text-[var(--accent)] rounded px-3 py-2 hover:bg-[var(--accent)]/10 disabled:opacity-50"
              >
                {cloning ? "Cloning…" : "Clone module structure"}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {rollup.map((m: ModuleRollup) => {
          const badge = readinessBadge(m.ready, m.stations.length > 0);
          const isExpanded = expandedModules.has(m.module.id);
          return (
            <div key={m.module.id} className="border border-[var(--line)] rounded-lg bg-white/60 overflow-hidden">
              <button
                onClick={() => toggleExpanded(m.module.id)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs">{isExpanded ? "▾" : "▸"}</span>
                  <span className="font-semibold">{m.module.name}</span>
                  <span className="text-xs text-[var(--ink)]/40 font-mono-num">
                    ({m.stations.length} station{m.stations.length === 1 ? "" : "s"})
                  </span>
                </div>
                <span
                  className="text-xs font-medium whitespace-nowrap px-2.5 py-1 rounded-full border"
                  style={{
                    color: badge.dim ? "var(--ink)" : "white",
                    backgroundColor: badge.dim ? "transparent" : badge.color,
                    borderColor: badge.color,
                    opacity: badge.dim ? 0.5 : 1,
                  }}
                >
                  {badge.label}
                  {m.openBlockerCount > 0 ? ` · ${m.openBlockerCount} open` : ""}
                </span>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-[var(--line)] pt-3">
                  {m.stations.map((s) => {
                    const relatedTasks = tasksByStation.get(s.station.name) ?? [];
                    return (
                      <div key={s.station.id} className="border border-[var(--line)] rounded-lg p-3 bg-white/70">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="font-medium text-sm">{s.station.name}</span>
                          <span
                            className="text-xs font-medium px-2 py-0.5 rounded-full border"
                            style={{
                              color: s.ready ? "var(--accent)" : "var(--rust)",
                              borderColor: (s.ready ? "var(--accent)" : "var(--rust)") + "55",
                              backgroundColor: (s.ready ? "var(--accent)" : "var(--rust)") + "12",
                            }}
                          >
                            {s.ready ? "Ready" : `${s.openBlockerCount} blocker${s.openBlockerCount === 1 ? "" : "s"}`}
                          </span>
                        </div>

                        {relatedTasks.length > 0 && (
                          <p className="text-xs text-[var(--ink)]/40 mb-2">
                            Schedule tasks tagged to this station:{" "}
                            {relatedTasks.map((t) => `${t.description} (${t.percent_complete}%)`).join(", ")}
                          </p>
                        )}

                        <div className="space-y-1.5 mb-3">
                          {s.items.length === 0 && (
                            <p className="text-xs text-[var(--ink)]/40 italic">No punch items logged.</p>
                          )}
                          {s.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center justify-between gap-2 text-sm border-b border-[var(--line)]/60 pb-1.5 last:border-0 flex-wrap"
                            >
                              <div className="min-w-0 flex-1">
                                <span
                                  className={
                                    item.status === "open"
                                      ? "text-[var(--ink)]/80"
                                      : "text-[var(--ink)]/40 line-through"
                                  }
                                >
                                  {item.description}
                                </span>
                                {item.linked_task_id && (
                                  <Link
                                    href={withProject("/internal/tasks", projectId)}
                                    className="ml-2 text-xs underline text-[var(--ink)]/40 hover:text-[var(--accent)]"
                                  >
                                    linked task #{item.linked_task_id}
                                  </Link>
                                )}
                                {(item.category || item.pic || item.target_date || item.percent_complete !== null || item.remarks) && (
                                  <div className="text-xs text-[var(--ink)]/40 mt-0.5">
                                    {[
                                      item.category,
                                      item.pic ? `PIC: ${item.pic}` : null,
                                      item.target_date ? `due ${fmtTargetDate(item.target_date)}` : null,
                                      item.percent_complete !== null ? `${item.percent_complete}%` : null,
                                      item.remarks,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </div>
                                )}
                              </div>
                              <span
                                className="text-xs font-medium whitespace-nowrap shrink-0"
                                style={{ color: SEVERITY_COLOR[item.severity] }}
                              >
                                {SEVERITY_LABEL[item.severity]}
                              </span>
                              <label className="text-xs text-[var(--ink)]/50 flex items-center gap-1 shrink-0" title="Visible to client if this module is published">
                                <input
                                  type="checkbox"
                                  checked={item.show_to_client}
                                  onChange={(e) => handleToggleClientVisible(item.id, e.target.checked)}
                                />
                                Client
                              </label>
                              <div className="flex items-center gap-1 shrink-0">
                                {item.status !== "closed" && (
                                  <button
                                    onClick={() => handleSetStatus(item.id, "closed")}
                                    className="text-xs text-[var(--accent)] hover:opacity-70"
                                  >
                                    Close
                                  </button>
                                )}
                                {item.status !== "waived" && (
                                  <button
                                    onClick={() => handleSetStatus(item.id, "waived")}
                                    className="text-xs text-[var(--ink)]/50 hover:opacity-70"
                                  >
                                    Waive
                                  </button>
                                )}
                                {item.status !== "open" && (
                                  <button
                                    onClick={() => handleSetStatus(item.id, "open")}
                                    className="text-xs text-[var(--amber)] hover:opacity-70"
                                  >
                                    Reopen
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            value={punchFormFor(s.station.id).description}
                            onChange={(e) =>
                              setPunchForm((prev) => ({
                                ...prev,
                                [s.station.id]: { ...punchFormFor(s.station.id), description: e.target.value },
                              }))
                            }
                            placeholder="Log a punch item…"
                            className="border border-[var(--line)] rounded px-2 py-1 text-xs bg-white flex-1 min-w-[160px]"
                          />
                          <select
                            value={punchFormFor(s.station.id).severity}
                            onChange={(e) =>
                              setPunchForm((prev) => ({
                                ...prev,
                                [s.station.id]: {
                                  ...punchFormFor(s.station.id),
                                  severity: e.target.value as PunchSeverity,
                                },
                              }))
                            }
                            className="border border-[var(--line)] rounded px-1.5 py-1 text-xs bg-white"
                          >
                            <option value="blocker">Blocker</option>
                            <option value="minor">Minor</option>
                            <option value="cosmetic">Cosmetic</option>
                          </select>
                          <select
                            value={punchFormFor(s.station.id).linkedTaskId}
                            onChange={(e) =>
                              setPunchForm((prev) => ({
                                ...prev,
                                [s.station.id]: { ...punchFormFor(s.station.id), linkedTaskId: e.target.value },
                              }))
                            }
                            className="border border-[var(--line)] rounded px-1.5 py-1 text-xs bg-white max-w-[160px]"
                          >
                            <option value="">No linked task</option>
                            {tasks.map((t) => (
                              <option key={t.id} value={t.id}>
                                #{t.id} {t.description.slice(0, 30)}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleAddPunchItem(s.station.id)}
                            disabled={!punchFormFor(s.station.id).description.trim()}
                            className="text-xs font-mono uppercase tracking-wide bg-[var(--accent)] text-white rounded px-2.5 py-1.5 hover:opacity-90 disabled:opacity-50"
                          >
                            Log
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <input
                      value={newStationName[m.module.id] ?? ""}
                      onChange={(e) =>
                        setNewStationName((prev) => ({ ...prev, [m.module.id]: e.target.value }))
                      }
                      placeholder="New station name…"
                      className="border border-[var(--line)] rounded px-2 py-1.5 text-xs bg-white flex-1 min-w-[160px]"
                    />
                    <button
                      onClick={() => handleAddStation(m.module.id)}
                      disabled={!(newStationName[m.module.id] ?? "").trim()}
                      className="text-xs font-mono uppercase tracking-wide border border-[var(--accent)] text-[var(--accent)] rounded px-2.5 py-1.5 hover:bg-[var(--accent)]/10 disabled:opacity-50"
                    >
                      + Add station
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {modules.length > 0 && (
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <input
            value={newModuleName}
            onChange={(e) => setNewModuleName(e.target.value)}
            placeholder="New module name…"
            className="border border-[var(--line)] rounded px-2.5 py-1.5 text-sm bg-white flex-1 min-w-[200px]"
          />
          <button
            onClick={handleAddModule}
            disabled={addingModule || !newModuleName.trim()}
            className="text-xs font-mono uppercase tracking-wide bg-[var(--accent)] text-white rounded px-3 py-2 hover:opacity-90 disabled:opacity-50"
          >
            {addingModule ? "Adding…" : "+ Add module"}
          </button>
        </div>
      )}
    </main>
  );
}
