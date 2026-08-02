"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import "../../frappe-gantt.css";
import { supabase } from "@/lib/supabase";
import { Task } from "@/lib/types";
import { useProjectId, withProject } from "@/lib/useProjectId";
import { computeStatus, STATUS_COLOR } from "@/lib/schedule";
import { cascadeSchedule } from "@/lib/cascade";

export default function GanttView() {
  const projectId = useProjectId();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<any>(null);
  const tasksRef = useRef<Task[]>([]); // always-current copy for callbacks/popup

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

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const today = useMemo(() => new Date(), []);

  async function persistCascade(changedTaskId: number, patch: Partial<Task>) {
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
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === changedTaskId) return { ...t, ...patch };
        const c = cascadedById.get(t.id);
        return c ? { ...t, ...c } : t;
      })
    );
    setSaving(false);
  }

  // A signature that changes whenever any schedule-relevant field changes,
  // so the chart rebuilds after edits made from the popup -- not just when
  // the task count changes (drag updates render fine on their own since
  // frappe-gantt owns that interaction directly).
  const ganttSignature = useMemo(
    () =>
      tasks
        .map((t) => [
          t.id,
          t.scheduled_start,
          t.scheduled_finish,
          t.percent_complete,
          t.predecessor_id,
          t.status_note,
        ])
        .flat()
        .join("|"),
    [tasks]
  );

  useEffect(() => {
    if (!containerRef.current || tasks.length === 0) return;

    let cancelled = false;

    import("frappe-gantt").then((mod) => {
      if (cancelled) return;
      const Gantt = mod.default;

      const ganttTasks = tasks.map((t) => {
        const status = computeStatus(t, today);
        return {
          id: String(t.id),
          name: `${t.description} (${t.department})`,
          start: t.scheduled_start,
          end: t.scheduled_finish,
          progress: t.percent_complete,
          dependencies: t.predecessor_id ? String(t.predecessor_id) : "",
          custom_class: `status-${status}`,
        };
      });

      containerRef.current!.innerHTML = "";
      ganttRef.current = new Gantt(containerRef.current!, ganttTasks, {
        view_mode: "Week",
        view_modes: ["Day", "Week", "Month"],
        view_mode_select: true,
        today_button: true,
        readonly_progress: false,
        on_date_change: (task: any, start: Date, end: Date) => {
          persistCascade(Number(task.id), {
            scheduled_start: start.toISOString().slice(0, 10),
            scheduled_finish: end.toISOString().slice(0, 10),
          });
        },
        on_progress_change: (task: any, progress: number) => {
          persistCascade(Number(task.id), { percent_complete: Math.round(progress) });
        },
        popup_on: "click",
        popup: (ctx: any) => {
          const current = tasksRef.current.find((t) => String(t.id) === ctx.task.id);
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
            Drag a bar to shift dates, drag the fill to update % complete, or{" "}
            <strong>click a bar</strong> to edit dates, % complete, and notes
            directly. Downstream tasks shift automatically.{" "}
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

      <div className="flex items-center gap-4 mb-4 text-xs">
        {Object.entries(STATUS_COLOR).map(([status, color]) => (
          <span key={status} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm inline-block"
              style={{ backgroundColor: color }}
            />
            <span className="capitalize text-[var(--ink)]/60">
              {status.replace("_", " ")}
            </span>
          </span>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ink)]/50">Loading…</p>
      ) : (
        <div className="border border-[var(--line)] rounded-lg bg-white/60 overflow-x-auto">
          <div ref={containerRef} />
        </div>
      )}

      <style jsx global>{`
        .gantt .bar-wrapper.status-on_track .bar-progress {
          fill: #2f6f4f;
        }
        .gantt .bar-wrapper.status-on_track .bar {
          fill: #2f6f4f22;
          stroke: #2f6f4f;
        }
        .gantt .bar-wrapper.status-at_risk .bar-progress {
          fill: #b7791f;
        }
        .gantt .bar-wrapper.status-at_risk .bar {
          fill: #b7791f22;
          stroke: #b7791f;
        }
        .gantt .bar-wrapper.status-delayed .bar-progress {
          fill: #a13d2f;
        }
        .gantt .bar-wrapper.status-delayed .bar {
          fill: #a13d2f22;
          stroke: #a13d2f;
        }
        .gantt .bar-wrapper.status-completed .bar-progress {
          fill: #3a5a8c;
        }
        .gantt .bar-wrapper.status-completed .bar {
          fill: #3a5a8c22;
          stroke: #3a5a8c;
        }
        .gantt .bar-wrapper.status-not_started .bar-progress {
          fill: #8a8578;
        }
        .gantt .bar-wrapper.status-not_started .bar {
          fill: #8a857822;
          stroke: #8a8578;
        }
        .gantt .popup-wrapper .action-btn {
          background-color: var(--accent, #2f6f4f) !important;
          color: white !important;
        }
      `}</style>
    </main>
  );
}
