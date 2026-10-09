"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useProjectId } from "@/lib/useProjectId";
import { useInternalAuth } from "@/lib/internalAuth";
import { BomDiscipline, BomItem, BomStatus, ModuleRow, ProcurementPo, StationRow } from "@/lib/types";
import {
  BOM_DISCIPLINES,
  BOM_DISCIPLINE_LABEL,
  BOM_FLAG_HELP,
  BOM_FLAG_LABEL,
  BOM_FLAG_SEVERE,
  BOM_STATUSES,
  BOM_STATUS_LABEL,
  BOM_STATUS_STYLE,
  BomCounts,
  BomFlag,
  bomFlags,
  computeBomRollup,
  normalizeBomItems,
  pct,
  todayIso,
} from "@/lib/bom";
import { downloadBlob, exportBomXlsx } from "@/lib/bomExcel";
import ItemModal from "./ItemModal";
import ImportModal from "./ImportModal";

interface ProjectInfo { name: string; customer: string | null; project_code: string | null; share_bom_with_client: boolean }

const ALL = "all";
const UNASSIGNED = "unassigned";

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function StatusChip({ s }: { s: BomStatus }) {
  const st = BOM_STATUS_STYLE[s];
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap" style={{ background: st.bg, color: st.fg }}>
      {BOM_STATUS_LABEL[s]}
    </span>
  );
}

function FlagChip({ f }: { f: BomFlag }) {
  const severe = BOM_FLAG_SEVERE.includes(f);
  return (
    <span
      title={BOM_FLAG_HELP[f]}
      className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide whitespace-nowrap"
      style={severe ? { background: "#e2445c1f", color: "var(--rust)" } : { background: "#fdab3d26", color: "#9c5700" }}
    >
      {BOM_FLAG_LABEL[f]}
    </span>
  );
}

/** Three stacked progress bars: finalized / ordered / received. */
function ProgressBars({ c }: { c: BomCounts }) {
  const bars: [string, number, string][] = [
    ["Final", c.finalized, "#9aa5c4"],
    ["Ordered", c.ordered, "#f0a35e"],
    ["Rcvd", c.received, "var(--accent)"],
  ];
  return (
    <div className="space-y-0.5 w-full">
      {bars.map(([l, n, color]) => (
        <div key={l} className="flex items-center gap-1.5">
          <span className="w-11 text-[10px] text-[var(--ink)]/45">{l}</span>
          <div className="flex-1 h-1.5 rounded-full bg-[var(--line)] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pct(n, c.lines)}%`, background: color }} />
          </div>
          <span className="w-8 text-right text-[10px] font-mono-num text-[var(--ink)]/60">{pct(n, c.lines)}%</span>
        </div>
      ))}
    </div>
  );
}

