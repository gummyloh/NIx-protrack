"use client";

import { useEffect, useState } from "react";
import { useProjectId } from "@/lib/useProjectId";
import { supabase } from "@/lib/supabase";

// ─── types ────────────────────────────────────────────────────────────────────

type TestResult = "pass" | "fail" | "retest";

interface HeliumTestRow {
  id: number;
  project_id: string;
  serial_number: string | null;
  part_number: string | null;
  description: string | null;
  result: TestResult;
  leak_rate: number | null;
  leak_rate_unit: string;
  test_pressure: number | null;
  test_pressure_unit: string | null;
  test_duration_s: number | null;
  chamber_id: string | null;
  operator: string | null;
  test_date: string;
  notes: string | null;
  created_at: string;
}

const RESULT_COLOR: Record<TestResult, string> = {
  pass:   "bg-emerald-500/15 text-emerald-400",
  fail:   "bg-red-500/15 text-red-400",
  retest: "bg-yellow-500/15 text-yellow-400",
};

const RESULT_LABEL: Record<TestResult, string> = {
  pass: "PASS", fail: "FAIL", retest: "RETEST",
};

// Scientific notation formatter for leak rates
function fmtLeakRate(val: number | null, unit: string): string {
  if (val == null) return "—";
  // Express in scientific notation if very small
  if (val !== 0 && Math.abs(val) < 0.001) {
    return `${val.toExponential(2)} ${unit}`;
  }
  return `${val} ${unit}`;
}

// ─── form ─────────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  serial_number: "", part_number: "", description: "",
  result: "pass" as TestResult,
  leak_rate: "", leak_rate_unit: "mbar·l/s",
  test_pressure: "", test_pressure_unit: "bar",
  test_duration_s: "", chamber_id: "", operator: "",
  test_date: new Date().toISOString().split("T")[0],
  notes: "",
};

