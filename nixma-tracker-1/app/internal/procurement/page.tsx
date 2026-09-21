"use client";

import { useEffect, useState, useRef } from "react";
import { useProjectId } from "@/lib/useProjectId";
import { supabase } from "@/lib/supabase";
import {
  ProcurementPo,
  ProcurementFabItem,
  ProcurementRfq,
  ProcurementQuote,
  ProcurementBudget,
  AiScanResult,
  PoStatus,
  FabStatus,
} from "@/lib/types";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(val: number | null, currency = "MYR") {
  if (val == null) return "—";
  return `${currency} ${val.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function DeliveryBadge({ dateStr, status }: { dateStr: string | null; status: PoStatus }) {
  if (status === "received" || status === "closed" || status === "cancelled") return null;
  const days = daysUntil(dateStr);
  if (days == null) return null;
  const color =
    days < 0 ? "bg-red-500/15 text-red-400" :
    days <= 3 ? "bg-orange-500/15 text-orange-400" :
    "bg-emerald-500/15 text-emerald-400";
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `${days}d left`;
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${color}`}>{label}</span>;
}

const PO_STATUS_COLOR: Record<PoStatus, string> = {
  draft:      "bg-[var(--surface)] text-[var(--ink)]/50",
  issued:     "bg-blue-500/15 text-blue-400",
  partial:    "bg-yellow-500/15 text-yellow-400",
  received:   "bg-emerald-500/15 text-emerald-400",
  closed:     "bg-[var(--surface)] text-[var(--ink)]/40",
  cancelled:  "bg-red-500/15 text-red-400",
};

const FAB_STATUS_COLOR: Record<FabStatus, string> = {
  not_started:    "bg-[var(--surface)] text-[var(--ink)]/50",
  in_fabrication: "bg-blue-500/15 text-blue-400",
  qc:             "bg-yellow-500/15 text-yellow-400",
  ready:          "bg-emerald-500/15 text-emerald-400",
  delivered:      "bg-emerald-500/15 text-emerald-400",
  cancelled:      "bg-red-500/15 text-red-400",
};

