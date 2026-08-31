"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import "../../frappe-gantt.css";
import { supabase } from "@/lib/supabase";
import { Task, DEPARTMENTS } from "@/lib/types";
import { useProjectId, withProject } from "@/lib/useProjectId";
import { computeStatus, STATUS_COLOR } from "@/lib/schedule";
import { cascadeSchedule } from "@/lib/cascade";

// Flat, distinct colors per department -- this is what gives each category
// its own identity in the chart. Status (on_track/at_risk/etc.) is layered
// on top as the bar's outline color, so both are visible on the same bar.
const DEPARTMENT_COLOR: Record<string, string> = {
  "Project Management": "#6366f1",
  Mechanical: "#f59e0b",
  Electrical: "#3b82f6",
  "Software/Controls": "#8b5cf6",
  Procurement: "#06b6d4",
  Manufacturing: "#f43f5e",
  Assembly: "#84cc16",
  "Debug & Test": "#d946ef",
  QA: "#eab308",
  Logistics: "#0ea5e9",
  Documentation: "#64748b",
  Installation: "#14b8a6",
};
const DEFAULT_DEPT_COLOR = "#6b7280";

function deptColor(department: string): string {
  return DEPARTMENT_COLOR[department] ?? DEFAULT_DEPT_COLOR;
}

function deptClass(department: string): string {
  return (
    "dept-" +
    department
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
  );
}

