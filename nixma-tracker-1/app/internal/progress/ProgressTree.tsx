"use client";

import { useState } from "react";
import { ProgressRollup } from "@/lib/progressRollup";

interface ProgressTreeProps {
  rollups: ProgressRollup[];
  onAddChild: (parentId: number, name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onSetPercent: (id: number, percent: number, confirmedBy: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  depth?: number;
}

export default function ProgressTree({
  rollups,
  onAddChild,
  onRename,
  onSetPercent,
  onDelete,
  depth = 0,
}: ProgressTreeProps) {
  return (
    <div className={depth > 0 ? "pl-5 border-l border-[var(--line)] ml-2" : ""}>
      {rollups.map((r) => (
        <ProgressNodeRow
          key={r.node.id}
          rollup={r}
          onAddChild={onAddChild}
          onRename={onRename}
          onSetPercent={onSetPercent}
          onDelete={onDelete}
          depth={depth}
        />
      ))}
    </div>
  );
}

interface ProgressNodeRowProps {
  rollup: ProgressRollup;
  onAddChild: (parentId: number, name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onSetPercent: (id: number, percent: number, confirmedBy: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  depth: number;
}

function ProgressNodeRow({
  rollup,
  onAddChild,
  onRename,
  onSetPercent,
  onDelete,
  depth,
}: ProgressNodeRowProps) {
  const { node, children, computedPercent, confirmedLeafCount, totalLeafCount } = rollup;
  const isLeaf = children.length === 0;

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(node.name);
  const [addingChild, setAddingChild] = useState(false);
  const [childNameDraft, setChildNameDraft] = useState("");
  const [editingPercent, setEditingPercent] = useState(false);
  const [percentDraft, setPercentDraft] = useState(
    node.percent_complete != null ? String(node.percent_complete) : ""
  );
  const [confirmedByDraft, setConfirmedByDraft] = useState(node.confirmed_by || "");
  const [busy, setBusy] = useState(false);

  async function submitRename() {
    if (!nameDraft.trim() || nameDraft === node.name) {
      setRenaming(false);
      setNameDraft(node.name);
      return;
    }
    setBusy(true);
    await onRename(node.id, nameDraft.trim());
    setBusy(false);
    setRenaming(false);
  }

  async function submitAddChild() {
    if (!childNameDraft.trim()) return;
    setBusy(true);
    await onAddChild(node.id, childNameDraft.trim());
    setBusy(false);
    setChildNameDraft("");
    setAddingChild(false);
  }

  async function submitPercent() {
    const n = Number(percentDraft);
    if (percentDraft.trim() === "" || Number.isNaN(n)) return;
    setBusy(true);
    await onSetPercent(node.id, Math.max(0, Math.min(100, Math.round(n))), confirmedByDraft.trim());
    setBusy(false);
    setEditingPercent(false);
  }

  async function handleDelete() {
    const msg = !isLeaf
      ? `Delete "${node.name}" and everything under it? This removes ${totalLeafCount} item${totalLeafCount === 1 ? "" : "s"} below it too. This can't be undone.`
      : `Delete "${node.name}"? This can't be undone.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    await onDelete(node.id);
    setBusy(false);
  }

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {renaming ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") {
                setNameDraft(node.name);
                setRenaming(false);
              }
            }}
            className="border border-[var(--accent)] rounded px-1.5 py-0.5 text-sm bg-white"
          />
        ) : (
          <button
            onClick={() => setRenaming(true)}
            className="text-sm font-medium hover:text-[var(--accent)] text-left"
          >
            {node.name}
          </button>
        )}

        <span className="text-xs font-mono-num text-[var(--ink)]/50">
          {computedPercent != null ? `${computedPercent}%` : "—"}
          {!isLeaf && ` (${confirmedLeafCount}/${totalLeafCount} confirmed)`}
        </span>

        <div className="flex items-center gap-2 ml-auto text-xs">
          {isLeaf && (
            <button
              onClick={() => setEditingPercent((v) => !v)}
              className="underline text-[var(--ink)]/40 hover:text-[var(--accent)]"
            >
              {node.percent_complete != null ? "Update %" : "Set %"}
            </button>
          )}
          <button
            onClick={() => setAddingChild((v) => !v)}
            className="underline text-[var(--ink)]/40 hover:text-[var(--accent)]"
          >
            + Add under this
          </button>
          <button
            onClick={handleDelete}
            disabled={busy}
            className="underline text-[var(--ink)]/40 hover:text-[var(--rust)] disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {node.confirmed_by && node.updated_at && (
        <p className="text-[10px] text-[var(--ink)]/40 mt-0.5">
          Confirmed by {node.confirmed_by} · {new Date(node.updated_at).toLocaleDateString()}
        </p>
      )}

      {editingPercent && (
        <div className="flex items-center gap-2 mt-1.5 ml-1 flex-wrap">
          <input
            type="number"
            min={0}
            max={100}
            value={percentDraft}
            onChange={(e) => setPercentDraft(e.target.value)}
            className="border border-[var(--line)] rounded px-2 py-1 text-xs w-20 bg-white"
            placeholder="%"
          />
          <input
            value={confirmedByDraft}
            onChange={(e) => setConfirmedByDraft(e.target.value)}
            placeholder="Confirmed with (name)"
            className="border border-[var(--line)] rounded px-2 py-1 text-xs bg-white flex-1 min-w-[140px]"
          />
          <button
            onClick={submitPercent}
            disabled={busy}
            className="text-xs bg-[var(--accent)] text-white rounded px-2 py-1 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}

      {addingChild && (
        <div className="flex items-center gap-2 mt-1.5 ml-1">
          <input
            autoFocus
            value={childNameDraft}
            onChange={(e) => setChildNameDraft(e.target.value)}
            placeholder="Name (e.g. 110, or Panel A)"
            onKeyDown={(e) => {
              if (e.key === "Enter") submitAddChild();
            }}
            className="border border-[var(--line)] rounded px-2 py-1 text-xs bg-white flex-1 min-w-[140px]"
          />
          <button
            onClick={submitAddChild}
            disabled={busy}
            className="text-xs bg-[var(--accent)] text-white rounded px-2 py-1 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}

      {children.length > 0 && (
        <ProgressTree
          rollups={children}
          onAddChild={onAddChild}
          onRename={onRename}
          onSetPercent={onSetPercent}
          onDelete={onDelete}
          depth={depth + 1}
        />
      )}
    </div>
  );
}
