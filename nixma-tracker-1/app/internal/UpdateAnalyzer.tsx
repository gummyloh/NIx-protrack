"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

interface Suggestion {
  target_type: "task" | "punch_item";
  target_id: number;
  target_label: string;
  current_percent_complete: number;
  current_note: string | null;
  proposed_percent_complete: number | null;
  note_addition: string | null;
  reasoning: string;
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

// AI layer, phase 2. Paste a raw update, Claude (Sonnet -- see
// /api/ai/analyze-update for why) drafts proposed task/punch item changes.
// Every suggestion is editable and nothing writes to the database until
// Apply is clicked on that specific one -- same review-before-write pattern
// as the risk digest, just with an actual write on the other side of the
// review this time.
export default function UpdateAnalyzer({
  projectId,
  onApplied,
}: {
  projectId: string;
  onApplied?: () => void;
}) {
  const [text, setText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [unaddressed, setUnaddressed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  const [drafts, setDrafts] = useState<Record<string, { percent: string; note: string }>>({});
  const [resolved, setResolved] = useState<Record<string, "applied" | "dismissed">>({});
  const [applyingKey, setApplyingKey] = useState<string | null>(null);

  function keyOf(s: Suggestion) {
    return `${s.target_type}-${s.target_id}`;
  }

  async function analyze() {
    if (!text.trim()) return;
    setAnalyzing(true);
    setError(null);
    setSuggestions(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError("Your session expired -- please sign in again.");
      setAnalyzing(false);
      return;
    }
    try {
      const res = await fetch("/api/ai/analyze-update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ project_id: projectId, update_text: text }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Couldn't analyze that update.");
        setAnalyzing(false);
        return;
      }
      const list = data.suggestions as Suggestion[];
      setSuggestions(list);
      setUnaddressed(data.unaddressed_items || []);
      setUsage({
        inputTokens: data.input_tokens,
        outputTokens: data.output_tokens,
        estimatedCostUsd: data.estimated_cost_usd,
      });
      const seeded: Record<string, { percent: string; note: string }> = {};
      for (const s of list) {
        seeded[keyOf(s)] = {
          percent: s.proposed_percent_complete != null ? String(s.proposed_percent_complete) : "",
          note: s.note_addition || "",
        };
      }
      setDrafts(seeded);
      setResolved({});
    } catch {
      setError("Couldn't reach the server -- check your connection and try again.");
    }
    setAnalyzing(false);
  }

  async function apply(s: Suggestion) {
    const k = keyOf(s);
    setApplyingKey(k);
    setError(null);
    const draft = drafts[k] || { percent: "", note: "" };
    const changes: Record<string, unknown> = {};
    if (draft.percent.trim() !== "") {
      const n = Number(draft.percent);
      if (!Number.isNaN(n)) changes.percent_complete = Math.max(0, Math.min(100, Math.round(n)));
    }
    if (draft.note.trim()) {
      const noteField = s.target_type === "task" ? "status_note" : "remarks";
      changes[noteField] = s.current_note ? `${s.current_note} | ${draft.note.trim()}` : draft.note.trim();
    }
    if (Object.keys(changes).length > 0) {
      const table = s.target_type === "task" ? "tasks" : "punch_items";
      const { error: err } = await supabase.from(table).update(changes).eq("id", s.target_id);
      if (err) {
        setError(err.message);
        setApplyingKey(null);
        return;
      }
    }
    setResolved((prev) => ({ ...prev, [k]: "applied" }));
    setApplyingKey(null);
    onApplied?.();
  }

  function dismiss(s: Suggestion) {
    setResolved((prev) => ({ ...prev, [keyOf(s)]: "dismissed" }));
  }

  return (
    <div className="border border-[var(--line)] rounded-lg p-5 bg-white/60 mt-6">
      <h2 className="font-medium mb-1">Post an update</h2>
      <p className="text-xs text-[var(--ink)]/40 mb-3">
        Paste a raw update -- what happened today, what you found -- and Claude drafts
        proposed task and punch item changes. Edit anything that looks off, then click
        Apply on each one you want -- nothing writes anywhere until you do.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="e.g. Today we built the POC for the mandrel and tested gripper force, but found the mandrel is damaging the pouch..."
        className="w-full border border-[var(--line)] rounded px-3 py-2 text-sm bg-white mb-2"
      />
      <button
        onClick={analyze}
        disabled={!text.trim() || analyzing}
        className="text-sm bg-[var(--accent)] text-white rounded px-3 py-1.5 font-medium disabled:opacity-50"
      >
        {analyzing ? "Analyzing…" : "Analyze update"}
      </button>

      {error && (
        <div className="mt-3 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      {suggestions !== null && (
        <div className="mt-4 space-y-3">
          {suggestions.length === 0 && unaddressed.length === 0 && (
            <p className="text-sm text-[var(--ink)]/50">
              Nothing in that update matched a tracked task or punch item.
            </p>
          )}
          {suggestions.map((s) => {
            const k = keyOf(s);
            const state = resolved[k];
            const draft = drafts[k] || { percent: "", note: "" };
            return (
              <div
                key={k}
                className={`border rounded-lg p-3 ${
                  state === "applied"
                    ? "border-[var(--accent)]/30 bg-[var(--accent)]/5"
                    : state === "dismissed"
                      ? "border-[var(--line)] bg-[var(--ink)]/[0.02] opacity-50"
                      : "border-[var(--line)] bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <p className="font-medium text-sm">
                    {s.target_label}
                    <span className="ml-2 text-[10px] font-mono uppercase text-[var(--ink)]/40">
                      {s.target_type === "task" ? "Task" : "Punch item"}
                    </span>
                  </p>
                  {state === "applied" && (
                    <span className="text-xs text-[var(--accent)] font-medium shrink-0">Applied</span>
                  )}
                  {state === "dismissed" && (
                    <span className="text-xs text-[var(--ink)]/40 shrink-0">Dismissed</span>
                  )}
                </div>
                <p className="text-xs text-[var(--ink)]/60 mb-2">{s.reasoning}</p>
                {!state && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-[var(--ink)]/50 shrink-0">
                        % complete ({s.current_percent_complete}% now):
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={draft.percent}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [k]: { ...prev[k], percent: e.target.value } }))
                        }
                        placeholder="no change"
                        className="border border-[var(--line)] rounded px-2 py-1 text-xs w-24 bg-white"
                      />
                    </div>
                    <textarea
                      value={draft.note}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [k]: { ...prev[k], note: e.target.value } }))
                      }
                      rows={2}
                      className="w-full border border-[var(--line)] rounded px-2 py-1.5 text-xs bg-white"
                      placeholder="Note to append (edit or clear as needed)"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => apply(s)}
                        disabled={applyingKey === k}
                        className="text-xs bg-[var(--accent)] text-white rounded px-3 py-1 font-medium disabled:opacity-50"
                      >
                        {applyingKey === k ? "Applying…" : "Apply"}
                      </button>
                      <button
                        onClick={() => dismiss(s)}
                        className="text-xs underline text-[var(--ink)]/40 hover:text-[var(--rust)]"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {unaddressed.length > 0 && (
            <div className="border border-[var(--amber)]/30 bg-[var(--amber)]/5 rounded-lg p-3">
              <p className="text-xs font-medium text-[var(--amber)] mb-1">Not tracked anywhere yet</p>
              <ul className="text-xs text-[var(--ink)]/60 list-disc pl-4 space-y-0.5">
                {unaddressed.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {usage && (
        <p className="text-xs text-[var(--ink)]/40 font-mono-num pt-3 mt-3 border-t border-[var(--line)]">
          {(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens (
          {usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out)
          {usage.estimatedCostUsd != null &&
            ` · ~$${usage.estimatedCostUsd < 0.01 ? usage.estimatedCostUsd.toFixed(4) : usage.estimatedCostUsd.toFixed(2)}`}
        </p>
      )}
    </div>
  );
}
