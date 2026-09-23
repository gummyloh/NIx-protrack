"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useInternalAuth } from "@/lib/internalAuth";

// ─── Types ────────────────────────────────────────────────────────────────────

type FatStatus = "pending" | "passed" | "failed" | "in_progress";

interface FatRecord {
  id: string;
  project_id: string;
  title: string;
  target_pcs: number | null;
  run_hours: number | null;
  max_defects: number | null;
  oqc_pqc_pcs: number | null;
  planned_date: string | null;
  actual_date: string | null;
  status: FatStatus;
  actual_pcs: number | null;
  actual_defects: number | null;
  actual_hours: number | null;
  customer_rep: string | null;
  notes: string | null;
  project?: { name: string };
}

interface ChecklistItem {
  id: string;
  fat_id: string;
  category: string;
  item: string;
  status: "pending" | "ok" | "fail" | "na";
  notes: string | null;
  sort_order: number;
}

interface Project {
  id: string;
  name: string;
}

const STATUS_STYLES: Record<FatStatus, string> = {
  pending:     "bg-yellow-100 text-yellow-800",
  in_progress: "bg-blue-100 text-blue-800",
  passed:      "bg-green-100 text-green-800",
  failed:      "bg-red-100 text-red-800",
};

const STATUS_LABELS: Record<FatStatus, string> = {
  pending:     "Pending",
  in_progress: "In Progress",
  passed:      "Passed",
  failed:      "Failed",
};

const CHECKLIST_STATUS_STYLES: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  ok:      "bg-green-100 text-green-700",
  fail:    "bg-red-100 text-red-700",
  na:      "bg-gray-50 text-gray-400",
};

// ─── Default checklist template ───────────────────────────────────────────────