const FAB_STATUS_LABEL: Record<FabStatus, string> = {
  not_started: "Not Started",
  in_fabrication: "In Fab",
  qc: "QC",
  ready: "Ready",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

type Tab = "pos" | "fab" | "rfq" | "budget";

// ─── main component ────────────────────────────────────────────────────────────

export default function ProcurementPage() {
  const projectId = useProjectId();
  const [tab, setTab] = useState<Tab>("pos");

  // Data
  const [pos, setPos] = useState<ProcurementPo[]>([]);
  const [fab, setFab] = useState<ProcurementFabItem[]>([]);
  const [rfqs, setRfqs] = useState<ProcurementRfq[]>([]);
  const [quotes, setQuotes] = useState<ProcurementQuote[]>([]);
  const [budget, setBudget] = useState<ProcurementBudget[]>([]);
  const [loading, setLoading] = useState(true);

  // AI scan state
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<AiScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Compare state
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<Record<number, unknown> | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [selectedRfqForCompare, setSelectedRfqForCompare] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    const [posRes, fabRes, rfqRes, quotesRes, budgetRes] = await Promise.all([
      supabase.schema("nixma").from("procurement_pos").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.schema("nixma").from("procurement_fab_items").select("*").eq("project_id", projectId).order("expected_completion"),
      supabase.schema("nixma").from("procurement_rfq").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.schema("nixma").from("procurement_quotes").select("*").eq("project_id", projectId).order("created_at"),
      supabase.schema("nixma").from("procurement_budget").select("*").eq("project_id", projectId),
    ]);
    setPos((posRes.data as ProcurementPo[]) || []);
    setFab((fabRes.data as ProcurementFabItem[]) || []);
    setRfqs((rfqRes.data as ProcurementRfq[]) || []);
    setQuotes((quotesRes.data as ProcurementQuote[]) || []);
    setBudget((budgetRes.data as ProcurementBudget[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [projectId]);

  // ── Cost summary ─────────────────────────────────────────────────────────────

  const totalCommitted = pos
    .filter((p) => !["cancelled", "draft"].includes(p.status))
    .reduce((s, p) => s + (p.total_price || 0), 0);

  const totalBudget = budget.reduce((s, b) => s + b.budgeted_amount, 0);

  const totalFabCost = fab
    .filter((f) => f.status !== "cancelled")
    .reduce((s, f) => s + (f.cost || 0), 0);

  // ── AI scan ──────────────────────────────────────────────────────────────────

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanError(null);
    setScanResult(null);
    setScanning(true);
    setShowScanModal(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setScanError("Not signed in."); setScanning(false); return; }

      try {
        const res = await fetch("/api/ai/procurement-scan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            file_base64: base64,
            media_type: file.type,
            project_id: projectId,
          }),
        });
        const json = await res.json();
        if (!json.ok) { setScanError(json.error); }
        else { setScanResult(json.result as AiScanResult); }
      } catch (err) {
        setScanError(err instanceof Error ? err.message : "Scan failed.");
      } finally {
        setScanning(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  }

  async function saveScanAsPo() {
    if (!scanResult) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await supabase.schema("nixma").from("procurement_pos").insert({
      project_id: projectId,
      supplier_name: scanResult.supplier_name || "Unknown Supplier",
      item_description: scanResult.item_description || "Scanned item",
      category: scanResult.category,
      quantity: scanResult.quantity,
      unit: scanResult.unit,
      unit_price: scanResult.unit_price,
      total_price: scanResult.total_price,
      currency: scanResult.currency || "MYR",
      payment_terms: scanResult.payment_terms,
      date_ordered: scanResult.date_ordered,
      expected_delivery: scanResult.expected_delivery,
      po_number: scanResult.po_number,
      status: "draft",
      extracted_by_ai: true,
      raw_ai_json: scanResult as unknown as Record<string, unknown>,
      created_by: session.user.id,
    });

    setShowScanModal(false);
    setScanResult(null);
    load();
  }

  async function saveScanAsFab() {
    if (!scanResult) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await supabase.schema("nixma").from("procurement_fab_items").insert({
      project_id: projectId,
      item_name: scanResult.item_description || "Scanned fab item",
      drawing_ref: scanResult.drawing_ref,
      fab_vendor: scanResult.supplier_name,
      category: scanResult.category,
      cost: scanResult.cost || scanResult.total_price,
      currency: scanResult.currency || "MYR",
      expected_completion: scanResult.expected_completion,
      status: "not_started",
      extracted_by_ai: true,
      raw_ai_json: scanResult as unknown as Record<string, unknown>,
      created_by: session.user.id,
    });

    setShowScanModal(false);
    setScanResult(null);
    load();
  }

  // ── AI compare ───────────────────────────────────────────────────────────────

  async function handleCompare(rfqId: number) {
    setComparing(true);
    setCompareError(null);
    setCompareResult(null);
    setSelectedRfqForCompare(rfqId);

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setCompareError("Not signed in."); setComparing(false); return; }

    try {
      const res = await fetch("/api/ai/procurement-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rfq_id: rfqId, project_id: projectId }),
      });
      const json = await res.json();
      if (!json.ok) setCompareError(json.error);
      else setCompareResult(json.comparison as Record<number, unknown>);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : "Compare failed.");
    } finally {
      setComparing(false);
    }
  }

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <main className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-[var(--ink)]">Procurement</h1>
          <p className="text-sm text-[var(--ink)]/50 mt-0.5">Cost tracking, POs, fabrication and quote comparison</p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <span>📄</span> Scan Document
        </button>
        <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFilePick} />
      </div>

      {/* Cost Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Budget", value: fmt(totalBudget), sub: `${budget.length} categories` },
          { label: "POs Committed", value: fmt(totalCommitted), sub: `${pos.filter(p => !['cancelled','draft'].includes(p.status)).length} active POs` },
          { label: "Fab Cost", value: fmt(totalFabCost), sub: `${fab.filter(f => f.status !== 'cancelled').length} items` },
          { label: "Open RFQs", value: String(rfqs.filter(r => r.status === 'open').length), sub: `${rfqs.length} total` },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)]">
            <p className="text-[11px] text-[var(--ink)]/50 uppercase tracking-wide font-mono">{label}</p>
            <p className="text-xl font-semibold text-[var(--ink)] mt-1">{value}</p>
            <p className="text-[11px] text-[var(--ink)]/40 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {(["pos", "fab", "rfq", "budget"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--ink)]/50 hover:text-[var(--ink)]"
            }`}
          >
            {t === "pos" ? "Purchase Orders" : t === "fab" ? "Fabrication" : t === "rfq" ? "RFQ / Quotes" : "Budget"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ink)]/40 py-8 text-center">Loading…</p>
      ) : (
        <>
          {/* ── PO Tab ── */}
          {tab === "pos" && (
            <div className="space-y-2">
              {pos.length === 0 && (
                <p className="text-sm text-[var(--ink)]/40 py-8 text-center">No purchase orders yet. Scan a document to create one.</p>
              )}
              {pos.map((po) => (
                <div key={po.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-wrap gap-3 items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${PO_STATUS_COLOR[po.status]}`}>
                        {po.status.toUpperCase()}
                      </span>
                      {po.extracted_by_ai && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-medium">AI</span>
                      )}
                      {po.po_number && <span className="text-xs text-[var(--ink)]/40">{po.po_number}</span>}
                    </div>
                    <p className="font-medium text-[var(--ink)] mt-1">{po.item_description}</p>
                    <p className="text-sm text-[var(--ink)]/60">{po.supplier_name}</p>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      {po.expected_delivery && (
                        <span className="text-xs text-[var(--ink)]/50">
                          Delivery: {new Date(po.expected_delivery).toLocaleDateString("en-MY")}
                        </span>
                      )}
                      <DeliveryBadge dateStr={po.expected_delivery} status={po.status} />
                      {po.payment_terms && <span className="text-xs text-[var(--ink)]/40">{po.payment_terms}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-semibold text-[var(--ink)]">{fmt(po.total_price, po.currency)}</p>
                    {po.category && <p className="text-xs text-[var(--ink)]/40">{po.category}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Fab Tab ── */}
          {tab === "fab" && (
            <div className="space-y-2">
              {fab.length === 0 && (
                <p className="text-sm text-[var(--ink)]/40 py-8 text-center">No fabrication items yet.</p>
              )}
              {fab.map((f) => (
                <div key={f.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-wrap gap-3 items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${FAB_STATUS_COLOR[f.status]}`}>
                        {FAB_STATUS_LABEL[f.status]}
                      </span>
                      {f.extracted_by_ai && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-medium">AI</span>
                      )}
                      {f.drawing_ref && <span className="text-xs text-[var(--ink)]/40">DWG: {f.drawing_ref}</span>}
                    </div>
                    <p className="font-medium text-[var(--ink)] mt-1">{f.item_name}</p>
                    {f.fab_vendor && <p className="text-sm text-[var(--ink)]/60">{f.fab_vendor}</p>}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      {f.expected_completion && (
                        <span className="text-xs text-[var(--ink)]/50">
                          Due: {new Date(f.expected_completion).toLocaleDateString("en-MY")}
                        </span>
                      )}
                      {f.quantity && <span className="text-xs text-[var(--ink)]/40">Qty: {f.quantity}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-semibold text-[var(--ink)]">{fmt(f.cost, f.currency)}</p>
                    {f.category && <p className="text-xs text-[var(--ink)]/40">{f.category}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── RFQ Tab ── */}
          {tab === "rfq" && (
            <div className="space-y-4">
              {rfqs.length === 0 && (
                <p className="text-sm text-[var(--ink)]/40 py-8 text-center">No RFQs yet. Scan multiple supplier quotes for the same item to compare them.</p>
              )}
              {rfqs.map((rfq) => {
                const rfqQuotes = quotes.filter((q) => q.rfq_id === rfq.id);
                const isSelected = selectedRfqForCompare === rfq.id;
                const comparison = isSelected ? compareResult : null;

                return (
                  <div key={rfq.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                    {/* RFQ header */}
                    <div className="p-4 flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${rfq.status === 'awarded' ? 'bg-emerald-500/15 text-emerald-400' : rfq.status === 'cancelled' ? 'bg-red-500/15 text-red-400' : 'bg-blue-500/15 text-blue-400'}`}>
                            {rfq.status.toUpperCase()}
                          </span>
                          {rfq.category && <span className="text-xs text-[var(--ink)]/40">{rfq.category}</span>}
                        </div>
                        <p className="font-medium text-[var(--ink)] mt-1">{rfq.item_description}</p>
                        {rfq.quantity && <p className="text-xs text-[var(--ink)]/50">Qty: {rfq.quantity} {rfq.unit || ""}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-[var(--ink)]/50">{rfqQuotes.length} quote{rfqQuotes.length !== 1 ? "s" : ""}</span>
                        {rfqQuotes.length >= 2 && rfq.status === "open" && (
                          <button
                            onClick={() => handleCompare(rfq.id)}
                            disabled={comparing && isSelected}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                          >
                            {comparing && isSelected ? "Comparing…" : "🤖 AI Compare"}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Quotes table */}
                    {rfqQuotes.length > 0 && (
                      <div className="border-t border-[var(--border)] overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[var(--border)] bg-[var(--paper)]">
                              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--ink)]/50">Supplier</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-[var(--ink)]/50">Unit Price</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-[var(--ink)]/50">Total</th>
                              <th className="px-4 py-2 text-center text-xs font-medium text-[var(--ink)]/50">Lead Time</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--ink)]/50">Payment</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rfqQuotes.map((q) => {
                              const isWinner = rfq.selected_quote_id === q.id;
                              return (
                                <tr key={q.id} className={`border-b border-[var(--border)] last:border-0 ${isWinner ? "bg-emerald-500/5" : ""}`}>
                                  <td className="px-4 py-2.5">
                                    <div className="flex items-center gap-1.5">
                                      {isWinner && <span className="text-emerald-400">✓</span>}
                                      <span className={isWinner ? "font-medium text-[var(--ink)]" : "text-[var(--ink)]/80"}>{q.supplier_name}</span>
                                      {q.extracted_by_ai && <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/15 text-purple-400">AI</span>}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(q.unit_price, q.currency)}</td>
                                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmt(q.total_price, q.currency)}</td>
                                  <td className="px-4 py-2.5 text-center">{q.lead_time_days != null ? `${q.lead_time_days}d` : "—"}</td>
                                  <td className="px-4 py-2.5 text-[var(--ink)]/60">{q.payment_terms || "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* AI comparison result */}
                    {isSelected && (
                      <div className="border-t border-[var(--border)] p-4 bg-[var(--paper)]">
                        {compareError && (
                          <p className="text-sm text-red-400">{compareError}</p>
                        )}
                        {comparison && (comparison as { summary?: string; recommendation?: { supplier_name: string; reason: string }; risks?: string[] }).summary && (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-[var(--ink)]">🤖 AI Analysis</span>
                            </div>
                            <p className="text-sm text-[var(--ink)]/70">{(comparison as { summary: string }).summary}</p>
                            {(comparison as { recommendation?: { supplier_name: string; reason: string } }).recommendation && (
                              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                                <p className="text-sm font-medium text-emerald-400">
                                  Recommended: {(comparison as { recommendation: { supplier_name: string; reason: string } }).recommendation.supplier_name}
                                </p>
                                <p className="text-sm text-[var(--ink)]/70 mt-1">{(comparison as { recommendation: { supplier_name: string; reason: string } }).recommendation.reason}</p>
                              </div>
                            )}
                            {(comparison as { risks?: string[] }).risks?.length ? (
                              <div>
                                <p className="text-xs font-medium text-[var(--ink)]/50 uppercase tracking-wide mb-1">Risks to note</p>
                                <ul className="space-y-1">
                                  {(comparison as { risks: string[] }).risks.map((r: string, i: number) => (
                                    <li key={i} className="text-sm text-[var(--ink)]/70 flex gap-2">
                                      <span className="text-orange-400 shrink-0">⚠</span>{r}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Budget Tab ── */}
          {tab === "budget" && (
            <div className="space-y-2">
              {budget.length === 0 && (
                <p className="text-sm text-[var(--ink)]/40 py-8 text-center">No budget categories set.</p>
              )}
              {budget.map((b) => {
                const spent = pos
                  .filter((p) => p.category === b.category && !["cancelled", "draft"].includes(p.status))
                  .reduce((s, p) => s + (p.total_price || 0), 0);
                const pct = b.budgeted_amount > 0 ? Math.min(100, (spent / b.budgeted_amount) * 100) : 0;
                const over = spent > b.budgeted_amount;

                return (
                  <div key={b.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-[var(--ink)]">{b.category}</p>
                      <div className="text-right">
                        <p className={`text-sm font-medium ${over ? "text-red-400" : "text-[var(--ink)]"}`}>{fmt(spent, b.currency)}</p>
                        <p className="text-xs text-[var(--ink)]/40">of {fmt(b.budgeted_amount, b.currency)}</p>
                      </div>
                    </div>
                    <div className="w-full bg-[var(--border)] rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${over ? "bg-red-500" : pct > 80 ? "bg-orange-400" : "bg-emerald-400"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-xs text-[var(--ink)]/40 mt-1">{pct.toFixed(0)}% used</p>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── AI Scan Modal ── */}
      {showScanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[var(--paper)] rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--ink)]">AI Document Scan</h2>
              <button onClick={() => { setShowScanModal(false); setScanResult(null); setScanError(null); }} className="text-[var(--ink)]/40 hover:text-[var(--ink)] text-xl">×</button>
            </div>

            {scanning && (
              <div className="py-8 text-center space-y-2">
                <div className="text-3xl animate-pulse">🔍</div>
                <p className="text-sm text-[var(--ink)]/60">Reading document with AI…</p>
              </div>
            )}

            {scanError && !scanning && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <p className="text-sm text-red-400">{scanError}</p>
              </div>
            )}

            {scanResult && !scanning && (
              <div className="space-y-4">
                {/* Detected type badge */}
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2.5 py-1 rounded-full bg-purple-500/15 text-purple-400 font-medium capitalize">
                    📄 {scanResult.document_type.replace(/_/g, " ")} detected
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    scanResult.confidence === "high" ? "bg-emerald-500/15 text-emerald-400" :
                    scanResult.confidence === "medium" ? "bg-yellow-500/15 text-yellow-400" :
                    "bg-red-500/15 text-red-400"
                  }`}>
                    {scanResult.confidence} confidence
                  </span>
                </div>

                {/* Extracted fields */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {[
                    ["Supplier", scanResult.supplier_name],
                    ["Item", scanResult.item_description],
                    ["Category", scanResult.category],
                    ["Qty", scanResult.quantity != null ? `${scanResult.quantity} ${scanResult.unit || ""}` : null],
                    ["Unit Price", scanResult.unit_price != null ? `${scanResult.currency || "MYR"} ${scanResult.unit_price}` : null],
                    ["Total", scanResult.total_price != null ? `${scanResult.currency || "MYR"} ${scanResult.total_price}` : null],
                    ["Lead Time", scanResult.lead_time_days != null ? `${scanResult.lead_time_days} days` : null],
                    ["Payment", scanResult.payment_terms],
                    ["Delivery", scanResult.expected_delivery],
                    ["PO Number", scanResult.po_number],
                    ["Drawing", scanResult.drawing_ref],
                  ].map(([label, value]) => value ? (
                    <div key={label as string}>
                      <p className="text-[11px] text-[var(--ink)]/40 uppercase tracking-wide">{label}</p>
                      <p className="text-[var(--ink)] font-medium truncate">{value}</p>
                    </div>
                  ) : null)}
                </div>

                {scanResult.notes && (
                  <p className="text-xs text-[var(--ink)]/50 bg-[var(--surface)] rounded-lg p-2.5">{scanResult.notes}</p>
                )}

                {/* Save buttons */}
                <div className="flex gap-2 pt-1">
                  {["quotation", "purchase_order", "delivery_order", "invoice", "receipt"].includes(scanResult.document_type) && (
                    <button
                      onClick={saveScanAsPo}
                      className="flex-1 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90"
                    >
                      Save as PO
                    </button>
                  )}
                  {["fabrication_order"].includes(scanResult.document_type) && (
                    <button
                      onClick={saveScanAsFab}
                      className="flex-1 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90"
                    >
                      Save as Fab Item
                    </button>
                  )}
                  {scanResult.document_type === "unknown" && (
                    <>
                      <button onClick={saveScanAsPo} className="flex-1 px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-sm">Save as PO</button>
                      <button onClick={saveScanAsFab} className="flex-1 px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-sm">Save as Fab</button>
                    </>
                  )}
                  <button
                    onClick={() => { setShowScanModal(false); setScanResult(null); }}
                    className="px-4 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-sm text-[var(--ink)]/60 hover:text-[var(--ink)]"
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
