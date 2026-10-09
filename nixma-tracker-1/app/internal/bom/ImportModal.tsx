"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BomDiscipline, BomItem, ModuleRow, StationRow } from "@/lib/types";
import { BOM_DISCIPLINES, BOM_DISCIPLINE_LABEL, ParsedBomRow, guessStation, planImport } from "@/lib/bom";
import { readBomFile, ReadResult } from "@/lib/bomExcel";

const NONE = "__none__";

export default function ImportModal({
  projectId,
  existing,
  modules,
  stations,
  canViewProcurement,
  onClose,
  onDone,
}: {
  projectId: string;
  existing: BomItem[];
  modules: ModuleRow[];
  stations: StationRow[];
  canViewProcurement: boolean;
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [read, setRead] = useState<ReadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [defaultDiscipline, setDefaultDiscipline] = useState<BomDiscipline>("mechanical");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<string | null>(null);

  const stationByName = useMemo(() => {
    const m = new Map<string, number>();
    stations.forEach((s) => m.set(s.name.trim().toLowerCase(), s.id));
    return m;
  }, [stations]);

  // Groups rows by the label we'll ask the user to map: the Station column
  // if the file has one (tracker exports), else the Sub-Assembly.
  const groupOf = (r: ParsedBomRow) => (r.station_name || r.sub_assembly || "(no sub-assembly)").trim();

  async function onPick(f: File | null) {
    setFile(f); setRead(null); setError(null);
    if (!f) return;
    setBusy(true);
    try {
      const res = await readBomFile(f);
      if (!canViewProcurement) res.rows.forEach((r) => delete r.unit_price);
      setRead(res);
      const groups = [...new Set(res.rows.map(groupOf))];
      const init: Record<string, string> = {};
      for (const g of groups) {
        const exact = stationByName.get(g.toLowerCase());
        const guess = exact ?? guessStation(g, stations);
        init[g] = guess != null ? String(guess) : NONE;
      }
      setMapping(init);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const plan = useMemo(() => (read ? planImport(read.rows, existing) : null), [read, existing]);
  const groups = useMemo(() => {
    if (!read) return [];
    const counts = new Map<string, number>();
    read.rows.forEach((r) => counts.set(groupOf(r), (counts.get(groupOf(r)) ?? 0) + 1));
    return [...counts.entries()];
  }, [read]);

  async function run() {
    if (!read || !plan) return;
    setBusy(true); setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user.id ?? null;
    const stationFor = (r: ParsedBomRow) => {
      const v = mapping[groupOf(r)];
      return v && v !== NONE ? Number(v) : null;
    };

    // Inserts, in batches.
    const toInsert = plan.inserts.map((r) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { source_row, tracker_id, station_name, ...rest } = r;
      return {
        ...rest,
        discipline: rest.discipline ?? defaultDiscipline,
        station_id: stationFor(r),
        project_id: projectId,
        created_by: uid,
        updated_by: uid,
      };
    });
    for (let i = 0; i < toInsert.length; i += 200) {
      setProgress(`Adding ${Math.min(i + 200, toInsert.length)} / ${toInsert.length}…`);
      const { error: err } = await supabase.from("bom_items").insert(toInsert.slice(i, i + 200));
      if (err) { setError(`Insert failed: ${err.message}`); setBusy(false); setProgress(null); return; }
    }

    // Updates. A station is only filled in if the tracker row has none yet.
    const byId = new Map(existing.map((e) => [e.id, e]));
    let done = 0;
    for (const u of plan.updates) {
      const cur = byId.get(u.id);
      const patch: Record<string, unknown> = { ...u.patch, updated_by: uid };
      if (cur && cur.station_id == null) {
        const sid = stationFor(u.row);
        if (sid != null) patch.station_id = sid;
      }
      const { error: err } = await supabase.from("bom_items").update(patch).eq("id", u.id);
      if (err) { setError(`Update failed on row ${u.id}: ${err.message}`); setBusy(false); setProgress(null); return; }
      done += 1;
      if (done % 20 === 0) setProgress(`Updating ${done} / ${plan.updates.length}…`);
    }
    setBusy(false); setProgress(null);
    onDone(`Imported ${file?.name}: ${toInsert.length} added, ${plan.updates.length} updated, ${plan.unchanged} unchanged.`);
  }

  const sel = "field px-2 py-1.5 text-sm w-full";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="px-5 pt-4 pb-3 border-b border-[var(--line)] flex items-center justify-between">
          <h2 className="font-semibold">Import BOM from Excel</h2>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="text-[var(--ink)]/40 hover:text-[var(--ink)] text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto text-sm">
          <div className="space-y-2">
            <p className="text-[var(--ink)]/60">
              Use the company BOM template, a file exported from here, or an older master list — section rows
              like <span className="font-mono">MH063-120-00 SINGULATOR</span> are read as sub-assemblies.
              Existing parts are matched and updated; blank cells never erase what&apos;s already in the tracker.
            </p>
            <input type="file" accept=".xlsx" disabled={busy} onChange={(e) => onPick(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>

          {error && <p className="text-[var(--rust)] bg-[var(--rust)]/10 rounded-lg p-2.5">{error}</p>}
          {busy && !read && <p className="text-[var(--ink)]/50">Reading file…</p>}

          {read && plan && (
            <>
              <div className="grid grid-cols-4 gap-2">
                {[
                  ["New parts", plan.inserts.length, "var(--accent)"],
                  ["Updates", plan.updates.length, "#4a90d9"],
                  ["Unchanged", plan.unchanged, "var(--ink)"],
                  ["Skipped rows", read.skipped, read.skipped ? "var(--amber)" : "var(--ink)"],
                ].map(([l, v, c]) => (
                  <div key={l as string} className="rounded-lg bg-[var(--paper)] p-3">
                    <p className="text-xl font-semibold font-mono-num" style={{ color: c as string }}>{v as number}</p>
                    <p className="text-xs text-[var(--ink)]/50">{l as string}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-[var(--ink)]/45">
                Sheet “{read.sheetName}”, header on row {read.headerRow}.
                {read.skipped > 0 && " Skipped rows have no description."}
                {read.unknownHeaders.length > 0 && ` Ignored columns: ${read.unknownHeaders.slice(0, 8).join(", ")}${read.unknownHeaders.length > 8 ? "…" : ""}.`}
              </p>

              <div>
                <h3 className="font-medium mb-1">Link to stations</h3>
                <p className="text-xs text-[var(--ink)]/50 mb-2">
                  Pick the tracker station for each group in the file. Guesses are pre-filled — check them.
                </p>
                <div className="space-y-1.5">
                  {groups.map(([g, n]) => (
                    <div key={g} className="grid grid-cols-[1fr_1fr] gap-3 items-center">
                      <p className="truncate"><span className="font-medium">{g}</span> <span className="text-[var(--ink)]/40 text-xs">· {n} part{n === 1 ? "" : "s"}</span></p>
                      <select value={mapping[g] ?? NONE} onChange={(e) => setMapping((m) => ({ ...m, [g]: e.target.value }))} className={sel}>
                        <option value={NONE}>— Leave unassigned —</option>
                        {modules.map((m) => (
                          <optgroup key={m.id} label={m.name}>
                            {stations.filter((s) => s.module_id === m.id).map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                {stations.length === 0 && (
                  <p className="text-xs text-[var(--amber)] mt-2">This project has no stations yet — set them up in Module Rollup to get per-station progress.</p>
                )}
              </div>

              {!read.rows.some((r) => r.discipline) && (
                <div>
                  <label className="block text-xs font-medium text-[var(--ink)]/55 mb-1">This file has no Discipline column. Treat parts as:</label>
                  <select value={defaultDiscipline} onChange={(e) => setDefaultDiscipline(e.target.value as BomDiscipline)} className={`${sel} max-w-xs`}>
                    {BOM_DISCIPLINES.map((d) => <option key={d} value={d}>{BOM_DISCIPLINE_LABEL[d]}</option>)}
                  </select>
                </div>
              )}

              {plan.updates.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-[var(--ink)]/60">What will change on existing parts</summary>
                  <ul className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
                    {plan.updates.slice(0, 100).map((u) => {
                      const cur = existing.find((e) => e.id === u.id);
                      return <li key={u.id}><span className="font-medium">{cur?.description}</span> — {u.changed.join(", ")}</li>;
                    })}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--line)] flex items-center gap-2">
          {progress && <span className="text-xs text-[var(--ink)]/50">{progress}</span>}
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} disabled={busy} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button
              onClick={run}
              disabled={busy || !plan || plan.inserts.length + plan.updates.length === 0}
              className="btn-primary px-5 py-2 text-sm"
            >
              {busy && read ? "Importing…" : plan ? `Import ${plan.inserts.length + plan.updates.length} rows` : "Import"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