const DEFAULT_CHECKLIST: Omit<ChecklistItem, "id" | "fat_id" | "notes">[] = [
  { category: "Documentation", item: "Test plan approved by customer",        status: "pending", sort_order: 1 },
  { category: "Documentation", item: "BOM / specification sheet available",   status: "pending", sort_order: 2 },
  { category: "Documentation", item: "Serial number list prepared",           status: "pending", sort_order: 3 },
  { category: "Production",    item: "Production line ready & clean",          status: "pending", sort_order: 4 },
  { category: "Production",    item: "All components sourced & verified",      status: "pending", sort_order: 5 },
  { category: "Production",    item: "Target pcs run completed",               status: "pending", sort_order: 6 },
  { category: "Quality",       item: "OQC / PQC inspection count completed",   status: "pending", sort_order: 7 },
  { category: "Quality",       item: "Continuous run hours met (no stoppage)", status: "pending", sort_order: 8 },
  { category: "Quality",       item: "Defect count within limit",              status: "pending", sort_order: 9 },
  { category: "Quality",       item: "Customer witness sign-off obtained",     status: "pending", sort_order: 10 },
  { category: "Handover",      item: "Packing & labelling verified",           status: "pending", sort_order: 11 },
  { category: "Handover",      item: "Delivery schedule confirmed",            status: "pending", sort_order: 12 },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function FatPage() {
  const supabase = createClient();
  const { isAdmin } = useInternalAuth();

  const [records, setRecords]     = useState<FatRecord[]>([]);
  const [projects, setProjects]   = useState<Project[]>([]);
  const [selected, setSelected]   = useState<FatRecord | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showNew, setShowNew]     = useState(false);

  // New FAT form state
  const [form, setForm] = useState({
    project_id:  "",
    title:       "",
    target_pcs:  "",
    oqc_pqc_pcs: "",
    run_hours:   "",
    max_defects: "",
    planned_date:"",
    customer_rep:"",
    notes:       "",
  });

  // ── Load FAT records + projects ────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true);
      const [{ data: recs }, { data: projs }] = await Promise.all([
        supabase
          .schema("nixma")
          .from("fat_records")
          .select("*, project:projects(name)")
          .order("planned_date", { ascending: true }),
        supabase
          .schema("nixma")
          .from("projects")
          .select("id, name")
          .order("name"),
      ]);
      setRecords(recs ?? []);
      setProjects(projs ?? []);
      setLoading(false);
    }
    load();
  }, []);

  // ── Load checklist when a FAT record is selected ───────────────────────────
  useEffect(() => {
    if (!selected) { setChecklist([]); return; }
    supabase
      .schema("nixma")
      .from("fat_checklist_items")
      .select("*")
      .eq("fat_id", selected.id)
      .order("sort_order")
      .then(({ data }) => setChecklist(data ?? []));
  }, [selected]);

  // ── Create new FAT record ──────────────────────────────────────────────────
  async function createFat() {
    if (!form.project_id || !form.title) return;
    const { data: rec, error } = await supabase
      .schema("nixma")
      .from("fat_records")
      .insert({
        project_id:  form.project_id,
        title:       form.title,
        target_pcs:  form.target_pcs  ? Number(form.target_pcs)  : null,
        oqc_pqc_pcs: form.oqc_pqc_pcs ? Number(form.oqc_pqc_pcs) : null,
        run_hours:   form.run_hours   ? Number(form.run_hours)   : null,
        max_defects: form.max_defects ? Number(form.max_defects) : null,
        planned_date:form.planned_date || null,
        customer_rep:form.customer_rep || null,
        notes:       form.notes || null,
        status:      "pending",
      })
      .select("*, project:projects(name)")
      .single();
    if (error || !rec) return;

    // Seed default checklist
    const items = DEFAULT_CHECKLIST.map((c) => ({ ...c, fat_id: rec.id, notes: null }));
    await supabase.schema("nixma").from("fat_checklist_items").insert(items);

    setRecords((r) => [...r, rec]);
    setShowNew(false);
    setForm({ project_id:"", title:"", target_pcs:"", oqc_pqc_pcs:"", run_hours:"", max_defects:"", planned_date:"", customer_rep:"", notes:"" });
    setSelected(rec);
  }

  // ── Update checklist item status ───────────────────────────────────────────
  async function cycleChecklistStatus(item: ChecklistItem) {
    const cycle: ChecklistItem["status"][] = ["pending", "ok", "fail", "na"];
    const next = cycle[(cycle.indexOf(item.status) + 1) % cycle.length];
    setChecklist((prev) => prev.map((c) => c.id === item.id ? { ...c, status: next } : c));
    await supabase
      .schema("nixma")
      .from("fat_checklist_items")
      .update({ status: next })
      .eq("id", item.id);
  }

  // ── Update FAT record status ───────────────────────────────────────────────
  async function updateFatStatus(id: string, status: FatStatus) {
    await supabase.schema("nixma").from("fat_records").update({ status }).eq("id", id);
    setRecords((r) => r.map((rec) => rec.id === id ? { ...rec, status } : rec));
    if (selected?.id === id) setSelected((s) => s ? { ...s, status } : s);
  }

  // ── Update actual results ──────────────────────────────────────────────────
  async function saveActuals(actual_pcs: string, actual_defects: string, actual_hours: string, actual_date: string) {
    if (!selected) return;
    const patch = {
      actual_pcs:    actual_pcs    ? Number(actual_pcs)    : null,
      actual_defects:actual_defects ? Number(actual_defects) : null,
      actual_hours:  actual_hours  ? Number(actual_hours)  : null,
      actual_date:   actual_date   || null,
    };
    await supabase.schema("nixma").from("fat_records").update(patch).eq("id", selected.id);
    setRecords((r) => r.map((rec) => rec.id === selected.id ? { ...rec, ...patch } : rec));
    setSelected((s) => s ? { ...s, ...patch } : s);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const grouped = checklist.reduce<Record<string, ChecklistItem[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  const passCount = checklist.filter((c) => c.status === "ok").length;
  const totalCount = checklist.filter((c) => c.status !== "na").length;

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return <main className="p-8 text-sm text-[var(--ink)]/40">Loading…</main>;

  return (
    <main className="flex h-full overflow-hidden">
      {/* ── Left: FAT record list ── */}
      <aside className="w-72 shrink-0 border-r border-[var(--line)] flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--line)] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--ink)]">FAT / Sign-off</h2>
          {isAdmin && (
            <button
              onClick={() => setShowNew(true)}
              className="text-xs px-2 py-1 rounded bg-[var(--ink)] text-[var(--surface)] hover:opacity-80 transition"
            >
              + New
            </button>
          )}
        </div>

        <ul className="flex-1 overflow-y-auto divide-y divide-[var(--line)]">
          {records.length === 0 && (
            <li className="p-4 text-xs text-[var(--ink)]/40 text-center">No FAT records yet</li>
          )}
          {records.map((rec) => (
            <li
              key={rec.id}
              onClick={() => setSelected(rec)}
              className={`px-4 py-3 cursor-pointer hover:bg-[var(--line)]/30 transition ${selected?.id === rec.id ? "bg-[var(--line)]/40" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[var(--ink)] truncate">{rec.title}</p>
                  <p className="text-[10px] text-[var(--ink)]/50 mt-0.5">{rec.project?.name ?? "—"}</p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-medium ${STATUS_STYLES[rec.status]}`}>
                  {STATUS_LABELS[rec.status]}
                </span>
              </div>
              {rec.planned_date && (
                <p className="text-[10px] text-[var(--ink)]/40 mt-1">
                  📅 {new Date(rec.planned_date).toLocaleDateString("en-MY", { day:"numeric", month:"short", year:"numeric" })}
                </p>
              )}
            </li>
          ))}
        </ul>
      </aside>

      {/* ── Right: FAT detail ── */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-sm text-[var(--ink)]/30">
            Select a FAT record to view details
          </div>
        ) : (
          <FatDetail
            record={selected}
            grouped={grouped}
            passCount={passCount}
            totalCount={totalCount}
            isAdmin={isAdmin}
            onCycleChecklist={cycleChecklistStatus}
            onUpdateStatus={updateFatStatus}
            onSaveActuals={saveActuals}
          />
        )}
      </div>

      {/* ── New FAT modal ── */}
      {showNew && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[var(--ink)]">New FAT Record</h3>

            <div className="space-y-3">
              <Field label="Project *">
                <select
                  value={form.project_id}
                  onChange={(e) => setForm({ ...form, project_id: e.target.value })}
                  className="w-full text-xs border border-[var(--line)] rounded px-2 py-1.5 bg-[var(--surface)] text-[var(--ink)]"
                >
                  <option value="">Select project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>

              <Field label="Title *">
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. MH063 Customer FAT – Dec 2026"
                  className="w-full text-xs border border-[var(--line)] rounded px-2 py-1.5 bg-[var(--surface)] text-[var(--ink)] placeholder:text-[var(--ink)]/30"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Target pcs">
                  <input type="number" value={form.target_pcs} onChange={(e) => setForm({ ...form, target_pcs: e.target.value })} placeholder="2000" className="num-input" />
                </Field>
                <Field label="OQC / PQC pcs">
                  <input type="number" value={form.oqc_pqc_pcs} onChange={(e) => setForm({ ...form, oqc_pqc_pcs: e.target.value })} placeholder="17000" className="num-input" />
                </Field>
                <Field label="Run hours">
                  <input type="number" value={form.run_hours} onChange={(e) => setForm({ ...form, run_hours: e.target.value })} placeholder="4" className="num-input" />
                </Field>
                <Field label="Max defects">
                  <input type="number" value={form.max_defects} onChange={(e) => setForm({ ...form, max_defects: e.target.value })} placeholder="1" className="num-input" />
                </Field>
              </div>

              <Field label="Customer witness date">
                <input type="date" value={form.planned_date} onChange={(e) => setForm({ ...form, planned_date: e.target.value })} className="num-input" />
              </Field>

              <Field label="Customer representative">
                <input value={form.customer_rep} onChange={(e) => setForm({ ...form, customer_rep: e.target.value })} placeholder="Name / company" className="num-input" />
              </Field>

              <Field label="Notes">
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Additional requirements…" className="w-full text-xs border border-[var(--line)] rounded px-2 py-1.5 bg-[var(--surface)] text-[var(--ink)] placeholder:text-[var(--ink)]/30 resize-none" />
              </Field>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowNew(false)} className="text-xs px-3 py-1.5 rounded border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--line)]/30">Cancel</button>
              <button onClick={createFat} className="text-xs px-3 py-1.5 rounded bg-[var(--ink)] text-[var(--surface)] hover:opacity-80">Create</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .num-input {
          width: 100%;
          font-size: 0.75rem;
          border: 1px solid var(--line);
          border-radius: 0.25rem;
          padding: 0.25rem 0.5rem;
          background: var(--surface);
          color: var(--ink);
        }
      `}</style>
    </main>
  );
}

// ─── Sub-component: FAT Detail ────────────────────────────────────────────────

function FatDetail({
  record,
  grouped,
  passCount,
  totalCount,
  isAdmin,
  onCycleChecklist,
  onUpdateStatus,
  onSaveActuals,
}: {
  record: FatRecord;
  grouped: Record<string, ChecklistItem[]>;
  passCount: number;
  totalCount: number;
  isAdmin: boolean;
  onCycleChecklist: (item: ChecklistItem) => void;
  onUpdateStatus: (id: string, status: FatStatus) => void;
  onSaveActuals: (pcs: string, defects: string, hours: string, date: string) => void;
}) {
  const [actuals, setActuals] = useState({
    actual_pcs:     String(record.actual_pcs ?? ""),
    actual_defects: String(record.actual_defects ?? ""),
    actual_hours:   String(record.actual_hours ?? ""),
    actual_date:    record.actual_date ?? "",
  });

  // Sync when record changes
  useEffect(() => {
    setActuals({
      actual_pcs:     String(record.actual_pcs ?? ""),
      actual_defects: String(record.actual_defects ?? ""),
      actual_hours:   String(record.actual_hours ?? ""),
      actual_date:    record.actual_date ?? "",
    });
  }, [record.id]);

  const pct = totalCount > 0 ? Math.round((passCount / totalCount) * 100) : 0;

  const defectOk = record.actual_defects != null && record.max_defects != null
    ? record.actual_defects <= record.max_defects
    : null;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-semibold text-[var(--ink)]">{record.title}</h1>
          <p className="text-xs text-[var(--ink)]/50 mt-0.5">{record.project?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_STYLES[record.status]}`}>
            {STATUS_LABELS[record.status]}
          </span>
          {isAdmin && (
            <select
              value={record.status}
              onChange={(e) => onUpdateStatus(record.id, e.target.value as FatStatus)}
              className="text-xs border border-[var(--line)] rounded px-2 py-1 bg-[var(--surface)] text-[var(--ink)]"
            >
              {(Object.keys(STATUS_LABELS) as FatStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Criteria cards */}
      <section>
        <h2 className="text-xs font-semibold text-[var(--ink)]/50 uppercase tracking-wider mb-3">FAT Criteria</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <CriteriaCard label="Target pcs"      plan={record.target_pcs}  actual={record.actual_pcs}     unit="pcs" lowerIsBetter={false} />
          <CriteriaCard label="OQC / PQC"       plan={record.oqc_pqc_pcs} actual={null}                  unit="pcs" lowerIsBetter={false} />
          <CriteriaCard label="Run hours"        plan={record.run_hours}   actual={record.actual_hours}   unit="hr"  lowerIsBetter={false} />
          <CriteriaCard label="Max defects"      plan={record.max_defects} actual={record.actual_defects} unit=""    lowerIsBetter={true}  />
        </div>
      </section>

      {/* Dates / customer */}
      <section className="grid grid-cols-2 gap-4">
        <InfoRow label="Customer witness" value={record.customer_rep ?? "—"} />
        <InfoRow label="Planned date"     value={record.planned_date ? new Date(record.planned_date).toLocaleDateString("en-MY", { day:"numeric", month:"long", year:"numeric" }) : "—"} />
        {record.actual_date && (
          <InfoRow label="Actual date" value={new Date(record.actual_date).toLocaleDateString("en-MY", { day:"numeric", month:"long", year:"numeric" })} />
        )}
        {record.notes && (
          <div className="col-span-2">
            <p className="text-[10px] text-[var(--ink)]/40 uppercase font-semibold tracking-wider mb-1">Notes</p>
            <p className="text-xs text-[var(--ink)]/70">{record.notes}</p>
          </div>
        )}
      </section>

      {/* Record actuals (admin only) */}
      {isAdmin && (
        <section className="border border-[var(--line)] rounded-lg p-4 space-y-3">
          <h2 className="text-xs font-semibold text-[var(--ink)]/50 uppercase tracking-wider">Record Actuals</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { key: "actual_pcs",     label: "Actual pcs",     type: "number" },
              { key: "actual_defects", label: "Actual defects", type: "number" },
              { key: "actual_hours",   label: "Actual hours",   type: "number" },
              { key: "actual_date",    label: "Actual date",    type: "date"   },
            ].map(({ key, label, type }) => (
              <div key={key}>
                <label className="text-[10px] text-[var(--ink)]/50 block mb-1">{label}</label>
                <input
                  type={type}
                  value={(actuals as Record<string, string>)[key]}
                  onChange={(e) => setActuals((a) => ({ ...a, [key]: e.target.value }))}
                  className="w-full text-xs border border-[var(--line)] rounded px-2 py-1 bg-[var(--surface)] text-[var(--ink)]"
                />
              </div>
            ))}
          </div>
          <button
            onClick={() => onSaveActuals(actuals.actual_pcs, actuals.actual_defects, actuals.actual_hours, actuals.actual_date)}
            className="text-xs px-3 py-1.5 rounded bg-[var(--ink)] text-[var(--surface)] hover:opacity-80"
          >
            Save actuals
          </button>
          {defectOk !== null && (
            <p className={`text-xs font-medium ${defectOk ? "text-green-600" : "text-red-600"}`}>
              {defectOk ? "✓ Defect count within limit" : "✗ Defect count exceeds limit"}
            </p>
          )}
        </section>
      )}

      {/* Checklist */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-[var(--ink)]/50 uppercase tracking-wider">Sign-off Checklist</h2>
          <span className="text-xs text-[var(--ink)]/50">{passCount} / {totalCount} passed ({pct}%)</span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-[var(--line)] mb-4 overflow-hidden">
          <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>

        <div className="space-y-4">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <p className="text-[10px] font-semibold text-[var(--ink)]/40 uppercase tracking-wider mb-2">{category}</p>
              <ul className="space-y-1">
                {items.map((item) => (
                  <li key={item.id} className="flex items-center gap-3">
                    <button
                      onClick={() => onCycleChecklist(item)}
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 cursor-pointer hover:opacity-80 transition ${CHECKLIST_STATUS_STYLES[item.status]}`}
                    >
                      {item.status === "ok" ? "✓ OK" : item.status === "fail" ? "✗ Fail" : item.status === "na" ? "N/A" : "Pending"}
                    </button>
                    <span className="text-xs text-[var(--ink)]">{item.item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Mini helpers ──────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] text-[var(--ink)]/50 block mb-1">{label}</label>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-[var(--ink)]/40 uppercase font-semibold tracking-wider">{label}</p>
      <p className="text-xs text-[var(--ink)] mt-0.5">{value}</p>
    </div>
  );
}

function CriteriaCard({ label, plan, actual, unit, lowerIsBetter }: {
  label: string;
  plan: number | null;
  actual: number | null;
  unit: string;
  lowerIsBetter: boolean;
}) {
  const met = plan != null && actual != null
    ? lowerIsBetter ? actual <= plan : actual >= plan
    : null;

  return (
    <div className="border border-[var(--line)] rounded-lg p-3 space-y-1">
      <p className="text-[10px] text-[var(--ink)]/40 uppercase font-semibold tracking-wider">{label}</p>
      <p className="text-sm font-semibold text-[var(--ink)]">
        {plan != null ? `${plan.toLocaleString()}${unit ? " " + unit : ""}` : "—"}
      </p>
      {actual != null && (
        <p className={`text-xs font-medium ${met === true ? "text-green-600" : met === false ? "text-red-500" : "text-[var(--ink)]/60"}`}>
          Actual: {actual.toLocaleString()}{unit ? " " + unit : ""} {met === true ? "✓" : met === false ? "✗" : ""}
        </p>
      )}
    </div>
  );
}
