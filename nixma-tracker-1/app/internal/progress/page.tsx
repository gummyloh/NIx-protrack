"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useProjectId } from "@/lib/useProjectId";
import { ProgressNode } from "@/lib/types";
import { buildProgressTree, disciplinesIn } from "@/lib/progressRollup";
import ProgressTree from "./ProgressTree";

/**
 * Fact-checked, per-discipline progress -- deliberately separate from
 * Module Rollup (physical assembly readiness) and from task-level
 * percent_complete (one person's estimate on a task that might span a
 * whole design phase). Each discipline gets its own tree, shaped however
 * that team actually organizes its own work -- no fixed depth, no imposed
 * numbering. A percentage is only ever entered at a leaf; everything
 * above it is a computed average (see lib/progressRollup.ts).
 */
export default function ProgressPage() {
  const projectId = useProjectId();
  const [nodes, setNodes] = useState<ProgressNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDiscipline, setSelectedDiscipline] = useState<string | null>(null);
  const [addingDiscipline, setAddingDiscipline] = useState(false);
  const [newDisciplineName, setNewDisciplineName] = useState("");
  const [newRootName, setNewRootName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("progress_nodes")
      .select("*")
      .eq("project_id", projectId)
      .order("sequence", { ascending: true });
    if (err) setError(err.message);
    const rows = (data as ProgressNode[]) || [];
    setNodes(rows);
    setLoading(false);
    setSelectedDiscipline((prev) => prev ?? disciplinesIn(rows)[0] ?? null);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function currentUserId(): Promise<string | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError("Your session expired -- please sign in again.");
      return null;
    }
    return session.user.id;
  }

  async function addNode(parentId: number | null, discipline: string, name: string) {
    const userId = await currentUserId();
    if (!userId) return;
    const siblingCount = nodes.filter(
      (n) => n.parent_id === parentId && n.discipline === discipline
    ).length;
    const { error: err } = await supabase.from("progress_nodes").insert({
      project_id: projectId,
      discipline,
      parent_id: parentId,
      name,
      sequence: siblingCount,
      updated_by: userId,
    });
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function renameNode(id: number, name: string) {
    const { error: err } = await supabase.from("progress_nodes").update({ name }).eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function setPercent(id: number, percent: number, confirmedBy: string) {
    const userId = await currentUserId();
    if (!userId) return;
    const { error: err } = await supabase
      .from("progress_nodes")
      .update({
        percent_complete: percent,
        confirmed_by: confirmedBy || null,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function deleteNode(id: number) {
    const { error: err } = await supabase.from("progress_nodes").delete().eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function createDiscipline() {
    if (!newDisciplineName.trim() || !newRootName.trim()) return;
    const discipline = newDisciplineName.trim();
    await addNode(null, discipline, newRootName.trim());
    setSelectedDiscipline(discipline);
    setNewDisciplineName("");
    setNewRootName("");
    setAddingDiscipline(false);
  }

  const disciplines = disciplinesIn(nodes);
  const currentNodes = selectedDiscipline ? nodes.filter((n) => n.discipline === selectedDiscipline) : [];
  const tree = buildProgressTree(currentNodes);
  const knownRoots = tree.filter((t) => t.computedPercent != null);
  const overall =
    knownRoots.length > 0
      ? Math.round(knownRoots.reduce((s, t) => s + (t.computedPercent as number), 0) / knownRoots.length)
      : null;

  if (loading) {
    return (
      <main className="p-6 md:p-10 max-w-4xl mx-auto">
        <p className="text-sm text-[var(--ink)]/50">Loading…</p>
      </main>
    );
  }

  return (
    <main className="p-6 md:p-10 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Progress</h1>
      <p className="text-sm text-[var(--ink)]/60 mb-6">
        Fact-checked completion, per discipline &mdash; enter a percentage only at the bottom
        of each tree (a drawing, a sub-assembly, whatever's actually checked with someone),
        and everything above it is a computed average, never a separate guess.
      </p>

      {error && (
        <div className="mb-4 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {disciplines.map((d) => (
          <button
            key={d}
            onClick={() => setSelectedDiscipline(d)}
            className={`text-xs font-mono uppercase tracking-wide px-3 py-1.5 rounded border ${
              d === selectedDiscipline
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "border-[var(--line)] text-[var(--ink)]/60 hover:border-[var(--accent)]"
            }`}
          >
            {d}
          </button>
        ))}
        <button
          onClick={() => setAddingDiscipline((v) => !v)}
          className="text-xs font-mono uppercase tracking-wide px-3 py-1.5 rounded border border-dashed border-[var(--line)] text-[var(--ink)]/50 hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          + Add discipline
        </button>
      </div>

      {addingDiscipline && (
        <div className="border border-[var(--line)] rounded-lg p-4 bg-white/60 mb-4 flex items-center gap-2 flex-wrap">
          <input
            value={newDisciplineName}
            onChange={(e) => setNewDisciplineName(e.target.value)}
            placeholder="Discipline (e.g. Mechanical, Software, Wiring)"
            className="border border-[var(--line)] rounded px-2 py-1.5 text-sm bg-white flex-1 min-w-[160px]"
          />
          <input
            value={newRootName}
            onChange={(e) => setNewRootName(e.target.value)}
            placeholder="First top-level item (e.g. MH063-00-00)"
            className="border border-[var(--line)] rounded px-2 py-1.5 text-sm bg-white flex-1 min-w-[160px]"
          />
          <button
            onClick={createDiscipline}
            className="text-xs bg-[var(--accent)] text-white rounded px-3 py-1.5 font-medium"
          >
            Create
          </button>
        </div>
      )}

      {selectedDiscipline ? (
        <div className="border border-[var(--line)] rounded-lg p-5 bg-white/60">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium">{selectedDiscipline}</h2>
            {overall != null && (
              <span className="text-lg font-semibold font-mono-num" style={{ color: "var(--accent)" }}>
                {overall}%
              </span>
            )}
          </div>
          {tree.length === 0 ? (
            <p className="text-sm text-[var(--ink)]/50">Nothing here yet.</p>
          ) : (
            <ProgressTree
              rollups={tree}
              onAddChild={(parentId, name) => addNode(parentId, selectedDiscipline, name)}
              onRename={renameNode}
              onSetPercent={setPercent}
              onDelete={deleteNode}
            />
          )}
          <div className="mt-3 pt-3 border-t border-[var(--line)]">
            <AddRootNode onAdd={(name) => addNode(null, selectedDiscipline, name)} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-[var(--ink)]/50">
          No disciplines set up yet &mdash; click &ldquo;+ Add discipline&rdquo; to start one.
        </p>
      )}
    </main>
  );
}

function AddRootNode({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="flex items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="+ Add another top-level item"
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) {
            onAdd(name.trim());
            setName("");
          }
        }}
        className="border border-[var(--line)] rounded px-2 py-1 text-xs bg-white flex-1"
      />
      <button
        onClick={() => {
          if (name.trim()) {
            onAdd(name.trim());
            setName("");
          }
        }}
        className="text-xs bg-[var(--accent)] text-white rounded px-2 py-1"
      >
        Add
      </button>
    </div>
  );
}