export default function GanttView() {
  const projectId = useProjectId();
  // Full hierarchy now -- summaries included -- so groups can be built and
  // collapsed/expanded. (Previously this only loaded leaf tasks.)
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Which group (summary) task IDs are currently expanded. Empty = everything
  // collapsed to its top-level phase, which is what keeps the chart short.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<any>(null);
  const tasksRef = useRef<Task[]>([]); // always-current copy for callbacks/popup
  // Remembers the horizontal scroll position across chart rebuilds, so an
  // edit doesn't snap the view back to today. null = first render, let the
  // chart do its default scroll-to-today.
  const scrollPosRef = useRef<number | null>(null);

  function getScrollEl(): HTMLElement | null {
    return (
      (containerRef.current?.querySelector(".gantt-container") as HTMLElement) ||
      containerRef.current
    );
  }

  async function loadTasks() {
    setLoading(true);
    setError(null);
    scrollPosRef.current = null; // fresh project load → default scroll-to-today
    const { data, error: err } = await supabase
      .from("tasks")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .order("id", { ascending: true });
    if (err) {
      setError(err.message);
    } else {
      setAllTasks((data as Task[]) || []);
      setExpanded(new Set()); // fresh project load → start fully collapsed
    }
    setLoading(false);
  }

  useEffect(() => {
    loadTasks();
  }, [projectId]);

  useEffect(() => {
    tasksRef.current = allTasks;
  }, [allTasks]);

  const today = useMemo(() => new Date(), []);

  // parent_id -> its direct children, built once per task-list change.
  const childrenByParent = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const t of allTasks) {
      if (t.parent_id != null) {
        if (!map.has(t.parent_id)) map.set(t.parent_id, []);
        map.get(t.parent_id)!.push(t);
      }
    }
    return map;
  }, [allTasks]);

  const topLevel = useMemo(
    () => allTasks.filter((t) => t.parent_id == null),
    [allTasks]
  );

  // Depth-first flatten of whatever's currently expanded. This is what
  // actually gets rendered -- collapsed groups just don't contribute rows.
  const visibleTasks = useMemo(() => {
    const rows: { task: Task; depth: number }[] = [];
    function walk(task: Task, depth: number) {
      rows.push({ task, depth });
      const kids = childrenByParent.get(task.id);
      if (kids && expanded.has(task.id)) {
        for (const k of kids) walk(k, depth + 1);
      }
    }
    for (const t of topLevel) walk(t, 0);
    return rows;
  }, [topLevel, childrenByParent, expanded]);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function persistCascade(changedTaskId: number, patch: Partial<Task>) {
    // Capture where the user is looking before the chart rebuilds, so we can
    // put them right back instead of jumping to today.
    const scrollEl = getScrollEl();
    if (scrollEl) scrollPosRef.current = scrollEl.scrollLeft;

    setSaving(true);
    setError(null);

    const updatedTasks = tasksRef.current.map((t) =>
      t.id === changedTaskId ? { ...t, ...patch } : t
    );
    const cascaded = cascadeSchedule(updatedTasks, changedTaskId);

    const { error: err1 } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", changedTaskId);

    for (const u of cascaded) {
      const { error: err2 } = await supabase
        .from("tasks")
        .update({
          scheduled_start: u.scheduled_start,
          scheduled_finish: u.scheduled_finish,
        })
        .eq("id", u.id);
      if (err2) setError(err2.message);
    }
    if (err1) setError(err1.message);

    const cascadedById = new Map(cascaded.map((u) => [u.id, u]));
    setAllTasks((prev) =>
      prev.map((t) => {
        if (t.id === changedTaskId) return { ...t, ...patch };
        const c = cascadedById.get(t.id);
        return c ? { ...t, ...c } : t;
      })
    );
    setSaving(false);
  }

  // A signature that changes whenever any schedule-relevant field changes or
  // the expand/collapse state changes, so the chart rebuilds after edits made
  // from the popup or a group toggle -- not just when the task count changes
  // (drag updates render fine on their own since frappe-gantt owns that
  // interaction directly).
  const ganttSignature = useMemo(
    () =>
      visibleTasks
        .map(({ task: t }) => [
          t.id,
          t.scheduled_start,
          t.scheduled_finish,
          t.percent_complete,
          t.predecessor_id,
          t.status_note,
        ])
        .flat()
        .join("|") +
      "::" +
      Array.from(expanded).sort().join(","),
    [visibleTasks, expanded]
  );

  useEffect(() => {
    if (!containerRef.current || visibleTasks.length === 0) return;

    let cancelled = false;

    import("frappe-gantt").then((mod) => {
      if (cancelled) return;
      const Gantt = mod.default;

      const ganttTasks = visibleTasks.map(({ task: t, depth }) => {
        const kids = childrenByParent.get(t.id);
        const isGroup = !!kids && kids.length > 0;
        const status = computeStatus(t, today);
        const indent = depth > 0 ? "—".repeat(depth) + " " : "";
        const marker = isGroup ? (expanded.has(t.id) ? "▾ " : "▸ ") : "";
        const countSuffix = isGroup ? ` (${kids!.length})` : "";
        return {
          id: String(t.id),
          name: `${indent}${marker}${t.description}${countSuffix}`,
          start: t.scheduled_start,
          end: t.scheduled_finish,
          progress: t.percent_complete,
          // Group bars don't draw dependency arrows -- those show once you
          // expand into the leaf tasks that actually carry them.
          dependencies: !isGroup && t.predecessor_id ? String(t.predecessor_id) : "",
          // frappe-gantt does `classList.add(custom_class)` internally,
          // which throws on a space-separated string (DOMTokenList.add()
          // only accepts single tokens). Pass just the department class
          // here; the status and group-row classes are added manually
          // right after construction, below.
          custom_class: deptClass(t.department),
        };
      });

      containerRef.current!.innerHTML = "";
      ganttRef.current = new Gantt(containerRef.current!, ganttTasks, {
        view_mode: "Month",
        // frappe-gantt silently forces the default view to whichever mode
        // is FIRST in this array, overriding view_mode above -- so Month
        // has to be listed first for the explicit default to actually win.
        view_modes: ["Month", "Week"],
        view_mode_select: true,
        today_button: true,
        readonly_progress: false,
        // Compact monday.com-style sizing (defaults: bar 30, padding 18,
        // headers 45/30, week column 140).
        bar_height: 16,
        padding: 10,
        bar_corner_radius: 4,
        upper_header_height: 34,
        lower_header_height: 26,
        column_width: 80,
        // Fixed date range instead of frappe-gantt's default dynamic
        // extend-on-scroll behavior. That default re-renders the whole grid
        // mid-scroll to stretch the range, which is what was causing the
        // "date jumps and won't go back" bug -- with a fixed range there's
        // nothing to jump.
        infinite_padding: false,
        on_date_change: (task: any, start: Date, end: Date) => {
          const id = Number(task.id);
          if (childrenByParent.has(id)) return; // group bars aren't directly editable
          persistCascade(id, {
            scheduled_start: start.toISOString().slice(0, 10),
            scheduled_finish: end.toISOString().slice(0, 10),
          });
        },
        on_progress_change: (task: any, progress: number) => {
          const id = Number(task.id);
          if (childrenByParent.has(id)) return; // group bars aren't directly editable
          persistCascade(id, { percent_complete: Math.round(progress) });
        },
        popup_on: "click",
        popup: (ctx: any) => {
          const id = Number(ctx.task.id);

          // Clicking a group row toggles it instead of opening the edit form.
          if (childrenByParent.has(id)) {
            toggleExpand(id);
            return false;
          }

          const current = tasksRef.current.find((t) => t.id === id);
          if (!current) return false;

          ctx.set_title(current.description);
          ctx.set_subtitle(current.department);
          ctx.set_details(`
            <div style="display:flex; flex-direction:column; gap:8px; min-width:220px; margin-top:6px;">
              <label style="font-size:11px; color:#7c7c7c;">Scheduled start
                <input type="date" class="popup-start" value="${current.scheduled_start}"
                  style="display:block; width:100%; padding:4px 6px; border:1px solid #ddd; border-radius:4px; margin-top:2px;" />
              </label>
              <label style="font-size:11px; color:#7c7c7c;">Scheduled finish
                <input type="date" class="popup-finish" value="${current.scheduled_finish}"
                  style="display:block; width:100%; padding:4px 6px; border:1px solid #ddd; border-radius:4px; margin-top:2px;" />
              </label>
              <label style="font-size:11px; color:#7c7c7c;">% complete
                <input type="number" min="0" max="100" class="popup-percent" value="${current.percent_complete}"
                  style="display:block; width:100%; padding:4px 6px; border:1px solid #ddd; border-radius:4px; margin-top:2px;" />
              </label>
              <label style="font-size:11px; color:#7c7c7c;">Note
                <textarea class="popup-notes" rows="2"
                  style="display:block; width:100%; padding:4px 6px; border:1px solid #ddd; border-radius:4px; margin-top:2px; font-family:inherit;">${current.status_note ?? ""}</textarea>
              </label>
            </div>
          `);

          ctx.add_action("Save", (clickedTask: any, gantt: any) => {
            const details = ctx.get_details();
            const start = details.querySelector(".popup-start").value;
            const finish = details.querySelector(".popup-finish").value;
            const percent = Number(details.querySelector(".popup-percent").value);
            const notes = details.querySelector(".popup-notes").value;
            persistCascade(Number(clickedTask.id), {
              scheduled_start: start,
              scheduled_finish: finish,
              percent_complete: percent,
              status_note: notes || null,
            });
            gantt.hide_popup();
          });

          return undefined;
        },
      });

      // Add the status and group-row classes to each bar now that it
      // exists in the DOM (can't pass them via custom_class -- see note
      // above). classList.add() takes multiple token arguments fine, it
      // just can't take one space-separated string.
      for (const { task: t } of visibleTasks) {
        const kids = childrenByParent.get(t.id);
        const isGroup = !!kids && kids.length > 0;
        const status = computeStatus(t, today);
        const el = containerRef.current?.querySelector(
          `.bar-wrapper[data-id="${t.id}"]`
        );
        if (el) {
          el.classList.add(`status-${status}`);
          if (isGroup) el.classList.add("group-row");
        }
      }

      // Center the vertical "today" line in the viewport, instead of
      // frappe-gantt's default of aligning it near the left edge.
      function centerOnToday() {
        const el = getScrollEl();
        const line = containerRef.current?.querySelector(
          ".current-highlight"
        ) as HTMLElement | null;
        if (!el || !line) return;
        const lineLeft = parseFloat(line.style.left || "0");
        el.scrollTo({
          left: lineLeft - el.clientWidth / 2,
          behavior: "smooth",
        });
      }

      // The built-in "Today" button scrolls today to the left edge by
      // default -- point it at our centering logic instead.
      if (ganttRef.current?.$today_button) {
        ganttRef.current.$today_button.onclick = centerOnToday;
      }

      // Restore the scroll position from before the rebuild (an edit was
      // made), or -- on a fresh load -- center on today instead of leaving
      // frappe-gantt's initial left-aligned scroll in place.
      if (scrollPosRef.current != null) {
        const target = scrollPosRef.current;
        requestAnimationFrame(() => {
          const el = getScrollEl();
          if (el) el.scrollLeft = target;
        });
      } else {
        requestAnimationFrame(() => requestAnimationFrame(centerOnToday));
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ganttSignature, loading]);

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
          <h1 className="text-2xl font-semibold mt-1">Gantt Timeline</h1>
          <p className="text-sm text-[var(--ink)]/60">
            <strong>Click a bold group row</strong> to expand or collapse it.
            On a leaf task: drag a bar to shift dates, drag the fill to update
            % complete, or <strong>click</strong> to edit dates, % complete,
            and notes directly. Downstream tasks shift automatically.{" "}
            <Link href={withProject("/internal/tasks", projectId)} className="underline hover:text-[var(--accent)]">
              View as table &rarr;
            </Link>
          </p>
        </div>
        {saving && <span className="text-xs text-[var(--ink)]/50">Saving…</span>}
      </div>

      {error && (
        <div className="mb-4 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="mb-4 space-y-2">
        <div className="flex items-center flex-wrap gap-4 text-xs">
          <span className="text-[var(--ink)]/40 uppercase tracking-wide font-mono text-[10px]">
            Status (outline)
          </span>
          {Object.entries(STATUS_COLOR).map(([status, color]) => (
            <span key={status} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-sm inline-block border-2"
                style={{ borderColor: color, backgroundColor: "transparent" }}
              />
              <span className="capitalize text-[var(--ink)]/60">
                {status.replace("_", " ")}
              </span>
            </span>
          ))}
        </div>
        <div className="flex items-center flex-wrap gap-3 text-xs">
          <span className="text-[var(--ink)]/40 uppercase tracking-wide font-mono text-[10px]">
            Department (fill)
          </span>
          {DEPARTMENTS.map((dept) => (
            <span key={dept} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-sm inline-block"
                style={{ backgroundColor: deptColor(dept) }}
              />
              <span className="text-[var(--ink)]/60">{dept}</span>
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ink)]/50">Loading…</p>
      ) : (
        <div className="border border-[var(--line)] rounded-lg bg-white/60 overflow-x-auto">
          <div ref={containerRef} />
        </div>
      )}

      <style jsx global>{`
        /* Department fill (the bar's base color + its progress fill) */
        .gantt .bar-wrapper.dept-project-management .bar {
          fill: #6366f133;
        }
        .gantt .bar-wrapper.dept-project-management .bar-progress {
          fill: #6366f1;
        }
        .gantt .bar-wrapper.dept-mechanical .bar {
          fill: #f59e0b33;
        }
        .gantt .bar-wrapper.dept-mechanical .bar-progress {
          fill: #f59e0b;
        }
        .gantt .bar-wrapper.dept-electrical .bar {
          fill: #3b82f633;
        }
        .gantt .bar-wrapper.dept-electrical .bar-progress {
          fill: #3b82f6;
        }
        .gantt .bar-wrapper.dept-software-controls .bar {
          fill: #8b5cf633;
        }
        .gantt .bar-wrapper.dept-software-controls .bar-progress {
          fill: #8b5cf6;
        }
        .gantt .bar-wrapper.dept-procurement .bar {
          fill: #06b6d433;
        }
        .gantt .bar-wrapper.dept-procurement .bar-progress {
          fill: #06b6d4;
        }
        .gantt .bar-wrapper.dept-manufacturing .bar {
          fill: #f43f5e33;
        }
        .gantt .bar-wrapper.dept-manufacturing .bar-progress {
          fill: #f43f5e;
        }
        .gantt .bar-wrapper.dept-assembly .bar {
          fill: #84cc1633;
        }
        .gantt .bar-wrapper.dept-assembly .bar-progress {
          fill: #84cc16;
        }
        .gantt .bar-wrapper.dept-debug-test .bar {
          fill: #d946ef33;
        }
        .gantt .bar-wrapper.dept-debug-test .bar-progress {
          fill: #d946ef;
        }
        .gantt .bar-wrapper.dept-qa .bar {
          fill: #eab30833;
        }
        .gantt .bar-wrapper.dept-qa .bar-progress {
          fill: #eab308;
        }
        .gantt .bar-wrapper.dept-logistics .bar {
          fill: #0ea5e933;
        }
        .gantt .bar-wrapper.dept-logistics .bar-progress {
          fill: #0ea5e9;
        }
        .gantt .bar-wrapper.dept-documentation .bar {
          fill: #64748b33;
        }
        .gantt .bar-wrapper.dept-documentation .bar-progress {
          fill: #64748b;
        }
        .gantt .bar-wrapper.dept-installation .bar {
          fill: #14b8a633;
        }
        .gantt .bar-wrapper.dept-installation .bar-progress {
          fill: #14b8a6;
        }

        /* Status overrides only the outline, so risk/delay still reads at a
           glance without hiding which department a bar belongs to. */
        .gantt .bar-wrapper.status-on_track .bar {
          stroke: #2f6f4f;
          stroke-width: 1.5px;
        }
        .gantt .bar-wrapper.status-at_risk .bar {
          stroke: #b7791f;
          stroke-width: 2px;
        }
        .gantt .bar-wrapper.status-delayed .bar {
          stroke: #a13d2f;
          stroke-width: 2px;
        }
        .gantt .bar-wrapper.status-completed .bar {
          stroke: #3a5a8c;
          stroke-width: 1.5px;
        }
        .gantt .bar-wrapper.status-not_started .bar {
          stroke: #8a8578;
          stroke-width: 1px;
        }

        /* Collapsible group rows -- bold label + pointer cursor so it's
           obvious they're clickable, distinct from an editable leaf task. */
        .gantt .bar-wrapper.group-row {
          cursor: pointer;
        }
        .gantt .bar-wrapper.group-row .bar-label {
          font-weight: 700;
        }

        .gantt .popup-wrapper .action-btn {
          background-color: var(--accent, #2f6f4f) !important;
          color: white !important;
        }
        /* Compact monday.com-style type sizes */
        .gantt .bar-label {
          font-size: 10px;
        }
        .gantt .lower-text {
          font-size: 10px;
        }
        .gantt .upper-text {
          font-size: 11px;
        }
        .gantt-container .current-date-highlight,
        .gantt-container .current-upper {
          font-size: 10px;
        }
      `}</style>
    </main>
  );
}
