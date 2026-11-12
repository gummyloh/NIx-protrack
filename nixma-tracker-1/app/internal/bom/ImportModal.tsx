"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BomDiscipline, BomItem, BomStatus, ModuleRow, StationRow } from "@/lib/types";
import {
  BOM_DISCIPLINES,
  BOM_DISCIPLINE_LABEL,
  BOM_STATUS_LABEL,
  ParsedBomRow,
  guessStation,
  insertOrder,
  isOrdered,
  planImport,
  subAssyKey,
  toInsertPayload,
} from "@/lib/bom";
import { readBomFile, ReadResult } from "@/lib/bomExcel";

const NONE = "__none__";

const FIELD_NAME: Record<string, string> = {
  sub_assembly: "Sub-Assembly", discipline: "Discipline", description: "Description", part_no: "Part No.",
  manufacturer: "Manufacturer", category: "Category", qty: "Qty / Set", multiple: "Multiple", unit: "Unit",
  make_buy: "Make / Buy", drawing_no: "Drawing No.", nsw_part_no: "NSW Part No.", engineer_pic: "Engineer PIC",
  issue_date: "Issue Date", required_date: "Required Date", status: "Status", supplier: "Supplier",
  pr_no: "PR No.", po_no: "PO No.", po_date: "PO Date", eta: "ETA", do_invoice_no: "DO / Invoice No.",
  qty_received: "Qty Received", received_date: "Received Date", qty_issued: "Qty Issued",
  issued_to: "Taken By", issued_date: "Issue Date (Assy)", remarks: "Remarks",
};
const fieldName = (k: string) => FIELD_NAME[k] ?? k;
const show = (k: string, v: unknown) => (k === "status" ? BOM_STATUS_LABEL[v as BomStatus] ?? String(v) : String(v));