function TestModal({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const projectId = useProjectId();
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof typeof EMPTY_FORM, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function save() {
    if (!form.result) { setError("Result is required."); return; }
    setSaving(true); setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError("Not signed in."); setSaving(false); return; }

    const { error: err } = await supabase.schema("nixma").from("helium_test_results").insert({
      project_id:        projectId,
      serial_number:     form.serial_number || null,
      part_number:       form.part_number || null,
      description:       form.description || null,
      result:            form.result,
      leak_rate:         form.leak_rate ? parseFloat(form.leak_rate) : null,
      leak_rate_unit:    form.leak_rate_unit,
      test_pressure:     form.test_pressure ? parseFloat(form.test_pressure) : null,
      test_pressure_unit: form.test_pressure_unit || null,
      test_duration_s:   form.test_duration_s ? parseInt(form.test_duration_s) : null,
      chamber_id:        form.chamber_id || null,
      operator:          form.operator || null,
      test_date:         form.test_date,
      notes:             form.notes || null,
      created_by:        session.user.id,
    });

    if (err) { setError(err.message); setSaving(false); return; }
    onSave();
  }

  const inputCls = "w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--paper)] text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30";
  const labelCls = "block text-xs font-medium text-[var(--ink)]/60 mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--paper)] rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--paper)] px-6 pt-5 pb-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--ink)]">Log Test Result</h2>
          <button onClick={onClose} className="text-[var(--ink)]/40 hover:text-[var(--ink)] text-xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-4">
          {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3">{error}</p>}

          {/* Result selector — biggest UI element */}
          <div>
            <label className={labelCls}>Test Result *</label>
            <div className="grid grid-cols-3 gap-2">
              {(["pass", "fail", "retest"] as TestResult[]).map(r => (
                <button key={r} onClick={() => set("result", r)}
                  className={`py-3 rounded-xl font-bold text-sm border-2 transition-all ${
                    form.result === r
                      ? r === "pass"   ? "border-emerald-400 bg-emerald-500/15 text-emerald-400"
                      : r === "fail"   ? "border-red-400 bg-red-500/15 text-red-400"
                                       : "border-yellow-400 bg-yellow-500/15 text-yellow-400"
                      : "border-[var(--border)] text-[var(--ink)]/40 hover:border-[var(--ink)]/30"
                  }`}>
                  {RESULT_LABEL[r]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelCls}>Description / Part Name</label>
              <input value={form.description} onChange={e => set("description", e.target.value)}
                placeholder="e.g. Evaporator coil assembly" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Serial Number</label>
              <input value={form.serial_number} onChange={e => set("serial_number", e.target.value)}
                placeholder="S/N" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Part Number</label>
              <input value={form.part_number} onChange={e => set("part_number", e.target.value)}
                placeholder="P/N" className={inputCls} />
            </div>

            {/* Leak rate */}
            <div>
              <label className={labelCls}>Leak Rate</label>
              <input type="number" value={form.leak_rate} onChange={e => set("leak_rate", e.target.value)}
                placeholder="e.g. 2.3e-7" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Unit</label>
              <select value={form.leak_rate_unit} onChange={e => set("leak_rate_unit", e.target.value)} className={inputCls}>
                {["mbar·l/s", "Pa·m³/s", "atm·cc/s", "Torr·l/s"].map(u => <option key={u}>{u}</option>)}
              </select>
            </div>

            {/* Pressure */}
            <div>
              <label className={labelCls}>Test Pressure</label>
              <input type="number" value={form.test_pressure} onChange={e => set("test_pressure", e.target.value)}
                placeholder="e.g. 1.5" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Pressure Unit</label>
              <select value={form.test_pressure_unit} onChange={e => set("test_pressure_unit", e.target.value)} className={inputCls}>
                {["bar", "kPa", "MPa", "psi"].map(u => <option key={u}>{u}</option>)}
              </select>
            </div>

            <div>
              <label className={labelCls}>Duration (seconds)</label>
              <input type="number" value={form.test_duration_s} onChange={e => set("test_duration_s", e.target.value)}
                placeholder="e.g. 30" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Chamber / Station</label>
              <input value={form.chamber_id} onChange={e => set("chamber_id", e.target.value)}
                placeholder="e.g. CH-A" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Operator</label>
              <input value={form.operator} onChange={e => set("operator", e.target.value)}
                placeholder="Name" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Test Date</label>
              <input type="date" value={form.test_date} onChange={e => set("test_date", e.target.value)} className={inputCls} />
            </div>

            <div className="col-span-2">
              <label className={labelCls}>Notes / Remarks</label>
              <textarea value={form.notes} onChange={e => set("notes", e.target.value)}
                rows={2} placeholder="Leak location, remediation action, etc."
                className={`${inputCls} resize-none`} />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-[var(--paper)] px-6 pb-5 pt-4 border-t border-[var(--border)] flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--ink)]/60 hover:text-[var(--ink)]">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-5 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : "Log Result"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── main page ─────────────────────────────────────────────────────────────────

export default function HeliumPage() {
  const projectId = useProjectId();
  const [results, setResults] = useState<HeliumTestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filterResult, setFilterResult] = useState<TestResult | "all">("all");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    const { data } = await supabase.schema("nixma").from("helium_test_results")
      .select("*").eq("project_id", projectId)
      .order("test_date", { ascending: false })
      .order("created_at", { ascending: false });
    setResults((data as HeliumTestRow[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [projectId]);

  const filtered = results.filter(r => {
    if (filterResult !== "all" && r.result !== filterResult) return false;
    if (search.trim()) {
      const hay = `${r.serial_number} ${r.part_number} ${r.description} ${r.operator} ${r.chamber_id}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  // Stats
  const total  = results.length;
  const passed = results.filter(r => r.result === "pass").length;
  const failed = results.filter(r => r.result === "fail").length;
  const retest = results.filter(r => r.result === "retest").length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : null;

  return (
    <main className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--ink)]">Helium Leak Test</h1>
          <p className="text-sm text-[var(--ink)]/50 mt-0.5">Test results log — pass/fail, leak rate, traceability</p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90">
          + Log Result
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Tested", value: String(total), color: "text-[var(--ink)]" },
          { label: "Pass", value: String(passed), color: "text-emerald-400" },
          { label: "Fail", value: String(failed), color: "text-red-400" },
          { label: "Pass Rate", value: passRate != null ? `${passRate}%` : "—", color: passRate != null && passRate >= 95 ? "text-emerald-400" : passRate != null && passRate >= 80 ? "text-orange-400" : "text-red-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
            <p className="text-[11px] text-[var(--ink)]/50 uppercase tracking-wide font-mono">{label}</p>
            <p className={`text-2xl font-semibold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search S/N, part, operator…"
          className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--paper)] text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 w-56" />
        <div className="flex gap-1">
          {(["all", "pass", "fail", "retest"] as const).map(f => (
            <button key={f} onClick={() => setFilterResult(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                filterResult === f
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)]/60 hover:text-[var(--ink)]"
              }`}>
              {f === "all" ? "All" : RESULT_LABEL[f]}
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--ink)]/40">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Results list */}
      {loading ? (
        <p className="text-sm text-[var(--ink)]/40 py-8 text-center">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[var(--ink)]/40 py-8 text-center">
          {total === 0 ? "No test results logged yet. Click '+ Log Result' to start." : "No results match your filter."}
        </p>
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--paper)]">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ink)]/50">Date</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ink)]/50">S/N</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ink)]/50">Description</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium text-[var(--ink)]/50">Result</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--ink)]/50">Leak Rate</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium text-[var(--ink)]/50">Chamber</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ink)]/50">Operator</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ink)]/50">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--paper)]/50">
                    <td className="px-4 py-2.5 text-xs font-mono text-[var(--ink)]/60 whitespace-nowrap">
                      {new Date(r.test_date).toLocaleDateString("en-MY")}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.serial_number || "—"}</td>
                    <td className="px-4 py-2.5 max-w-[180px]">
                      <p className="font-medium truncate">{r.description || "—"}</p>
                      {r.part_number && <p className="text-xs text-[var(--ink)]/40">{r.part_number}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${RESULT_COLOR[r.result]}`}>
                        {RESULT_LABEL[r.result]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                      {fmtLeakRate(r.leak_rate, r.leak_rate_unit)}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs text-[var(--ink)]/60">{r.chamber_id || "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--ink)]/60">{r.operator || "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--ink)]/50 max-w-[160px] truncate">{r.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <TestModal
          onClose={() => setShowModal(false)}
          onSave={() => { setShowModal(false); load(); }}
        />
      )}
    </main>
  );
}