export default function BomPage() {
  const projectId = useProjectId();
  const { canViewProcurement } = useInternalAuth();

  const [items, setItems] = useState<BomItem[]>([]);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [stations, setStations] = useState<StationRow[]>([]);
  const [pos, setPos] = useState<ProcurementPo[]>([]);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [fStation, setFStation] = useState<string>(ALL);
  const [fDisc, setFDisc] = useState<BomDiscipline | typeof ALL>(ALL);
  const [fStatus, setFStatus] = useState<BomStatus | typeof ALL>(ALL);
  const [fFlag, setFFlag] = useState<BomFlag | "any" | typeof ALL>(ALL);
  const [showCancelled, setShowCancelled] = useState(false);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>("");
  const [bulkStation, setBulkStation] = useState<string>("");

  const [editing, setEditing] = useState<BomItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [bRes, mRes, sRes, pRes, poRes] = await Promise.all([
      supabase.from("bom_items").select("*").eq("project_id", projectId).order("sort_order", { nullsFirst: false }).order("id"),
      supabase.from("modules").select("*").eq("project_id", projectId).order("sequence"),
      supabase.from("stations").select("*").eq("project_id", projectId).order("sequence"),
      supabase.from("projects").select("name, customer, project_code, share_bom_with_client").eq("id", projectId).single(),
      canViewProcurement
        ? supabase.from("procurement_pos").select("*").eq("project_id", projectId).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (bRes.error) setError(bRes.error.message);
    else setError(null);
    setItems(normalizeBomItems(bRes.data));
    setModules((mRes.data as ModuleRow[]) || []);
    setStations((sRes.data as StationRow[]) || []);
    setProject((pRes.data as ProjectInfo) || null);
    setPos((poRes.data as ProcurementPo[]) || []);
    setLoading(false);
  }, [projectId, canViewProcurement]);

  useEffect(() => { load(); }, [load]);

  const today = todayIso();
  const rollup = useMemo(() => computeBomRollup(items, modules, stations, today), [items, modules, stations, today]);
  const stationName = useMemo(() => new Map(stations.map((s) => [s.id, s.name])), [stations]);
  const poById = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos]);

  const flagsById = useMemo(() => {
    const m = new Map<number, BomFlag[]>();
    items.forEach((i) => m.set(i.id, bomFlags(i, today)));
    return m;
  }, [items, today]);

  const flagTotals = useMemo(() => {
    const t: Partial<Record<BomFlag, number>> = {};
    items.forEach((i) => (flagsById.get(i.id) ?? []).forEach((f) => (t[f] = (t[f] ?? 0) + 1)));
    return t;
  }, [items, flagsById]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (!showCancelled && i.status === "cancelled" && fStatus !== "cancelled") return false;
      if (fStation === UNASSIGNED ? i.station_id != null : fStation !== ALL && String(i.station_id) !== fStation) return false;
      if (fDisc !== ALL && i.discipline !== fDisc) return false;
      if (fStatus !== ALL && i.status !== fStatus) return false;
      const fl = flagsById.get(i.id) ?? [];
      if (fFlag === "any" ? fl.length === 0 : fFlag !== ALL && !fl.includes(fFlag)) return false;
      if (q) {
        const hay = [i.description, i.part_no, i.manufacturer, i.sub_assembly, i.supplier, i.po_no, i.pr_no, i.drawing_no, i.remarks]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, fStation, fDisc, fStatus, fFlag, showCancelled, flagsById]);

  async function uid() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user.id ?? null;
  }

  async function setStatus(id: number, status: BomStatus) {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, status } : x)));
    const { error: err } = await supabase.from("bom_items").update({ status, updated_by: await uid() }).eq("id", id);
    if (err) { setError(err.message); load(); }
  }

  async function applyBulk() {
    const ids = [...selected];
    if (!ids.length) return;
    const patch: Record<string, unknown> = { updated_by: await uid() };
    if (bulkStatus) patch.status = bulkStatus;
    if (bulkStation) patch.station_id = bulkStation === UNASSIGNED ? null : Number(bulkStation);
    if (Object.keys(patch).length === 1) return;
    const { error: err } = await supabase.from("bom_items").update(patch).in("id", ids);
    if (err) setError(err.message);
    else setNotice(`Updated ${ids.length} part${ids.length === 1 ? "" : "s"}.`);
    setSelected(new Set()); setBulkStatus(""); setBulkStation("");
    load();
  }

  async function toggleSharing() {
    if (!project) return;
    const next = !project.share_bom_with_client;
    const { error: err } = await supabase.rpc("set_bom_client_sharing", { p_project_id: projectId, p_enabled: next });
    if (err) { setError(err.message); return; }
    setProject({ ...project, share_bom_with_client: next });
    setNotice(next
      ? "BOM is now visible on the customer page (no supplier, PO, price or remarks). Untick “Show on customer BOM” on any part to hide it."
      : "BOM is hidden from the customer page.");
  }

  async function doExport(mode: "internal" | "customer") {
    if (!project) return;
    setExporting(true);
    try {
      const blob = await exportBomXlsx({
        items, modules, stations, project, mode,
      });
      const code = project.project_code || projectId;
      const d = today.replace(/-/g, "");
      downloadBlob(blob, mode === "internal" ? `${code}_BOM_internal_${d}.xlsx` : `${code}_BOM_${d}.xlsx`);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    }
    setExporting(false);
  }

  const visibleIds = filtered.map((f) => f.id);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const t = rollup.total;
  const sel = "field px-2 py-1.5 text-sm";

  return (
    <main className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">BOM List</h1>
          <p className="text-sm text-[var(--ink)]/50 mt-0.5">
            One list for engineering, purchasing and assembly — progress rolls up by station.
          </p>
          {project && (
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-[var(--ink)]/60 cursor-pointer">
              <input type="checkbox" checked={project.share_bom_with_client} onChange={toggleSharing} />
              Share with customer
              <span className="text-[var(--ink)]/40">
                {project.share_bom_with_client ? "· visible on customer page" : "· hidden from customer page"}
              </span>
            </label>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <a href="/templates/BOM_Master_List_TEMPLATE.xlsx" download className="btn-secondary px-3 py-2 text-sm">Blank template</a>
          <button onClick={() => doExport("customer")} disabled={exporting || !items.length} className="btn-secondary px-3 py-2 text-sm" title="No supplier, PO, price or remarks">
            Export for customer
          </button>
          <button onClick={() => doExport("internal")} disabled={exporting || !items.length} className="btn-secondary px-3 py-2 text-sm">
            {exporting ? "Exporting…" : "Export Excel"}
          </button>
          <button onClick={() => setImporting(true)} className="btn-secondary px-3 py-2 text-sm">Import Excel</button>
          <button onClick={() => setAdding(true)} className="btn-primary px-4 py-2 text-sm">+ Add part</button>
        </div>
      </div>

      {error && <p className="text-sm text-[var(--rust)] bg-[var(--rust)]/10 rounded-lg p-3">{error}</p>}
      {notice && (
        <p className="text-sm bg-[var(--accent)]/10 rounded-lg p-3 flex justify-between gap-3">
          {notice}
          <button onClick={() => setNotice(null)} className="text-[var(--ink)]/40">×</button>
        </p>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { l: "BOM lines", v: String(t.lines), sub: rollup.unassigned.lines ? `${rollup.unassigned.lines} not on a station` : "excl. cancelled", c: "var(--ink)" },
          { l: "Finalized", v: `${pct(t.finalized, t.lines)}%`, sub: `${t.finalized} of ${t.lines}`, c: "var(--ink)" },
          { l: "Ordered", v: `${pct(t.ordered, t.lines)}%`, sub: `${t.ordered} of ${t.lines}`, c: "#c06a1c" },
          { l: "Received", v: `${pct(t.received, t.lines)}%`, sub: `${t.received} of ${t.lines}`, c: "var(--accent)" },
          { l: "Overdue", v: String(t.overdue), sub: "ETA passed", c: t.overdue ? "var(--rust)" : "var(--ink)" },
          { l: "Need attention", v: String(t.flagged), sub: "lines with flags", c: t.flagged ? "#9c5700" : "var(--ink)" },
        ].map((k) => (
          <div key={k.l} className="panel p-4">
            <p className="text-[11px] text-[var(--ink)]/50 uppercase tracking-wide font-mono">{k.l}</p>
            <p className="text-2xl font-semibold mt-1 font-mono-num" style={{ color: k.c }}>{k.v}</p>
            <p className="text-[11px] text-[var(--ink)]/40 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Rollup by module / station */}
      {(rollup.modules.length > 0 || items.length > 0) && (
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Progress by station</h2>
            {fStation !== ALL && (
              <button onClick={() => setFStation(ALL)} className="text-xs text-[var(--ink)]/50 hover:text-[var(--accent)] underline">Show all stations</button>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rollup.modules.map((m) => (
              <div key={m.module.id} className="rounded-xl border border-[var(--line)] p-3">
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <p className="text-sm font-semibold truncate">{m.module.name}</p>
                  <p className="text-[11px] text-[var(--ink)]/45 font-mono-num shrink-0">{m.counts.lines} lines</p>
                </div>
                <ProgressBars c={m.counts} />
                <div className="mt-3 space-y-1">
                  {m.stations.map((s) => (
                    <button
                      key={s.station.id}
                      onClick={() => setFStation(fStation === String(s.station.id) ? ALL : String(s.station.id))}
                      className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded-lg text-xs hover:bg-[var(--paper)] ${fStation === String(s.station.id) ? "bg-[var(--accent)]/10" : ""}`}
                    >
                      <span className="flex-1 truncate">{s.station.name}</span>
                      <span className="font-mono-num text-[var(--ink)]/50 w-14 text-right">{s.counts.received}/{s.counts.lines}</span>
                      <span className="w-16 h-1.5 rounded-full bg-[var(--line)] overflow-hidden">
                        <span className="block h-full bg-[var(--accent)]" style={{ width: `${pct(s.counts.received, s.counts.lines)}%` }} />
                      </span>
                      <span className="w-6 text-right">
                        {s.counts.overdue > 0 && <span className="text-[10px] font-semibold text-[var(--rust)]" title="Overdue lines">{s.counts.overdue}!</span>}
                      </span>
                    </button>
                  ))}
                  {m.stations.length === 0 && <p className="text-xs text-[var(--ink)]/40 px-2">No stations in this module.</p>}
                </div>
              </div>
            ))}
            {rollup.unassigned.lines > 0 && (
              <button
                onClick={() => setFStation(fStation === UNASSIGNED ? ALL : UNASSIGNED)}
                className={`rounded-xl border border-dashed border-[var(--amber)] p-3 text-left ${fStation === UNASSIGNED ? "bg-[var(--amber)]/10" : ""}`}
              >
                <p className="text-sm font-semibold">Not on a station</p>
                <p className="text-xs text-[var(--ink)]/50 mt-0.5 mb-2">{rollup.unassigned.lines} lines — select them below and use “Move to station”.</p>
                <ProgressBars c={rollup.unassigned} />
              </button>
            )}
          </div>
          {rollup.modules.length === 0 && (
            <p className="text-xs text-[var(--ink)]/45 mt-1">This project has no modules or stations yet — add them in Module Rollup to see per-station progress.</p>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search part, P/N, supplier, PO…" className={`${sel} w-60`} />
        <select value={fStation} onChange={(e) => setFStation(e.target.value)} className={sel}>
          <option value={ALL}>All stations</option>
          <option value={UNASSIGNED}>Not on a station</option>
          {modules.map((m) => (
            <optgroup key={m.id} label={m.name}>
              {stations.filter((s) => s.module_id === m.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
        <select value={fDisc} onChange={(e) => setFDisc(e.target.value as BomDiscipline)} className={sel}>
          <option value={ALL}>All disciplines</option>
          {BOM_DISCIPLINES.map((d) => <option key={d} value={d}>{BOM_DISCIPLINE_LABEL[d]}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value as BomStatus)} className={sel}>
          <option value={ALL}>All statuses</option>
          {BOM_STATUSES.map((s) => <option key={s} value={s}>{BOM_STATUS_LABEL[s]}</option>)}
        </select>
        <select value={fFlag} onChange={(e) => setFFlag(e.target.value as BomFlag)} className={sel}>
          <option value={ALL}>Any flags</option>
          <option value="any">Has a flag</option>
          {(Object.keys(BOM_FLAG_LABEL) as BomFlag[]).map((f) => (
            <option key={f} value={f}>{BOM_FLAG_LABEL[f]} ({flagTotals[f] ?? 0})</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-[var(--ink)]/60">
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled
        </label>
        <span className="text-xs text-[var(--ink)]/40 ml-auto">{filtered.length} of {items.length} parts</span>
      </div>

      {selected.size > 0 && (
        <div className="panel px-4 py-2.5 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className={sel}>
            <option value="">Set status…</option>
            {BOM_STATUSES.map((s) => <option key={s} value={s}>{BOM_STATUS_LABEL[s]}</option>)}
          </select>
          <select value={bulkStation} onChange={(e) => setBulkStation(e.target.value)} className={sel}>
            <option value="">Move to station…</option>
            <option value={UNASSIGNED}>— Not assigned —</option>
            {modules.map((m) => (
              <optgroup key={m.id} label={m.name}>
                {stations.filter((s) => s.module_id === m.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
          <button onClick={applyBulk} disabled={!bulkStatus && !bulkStation} className="btn-primary px-3 py-1.5 text-xs">Apply</button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-[var(--ink)]/50 ml-auto">Clear</button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <p className="text-sm text-[var(--ink)]/40 py-10 text-center">Loading BOM…</p>
      ) : items.length === 0 ? (
        <div className="panel p-10 text-center space-y-2">
          <p className="font-medium">No parts yet</p>
          <p className="text-sm text-[var(--ink)]/50">Import the engineers&apos; Excel BOM, or add parts one by one.</p>
          <div className="flex gap-2 justify-center pt-2">
            <button onClick={() => setImporting(true)} className="btn-primary px-4 py-2 text-sm">Import Excel</button>
            <a href="/templates/BOM_Master_List_TEMPLATE.xlsx" download className="btn-secondary px-4 py-2 text-sm">Get blank template</a>
          </div>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] bg-[var(--paper)] text-left text-[11px] text-[var(--ink)]/50">
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all visible"
                      checked={allChecked}
                      onChange={(e) => setSelected(e.target.checked ? new Set([...selected, ...visibleIds]) : new Set([...selected].filter((id) => !visibleIds.includes(id))))}
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">Station / sub-assy</th>
                  <th className="px-3 py-2 font-medium">Part</th>
                  <th className="px-3 py-2 font-medium text-right">Qty</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Supplier / PO</th>
                  <th className="px-3 py-2 font-medium">Required</th>
                  <th className="px-3 py-2 font-medium">ETA</th>
                  <th className="px-3 py-2 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const fl = flagsById.get(i.id) ?? [];
                  const po = i.linked_po_id != null ? poById.get(i.linked_po_id) : undefined;
                  return (
                    <tr
                      key={i.id}
                      onClick={() => setEditing(i)}
                      className={`border-b border-[var(--line)] last:border-0 cursor-pointer hover:bg-[var(--paper)]/70 ${i.status === "cancelled" ? "opacity-50" : ""}`}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${i.description}`}
                          checked={selected.has(i.id)}
                          onChange={(e) => {
                            const n = new Set(selected);
                            if (e.target.checked) n.add(i.id); else n.delete(i.id);
                            setSelected(n);
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 max-w-[200px]">
                        <p className="truncate text-xs">{i.station_id != null ? stationName.get(i.station_id) : <span className="text-[var(--amber)]">No station</span>}</p>
                        <p className="truncate text-[11px] text-[var(--ink)]/40">{i.sub_assembly || "—"} · {BOM_DISCIPLINE_LABEL[i.discipline]}</p>
                      </td>
                      <td className="px-3 py-2 max-w-[260px]">
                        <p className="font-medium truncate">{i.description}</p>
                        <p className="text-[11px] text-[var(--ink)]/45 truncate font-mono">
                          {[i.part_no, i.manufacturer].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num whitespace-nowrap">
                        {i.total_qty != null ? Number(i.total_qty) : "—"} <span className="text-[11px] text-[var(--ink)]/40">{i.unit}</span>
                        {i.qty_received != null && (
                          <p className="text-[10px] text-[var(--ink)]/40">rcvd {Number(i.qty_received)}</p>
                        )}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="relative inline-block">
                          <StatusChip s={i.status} />
                          <select
                            aria-label="Change status"
                            value={i.status}
                            onChange={(e) => setStatus(i.id, e.target.value as BomStatus)}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          >
                            {BOM_STATUSES.map((s) => <option key={s} value={s}>{BOM_STATUS_LABEL[s]}</option>)}
                          </select>
                        </div>
                      </td>
                      <td className="px-3 py-2 max-w-[180px]">
                        <p className="truncate text-xs">{i.supplier || po?.supplier_name || "—"}</p>
                        <p className="truncate text-[11px] text-[var(--ink)]/40 font-mono">
                          {[i.pr_no && `PR ${i.pr_no}`, (i.po_no || po?.po_number) && `PO ${i.po_no || po?.po_number}`].filter(Boolean).join(" · ") || ""}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-xs font-mono-num whitespace-nowrap text-[var(--ink)]/60">{fmtDate(i.required_date)}</td>
                      <td className={`px-3 py-2 text-xs font-mono-num whitespace-nowrap ${fl.includes("OVERDUE") ? "text-[var(--rust)] font-semibold" : "text-[var(--ink)]/60"}`}>
                        {fmtDate(i.eta || po?.expected_delivery || null)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">{fl.map((f) => <FlagChip key={f} f={f} />)}</div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-[var(--ink)]/40">No parts match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(adding || editing) && (
        <ItemModal
          projectId={projectId}
          item={editing}
          defaults={
            adding
              ? {
                  station_id: fStation !== ALL && fStation !== UNASSIGNED ? Number(fStation) : null,
                  discipline: fDisc !== ALL ? fDisc : "mechanical",
                }
              : undefined
          }
          modules={modules}
          stations={stations}
          pos={pos}
          canViewProcurement={canViewProcurement}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); load(); }}
        />
      )}
      {importing && (
        <ImportModal
          projectId={projectId}
          existing={items}
          modules={modules}
          stations={stations}
          canViewProcurement={canViewProcurement}
          onClose={() => setImporting(false)}
          onDone={(s) => { setImporting(false); setNotice(s); load(); }}
        />
      )}
    </main>
  );
}
