"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Task } from "@/lib/types";
import { useProjectId } from "@/lib/useProjectId";
import UpdateAnalyzer from "./UpdateAnalyzer";
import {
  computeStatus,
  daysBehind,
  summarize,
  overallProgress,
  STATUS_LABEL,
  STATUS_COLOR,
} from "@/lib/schedule";

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

interface RiskDigestItem {
  task_id: number;
  signal: string;
  severity: "high" | "medium";
}

interface RiskDigestUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

export default function Dashboard() {
  const projectId = useProjectId();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const [riskDigest, setRiskDigest] = useState<RiskDigestItem[] | null>(null);
  const [riskDigestGeneratedAt, setRiskDigestGeneratedAt] = useState<string | null>(null);
  const [riskDigestUsage, setRiskDigestUsage] = useState<RiskDigestUsage | null>(null);
  const [riskDigestLoading, setRiskDigestLoading] = useState(false);
  const [riskDigestError, setRiskDigestError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    const { data: taskData } = await supabase
      .from("tasks")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .order("id", { ascending: true });
    setTasks((taskData as Task[]) || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Loads whatever was cached by a previous "Refresh" click (by anyone on
  // the project, not just you) -- never calls Claude on its own. Phase 1 of
  // the AI layer is manually triggered on purpose, so this page load never
  // spends a token by itself.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("ai_risk_digests")
        .select("content, generated_at, input_tokens, output_tokens, estimated_cost_usd")
        .eq("project_id", projectId)
        .maybeSingle();
      if (data) {
        setRiskDigest(data.content as RiskDigestItem[]);
        setRiskDigestGeneratedAt(data.generated_at as string);
        setRiskDigestUsage(
          data.input_tokens != null
            ? {
                inputTokens: data.input_tokens as number,
                outputTokens: data.output_tokens as number,
                estimatedCostUsd: data.estimated_cost_usd as number | null,
              }
            : null
        );
      } else {
        setRiskDigest(null);
        setRiskDigestGeneratedAt(null);
        setRiskDigestUsage(null);
      }
    })();
  }, [projectId]);

  async function refreshRiskDigest() {
    setRiskDigestLoading(true);
    setRiskDigestError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setRiskDigestError("Your session expired -- please sign in again.");
      setRiskDigestLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/ai/risk-digest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ project_id: projectId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setRiskDigestError(data.error || "Couldn't generate a risk digest.");
      } else {
        setRiskDigest(data.digest as RiskDigestItem[]);
        setRiskDigestGeneratedAt(data.generated_at as string);
        setRiskDigestUsage({
          inputTokens: data.input_tokens as number,
          outputTokens: data.output_tokens as number,
          estimatedCostUsd: data.estimated_cost_usd as number | null,
        });
      }
    } catch {
      setRiskDigestError("Couldn't reach the server -- check your connection and try again.");
    }
    setRiskDigestLoading(false);
  }

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

      {/* Risk digest -- AI layer, phase 1. Manually triggered, internal only. */}
      <div className="border border-[var(--line)] rounded-lg p-5 bg-white/60 mt-6">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="font-medium">Risk digest</h2>
          <button
            onClick={refreshRiskDigest}
            disabled={riskDigestLoading}
            className="text-xs bg-[var(--accent)] text-white rounded px-3 py-1.5 font-medium disabled:opacity-50 shrink-0"
          >
            {riskDigestLoading ? "Scanning\u2026" : "Refresh risk digest"}
          </button>
        </div>
        <p className="text-xs text-[var(--ink)]/40 mb-4">
          Scans status notes for risk signals in the prose — blockers, open questions, tight deadlines — that the on-track/at-risk/delayed tags above don't catch, since those only look at dates. AI-generated, so treat it as a prompt to go check, not a verdict.
        </p>
        {riskDigestError && (
          <div className="mb-3 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
            {riskDigestError}
          </div>
        )}
        {riskDigest === null ? (
          <p className="text-sm text-[var(--ink)]/50">Not checked yet — click “Refresh risk digest” to scan current status notes.</p>
        ) : riskDigest.length === 0 ? (
          <p className="text-sm text-[var(--ink)]/50">
            No risk signals found in status notes.
            {riskDigestGeneratedAt && ` Checked ${timeAgo(riskDigestGeneratedAt)}.`}
          </p>
        ) : (
          <div className="space-y-3">
            {riskDigest.map((item, i) => {
              const task = tasks.find((t) => t.id === item.task_id);
              const color = item.severity === "high" ? "var(--rust)" : "var(--amber)";
              return (
                <div key={i} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{task?.description || `Task #${item.task_id}`}</p>
                    <p className="text-xs text-[var(--ink)]/60 mt-0.5">{item.signal}</p>
                  </div>
                  <span
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border shrink-0"
                    style={{ color, borderColor: color + "55", backgroundColor: color + "12" }}
                  >
                    {item.severity === "high" ? "High" : "Medium"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {riskDigestGeneratedAt && riskDigestUsage && (
          <p className="text-xs text-[var(--ink)]/40 font-mono-num pt-3 mt-3 border-t border-[var(--line)]">
            Checked {timeAgo(riskDigestGeneratedAt)} · {(riskDigestUsage.inputTokens + riskDigestUsage.outputTokens).toLocaleString()} tokens
            {" "}({riskDigestUsage.inputTokens.toLocaleString()} in / {riskDigestUsage.outputTokens.toLocaleString()} out)
            {riskDigestUsage.estimatedCostUsd != null &&
              ` · ~$${riskDigestUsage.estimatedCostUsd < 0.01 ? riskDigestUsage.estimatedCostUsd.toFixed(4) : riskDigestUsage.estimatedCostUsd.toFixed(2)}`}
          </p>
        )}
      </div>

      {/* Post an update -- AI layer, phase 2. Drafts changes for review;
          refreshing tasks here so an Applied suggestion shows up in the
          stats above immediately rather than needing a manual reload. */}
      <UpdateAnalyzer projectId={projectId} onApplied={loadTasks} />

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