export default function ImportModal({
  projectId,
  existing,
  modules,
  stations,
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
  const [useSheet, setUseSheet] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [defaultDiscipline, setDefaultDiscipline] = useState<BomDiscipline>("mechanical");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // Purchasing still keeps Status / PO / ETA in the Excel, so by default a
  // re-upload takes those columns from the file. Untick to protect what's in
  // the tracker once purchasing works here instead.
  const [fileWins, setFileWins] = useState(true);
  const [cancelMissing, setCancelMissing] = useState(false);
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
    setFile(f); setRead(null); setError(null); setCancelMissing(false); setFileWins(true);
    if (!f) return;
    setBusy(true);
    try {
      const res = await readBomFile(f);
      // The BOM tracks progress only — prices in the file are ignored.
      res.sheets.forEach((s) => s.rows.forEach((r) => delete r.unit_price));
      setRead(res);
      setUseSheet(Object.fromEntries(res.sheets.map((s) => [s.name, s.included])));
      // Bare drawing codes ("MH063-120-00") say nothing a name guess can use,
      // but parts already in the tracker under that code know their station.
      const stationByCode = new Map<string, number>();
      for (const e of existing) {
        if (e.station_id != null && e.sub_assembly && !stationByCode.has(subAssyKey(e.sub_assembly))) {
          stationByCode.set(subAssyKey(e.sub_assembly), e.station_id);
        }
      }
      const init: Record<string, string> = {};
      for (const g of new Set(res.sheets.flatMap((s) => s.rows.map(groupOf)))) {
        const exact = stationByName.get(g.toLowerCase());
        const guess = exact ?? stationByCode.get(subAssyKey(g)) ?? guessStation(g, stations);
        init[g] = guess != null ? String(guess) : NONE;
      }
      setMapping(init);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const sheets = useMemo(() => (read ? read.sheets.filter((s) => useSheet[s.name]) : []), [read, useSheet]);
  const rows = useMemo(() => sheets.flatMap((s) => s.rows), [sheets]);
  const issues = useMemo(() => sheets.flatMap((s) => s.issues), [sheets]);
  const skipped = sheets.reduce((n, s) => n + s.skipped, 0);
  const unknownHeaders = useMemo(() => [...new Set(sheets.flatMap((s) => s.unknownHeaders))], [sheets]);
  const multiSheet = (read?.sheets.length ?? 0) > 1;
  const showSheets = !!read && (multiSheet || read.sheets.some((s) => !s.included));

  const plan = useMemo(
    () => (read ? planImport(rows, existing, { fileWins, defaultDiscipline }) : null),
    [read, rows, existing, fileWins, defaultDiscipline]
  );
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((r) => counts.set(groupOf(r), (counts.get(groupOf(r)) ?? 0) + 1));
    return [...counts.entries()];
  }, [rows]);

  const byId = useMemo(() => new Map(existing.map((e) => [e.id, e])), [existing]);
  // Parts the file dropped: only ones nobody has ordered yet are offered for
  // cancelling. Anything already on order is a conversation, not a checkbox.
  const missingOpen = useMemo(() => (plan ? plan.missing.filter((m) => !isOrdered(m)) : []), [plan]);
  const missingOrdered = useMemo(() => (plan ? plan.missing.filter((m) => isOrdered(m)) : []), [plan]);
  const toCancel = cancelMissing ? missingOpen : [];
  const needsDiscipline = rows.some((r) => !r.discipline && !r.discipline_hint);
  const orderSensitive = useMemo(() => (plan ? plan.updates.filter((u) => u.orderSensitive.length > 0) : []), [plan]);

  async function run() {
    if (!read || !plan) return;
    setBusy(true); setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user.id ?? null;
    const stationFor = (r: ParsedBomRow) => {
      const v = mapping[groupOf(r)];
      return v && v !== NONE ? Number(v) : null;
    };
    const fail = (msg: string) => { setError(msg); setBusy(false); setProgress(null); };

    // Inserts, in batches.
    // New parts keep the file's order on screen, after whatever is already here.
    const sortBase = existing.reduce((m, e) => Math.max(m, e.sort_order ?? 0), 0);
    const toInsert = insertOrder(
      plan.inserts.map((r, i) =>
        toInsertPayload(r, { projectId, stationId: stationFor(r), defaultDiscipline, userId: uid, sortOrder: sortBase + i + 1 })
      )
    );
    for (let i = 0; i < toInsert.length; i += 200) {
      setProgress(`Adding ${Math.min(i + 200, toInsert.length)} / ${toInsert.length}…`);
      const { error: err } = await supabase.from("bom_items").insert(toInsert.slice(i, i + 200));
      if (err) return fail(`Insert failed: ${err.message}`);
    }

    // Updates, a few at a time. A station is only filled in if the tracker row has none yet.
    for (let i = 0; i < plan.updates.length; i += 8) {
      setProgress(`Updating ${Math.min(i + 8, plan.updates.length)} / ${plan.updates.length}…`);
      const results = await Promise.all(
        plan.updates.slice(i, i + 8).map((u) => {
          const cur = byId.get(u.id);
          const patch: Record<string, unknown> = { ...u.patch, updated_by: uid };
          if (cur && cur.station_id == null) {
            const sid = stationFor(u.row);
            if (sid != null) patch.station_id = sid;
          }
          return supabase.from("bom_items").update(patch).eq("id", u.id).then((r) => ({ id: u.id, err: r.error }));
        })
      );
      const bad = results.find((r) => r.err);
      if (bad) return fail(`Update failed on “${byId.get(bad.id)?.description ?? bad.id}”: ${bad.err!.message}. Nothing was lost — fix it and import the file again.`);
    }

    if (toCancel.length) {
      setProgress(`Cancelling ${toCancel.length} removed parts…`);
      const { error: err } = await supabase
        .from("bom_items")
        .update({ status: "cancelled", updated_by: uid })
        .in("id", toCancel.map((m) => m.id));
      if (err) return fail(`Couldn't cancel removed parts: ${err.message}`);
    }

    setBusy(false); setProgress(null);
    const parts = [`${toInsert.length} added`, `${plan.updates.length} updated`, `${plan.unchanged} unchanged`];
    if (toCancel.length) parts.push(`${toCancel.length} cancelled`);
    if (plan.kept.length) parts.push(`${plan.kept.length} purchasing values kept from the tracker`);
    if (skipped) parts.push(`${skipped} rows left out`);
    onDone(`Imported ${file?.name}: ${parts.join(", ")}.`);
  }

  const sel = "field px-2 py-1.5 text-sm w-full";
  const total = plan ? plan.inserts.length + plan.updates.length + toCancel.length : 0;
  const attention = issues.filter((i) => i.kind !== "note").length;

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
              Upload your working Excel as it is — the company template, a file exported from here, or an older
              master list. Upload it again whenever it changes: parts are matched to what&apos;s already here,
              blank cells never erase anything, and purchasing updates made in the tracker are kept.
            </p>
            <input type="file" accept=".xlsx,.xlsm,.xls,.csv" disabled={busy} onChange={(e) => onPick(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>

          {error && <p className="text-[var(--rust)] bg-[var(--rust)]/10 rounded-lg p-2.5">{error}</p>}
          {busy && !read && <p className="text-[var(--ink)]/50">Reading file…</p>}

          {read && plan && (
            <>
              {rows.length === 0 && (
                <p className="text-[var(--amber)] bg-[var(--amber)]/10 rounded-lg p-2.5">
                  {sheets.length ? "No parts found on the selected sheet — it looks empty." : "No sheet selected."}
                  {read.sheets.some((s) => !useSheet[s.name] && s.rows.length > 0) && " Tick another sheet below if that's where the parts are."}
                </p>
              )}

              {showSheets && (
                <div>
                  <h3 className="font-medium mb-1">Sheets to import</h3>
                  <div className="space-y-1">
                    {read.sheets.map((s) => (
                      <label key={s.name} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!useSheet[s.name]}
                          disabled={busy}
                          onChange={(e) => setUseSheet((m) => ({ ...m, [s.name]: e.target.checked }))}
                        />
                        <span className="font-medium">{s.name}</span>
                        <span className="text-xs text-[var(--ink)]/45">
                          {s.rows.length} part{s.rows.length === 1 ? "" : "s"}
                          {s.disciplineHint && ` · read as ${BOM_DISCIPLINE_LABEL[s.disciplineHint]}`}
                          {!useSheet[s.name] && s.excludedWhy && ` · left out: ${s.excludedWhy}`}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-4 gap-2">
                {[
                  ["New parts", plan.inserts.length, "var(--accent)"],
                  ["Updates", plan.updates.length, "#4a90d9"],
                  ["Unchanged", plan.unchanged, "var(--ink)"],
                  ["Need a look", attention, attention ? "var(--amber)" : "var(--ink)"],
                ].map(([l, v, c]) => (
                  <div key={l as string} className="rounded-lg bg-[var(--paper)] p-3">
                    <p className="text-xl font-semibold font-mono-num" style={{ color: c as string }}>{v as number}</p>
                    <p className="text-xs text-[var(--ink)]/50">{l as string}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-[var(--ink)]/45">
                {sheets.length > 0 && `${sheets.map((s) => `Sheet “${s.name}”, header on row ${s.headerRow}`).join("; ")}.`}
                {unknownHeaders.length > 0 && ` Columns not used: ${unknownHeaders.slice(0, 8).join(", ")}${unknownHeaders.length > 8 ? "…" : ""}.`}
              </p>

              {issues.length > 0 && (
                <details className="text-xs rounded-lg border border-[var(--amber)]/40 p-2.5" open={skipped > 0}>
                  <summary className="cursor-pointer font-medium">
                    {skipped > 0 && `${skipped} row${skipped === 1 ? "" : "s"} left out`}
                    {skipped > 0 && attention > skipped && ", "}
                    {attention > skipped && `${attention - skipped} cell${attention - skipped === 1 ? "" : "s"} couldn't be read`}
                    {attention === 0 && "Notes about this file"}
                  </summary>
                  <p className="mt-1.5 text-[var(--ink)]/55">
                    Everything else imports normally. Fix these in Excel and upload again, or fill them in here afterwards.
                  </p>
                  <ul className="mt-1.5 space-y-0.5 max-h-40 overflow-y-auto">
                    {issues.slice(0, 150).map((i, n) => (
                      <li key={n}>
                        <span className="text-[var(--ink)]/45">{multiSheet && i.sheet ? `${i.sheet} · ` : ""}row {i.row}</span> — {i.message}
                      </li>
                    ))}
                    {issues.length > 150 && <li className="text-[var(--ink)]/45">…and {issues.length - 150} more</li>}
                  </ul>
                </details>
              )}

              <div>
                <h3 className="font-medium mb-1">Link to stations</h3>
                <p className="text-xs text-[var(--ink)]/50 mb-2">
                  Pick the tracker station for each group in the file. Guesses are pre-filled — check them.
                  Parts already linked to a station keep it.
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

              {needsDiscipline && plan.inserts.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[var(--ink)]/55 mb-1">Some parts have no Discipline. Treat new ones as:</label>
                  <select value={defaultDiscipline} onChange={(e) => setDefaultDiscipline(e.target.value as BomDiscipline)} className={`${sel} max-w-xs`}>
                    {BOM_DISCIPLINES.map((d) => <option key={d} value={d}>{BOM_DISCIPLINE_LABEL[d]}</option>)}
                  </select>
                </div>
              )}

              {plan.updates.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-[var(--ink)]/60">What will change on {plan.updates.length} existing part{plan.updates.length === 1 ? "" : "s"}</summary>
                  <ul className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
                    {plan.updates.slice(0, 100).map((u) => (
                      <li key={u.id}>
                        <span className="font-medium">{byId.get(u.id)?.description}</span> —{" "}
                        {u.changed.map((k) => `${fieldName(k)} → ${show(k, (u.patch as Record<string, unknown>)[k])}`).join("; ")}
                      </li>
                    ))}
                    {plan.updates.length > 100 && <li className="text-[var(--ink)]/45">…and {plan.updates.length - 100} more</li>}
                  </ul>
                </details>
              )}

              {orderSensitive.length > 0 && (
                <details className="text-xs rounded-lg border border-[var(--amber)]/40 p-2.5" open>
                  <summary className="cursor-pointer font-medium">
                    {orderSensitive.length} part{orderSensitive.length === 1 ? "" : "s"} already ordered or received will change — tell purchasing
                  </summary>
                  <ul className="mt-1.5 space-y-0.5 max-h-32 overflow-y-auto">
                    {orderSensitive.slice(0, 100).map((u) => {
                      const cur = byId.get(u.id) as unknown as Record<string, unknown> | undefined;
                      return (
                        <li key={u.id}>
                          <span className="font-medium">{String(cur?.description ?? "")}</span>
                          {cur?.po_no ? ` (${cur.po_no})` : ""} —{" "}
                          {u.orderSensitive.map((k) => `${fieldName(k)}: ${cur?.[k] ?? "blank"} → ${show(k, (u.patch as Record<string, unknown>)[k])}`).join("; ")}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}

              {plan.rowIds === "mismatch" && (
                <p className="text-xs rounded-lg bg-[var(--paper)] p-2.5">
                  The Row IDs in this file don&apos;t line up with the ones in the tracker — the parts here were numbered
                  before this file existed. Parts are matched by sub-assembly and part no. instead
                  {plan.rowIdClashes > 0 && `, and ${plan.rowIdClashes} new part${plan.rowIdClashes === 1 ? "" : "s"} will get a new Row ID`}.
                  <span className="text-[var(--ink)]/50"> Removing the old starter parts first avoids this.</span>
                </p>
              )}

              {plan.rematched.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-[var(--ink)]/60">
                    {plan.rematched.length} part{plan.rematched.length === 1 ? "" : "s"} recognised despite a changed part no. or sub-assembly
                  </summary>
                  <ul className="mt-2 space-y-0.5 max-h-32 overflow-y-auto">
                    {plan.rematched.map((r) => {
                      const cur = byId.get(r.id);
                      return (
                        <li key={r.id}>
                          <span className="font-medium">{cur?.description}</span> —{" "}
                          {r.how === "part_no_changed"
                            ? `part no. ${cur?.part_no ?? "(blank)"} → ${r.row.part_no ?? "(blank)"}`
                            : `moved from ${cur?.sub_assembly ?? "(none)"} to ${r.row.sub_assembly ?? "(none)"}`}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}

              {(plan.kept.length > 0 || fileWins) && (
                <div className="text-xs rounded-lg bg-[var(--paper)] p-2.5 space-y-1.5">
                  {plan.kept.length > 0 && (
                    <details>
                      <summary className="cursor-pointer font-medium">
                        {plan.kept.length} purchasing value{plan.kept.length === 1 ? "" : "s"} in the tracker differ from the file — keeping the tracker&apos;s
                      </summary>
                      <ul className="mt-1.5 space-y-0.5 max-h-32 overflow-y-auto">
                        {plan.kept.slice(0, 100).map((k, n) => (
                          <li key={n}>
                            <span className="font-medium">{byId.get(k.id)?.description}</span> — {fieldName(k.field)}: tracker{" "}
                            {show(k.field, k.trackerValue)}, file {show(k.field, k.fileValue)}
                          </li>
                        ))}
                        {plan.kept.length > 100 && <li className="text-[var(--ink)]/45">…and {plan.kept.length - 100} more</li>}
                      </ul>
                    </details>
                  )}
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-0.5" checked={fileWins} disabled={busy} onChange={(e) => setFileWins(e.target.checked)} />
                    <span>
                      Take Status, Supplier, PR/PO, ETA and received/issued columns from this file.
                      <span className="text-[var(--ink)]/50">
                        {" "}Right while purchasing is updated in the Excel. Untick to keep what&apos;s in the tracker — the file then only fills blanks and moves status forward.
                      </span>
                    </span>
                  </label>
                </div>
              )}

              {plan.missing.length > 0 && (
                <div className="text-xs rounded-lg bg-[var(--paper)] p-2.5 space-y-1.5">
                  <details>
                    <summary className="cursor-pointer font-medium">
                      {plan.missing.length} part{plan.missing.length === 1 ? "" : "s"} in the tracker {plan.missing.length === 1 ? "is" : "are"} no longer in this file
                    </summary>
                    <ul className="mt-1.5 space-y-0.5 max-h-32 overflow-y-auto">
                      {plan.missing.slice(0, 100).map((m) => (
                        <li key={m.id}>
                          <span className="font-medium">{m.description}</span>
                          {m.part_no && ` · ${m.part_no}`}
                          <span className="text-[var(--ink)]/45"> · {m.sub_assembly ?? "no sub-assembly"} · {BOM_STATUS_LABEL[m.status]}</span>
                        </li>
                      ))}
                      {plan.missing.length > 100 && <li className="text-[var(--ink)]/45">…and {plan.missing.length - 100} more</li>}
                    </ul>
                  </details>
                  {missingOpen.length > 0 ? (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={cancelMissing} disabled={busy} onChange={(e) => setCancelMissing(e.target.checked)} />
                      <span>
                        Mark the {missingOpen.length} not yet ordered as Cancelled.
                        <span className="text-[var(--ink)]/50"> Left unticked, they stay as they are. Nothing is deleted either way.</span>
                      </span>
                    </label>
                  ) : null}
                  {missingOrdered.length > 0 && (
                    <p className="text-[var(--amber)]">
                      {missingOrdered.length} of them {missingOrdered.length === 1 ? "is" : "are"} already ordered or received — not touched. Check with purchasing.
                    </p>
                  )}
                </div>
              )}

              {plan.duplicates.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-[var(--ink)]/60">
                    {plan.duplicates.length} part{plan.duplicates.length === 1 ? "" : "s"} listed more than once in the same sub-assembly — imported as separate lines
                  </summary>
                  <ul className="mt-2 space-y-0.5 max-h-32 overflow-y-auto">
                    {plan.duplicates.slice(0, 100).map((d, n) => (
                      <li key={n}><span className="font-medium">{d.label}</span> — rows {d.rows.join(", ")}</li>
                    ))}
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
            <button onClick={run} disabled={busy || !plan || total === 0} className="btn-primary px-5 py-2 text-sm">
              {busy && read ? "Importing…" : plan ? (total === 0 ? "Nothing to import" : `Import ${total} change${total === 1 ? "" : "s"}`) : "Import"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
