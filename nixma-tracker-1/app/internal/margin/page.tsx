"use client";

import { useEffect, useState } from "react";
import { useProjectId } from "@/lib/useProjectId";
import { supabase } from "@/lib/supabase";
import { ProcurementPo, ProcurementFabItem, ProcurementBudget } from "@/lib/types";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(val: number | null | undefined, currency = "MYR") {
  if (val == null) return "—";
  return `${currency} ${Number(val).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full bg-[var(--border)] rounded-full h-2">
      <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

// ─── main ─────────────────────────────────────────────────────────────────────

export default function MarginPage() {
  const projectId = useProjectId();

  const [quotedPrice, setQuotedPrice] = useState<number | null>(null);
  const [quotedCurrency, setQuotedCurrency] = useState("MYR");
  const [editingQuote, setEditingQuote] = useState(false);
  const [draftPrice, setDraftPrice] = useState("");
  const [savingQuote, setSavingQuote] = useState(false);

  const [pos, setPos] = useState<ProcurementPo[]>([]);
  const [fab, setFab] = useState<ProcurementFabItem[]>([]);
  const [budget, setBudget] = useState<ProcurementBudget[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [projRes, posRes, fabRes, budgetRes] = await Promise.all([
      supabase.schema("nixma").from("projects").select("quoted_price, quoted_currency").eq("id", projectId).single(),
      supabase.schema("nixma").from("procurement_pos").select("*").eq("project_id", projectId).not("status", "in", '("cancelled","draft")'),
      supabase.schema("nixma").from("procurement_fab_items").select("*").eq("project_id", projectId).not("status", "in", '("cancelled")'),
      supabase.schema("nixma").from("procurement_budget").select("*").eq("project_id", projectId),
    ]);
    const proj = projRes.data as { quoted_price: number | null; quoted_currency: string } | null;
    setQuotedPrice(proj?.quoted_price ?? null);
    setQuotedCurrency(proj?.quoted_currency ?? "MYR");
    setPos((posRes.data as ProcurementPo[]) || []);
    setFab((fabRes.data as ProcurementFabItem[]) || []);
    setBudget((budgetRes.data as ProcurementBudget[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [projectId]);

  async function saveQuotedPrice() {
    const val = parseFloat(draftPrice);
    if (isNaN(val)) return;
    setSavingQuote(true);
    await supabase.schema("nixma").from("projects").update({ quoted_price: val, quoted_currency: quotedCurrency }).eq("id", projectId);
    setQuotedPrice(val);
    setEditingQuote(false);
    setSavingQuote(false);
  }

  // Cost calculations
  const totalPoSpend   = pos.reduce((s, p) => s + (p.total_price || 0), 0);
  const totalFabSpend  = fab.reduce((s, f) => s + (f.cost || 0), 0);
  const totalSpend     = totalPoSpend + totalFabSpend;
  const totalBudget    = budget.reduce((s, b) => s + b.budgeted_amount, 0);
  const grossMargin    = quotedPrice != null ? quotedPrice - totalSpend : null;
  const marginPct      = quotedPrice && quotedPrice > 0 ? ((quotedPrice - totalSpend) / quotedPrice) * 100 : null;

  // Spend by category
  const byCategory = budget.map(b => {
    const poSpend  = pos.filter(p => p.category === b.category).reduce((s, p) => s + (p.total_price || 0), 0);
    const fabSpend = fab.filter(f => f.category === b.category).reduce((s, f) => s + (f.cost || 0), 0);
    const spent    = poSpend + fabSpend;
    return { category: b.category, budget: b.budgeted_amount, spent, currency: b.currency };
  });

  const uncategorisedPos = pos.filter(p => !p.category || !budget.find(b => b.category === p.category));
  const uncategorisedFab = fab.filter(f => !f.category || !budget.find(b => b.category === f.category));
  const uncategorisedSpend = [
    ...uncategorisedPos.map(p => p.total_price || 0),
    ...uncategorisedFab.map(f => f.cost || 0),
  ].reduce((s, v) => s + v, 0);

  const marginColor =
    marginPct == null ? "text-[var(--ink)]/40" :
    marginPct < 0     ? "text-red-400" :
    marginPct < 15    ? "text-orange-400" :
    "text-emerald-400";

  return (
    <main className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-[var(--ink)]">Project Margin</h1>
        <p className="text-sm text-[var(--ink)]/50 mt-0.5">Quoted price vs. actual procurement spend</p>
      </div>

      {loading ? <p className="text-sm text-[var(--ink)]/40 py-8 text-center">Loading…</p> : (
        <>
          {/* Top KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Quoted price */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 col-span-2 md:col-span-1">
              <p className="text-[11px] text-[var(--ink)]/50 uppercase tracking-wide font-mono">Quoted to Customer</p>
              {editingQuote ? (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={quotedCurrency}
                      onChange={e => setQuotedCurrency(e.target.value)}
                      className="text-xs border border-[var(--border)] rounded-lg px-2 py-1 bg-[var(--paper)] text-[var(--ink)] w-20"
                    >
                      {["MYR","USD","SGD","EUR"].map(c => <option key={c}>{c}</option>)}
                    </select>
                    <input
                      type="number"
                      value={draftPrice}
                      onChange={e => setDraftPrice(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 text-sm border border-[var(--border)] rounded-lg px-2 py-1 bg-[var(--paper)] text-[var(--ink)]"
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveQuotedPrice} disabled={savingQuote}
                      className="flex-1 text-xs py-1 rounded-lg bg-[var(--accent)] text-white font-medium disabled:opacity-50">
                      {savingQuote ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => setEditingQuote(false)}
                      className="text-xs px-3 py-1 rounded-lg border border-[var(--border)] text-[var(--ink)]/60">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-end justify-between mt-1">
                  <p className="text-xl font-semibold text-[var(--ink)]">
                    {quotedPrice != null ? fmt(quotedPrice, quotedCurrency) : <span className="text-[var(--ink)]/30">Not set</span>}
                  </p>
                  <button onClick={() => { setDraftPrice(quotedPrice?.toString() ?? ""); setEditingQuote(true); }}
                    className="text-xs text-[var(--ink)]/40 hover:text-[var(--accent)] underline">
                    {quotedPrice != null ? "Edit" : "Set price"}
                  </button>
                </div>
              )}
            </div>

            {[
              { label: "Total Spend", value: fmt(totalSpend), sub: `${pos.length + fab.length} items` },
              { label: "Budget Allocated", value: fmt(totalBudget), sub: `${budget.length} categories` },
              {
                label: "Gross Margin",
                value: grossMargin != null ? fmt(grossMargin, quotedCurrency) : "—",
                sub: marginPct != null ? `${marginPct.toFixed(1)}%` : "Set quoted price",
                color: marginColor,
              },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
                <p className="text-[11px] text-[var(--ink)]/50 uppercase tracking-wide font-mono">{label}</p>
                <p className={`text-xl font-semibold mt-1 ${color ?? "text-[var(--ink)]"}`}>{value}</p>
                <p className="text-[11px] text-[var(--ink)]/40 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>

          {/* Margin health bar */}
          {quotedPrice != null && quotedPrice > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-[var(--ink)]">Spend vs. Quoted Price</p>
                <p className={`text-sm font-semibold ${marginColor}`}>
                  {marginPct != null ? `${marginPct.toFixed(1)}% margin remaining` : ""}
                </p>
              </div>
              <div className="relative h-6 bg-[var(--border)] rounded-lg overflow-hidden">
                {/* Spend bar */}
                <div
                  className={`absolute left-0 top-0 h-full rounded-lg transition-all ${
                    totalSpend > quotedPrice ? "bg-red-500" :
                    totalSpend / quotedPrice > 0.85 ? "bg-orange-400" : "bg-emerald-400"
                  }`}
                  style={{ width: `${Math.min(100, (totalSpend / quotedPrice) * 100)}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-medium text-white drop-shadow">
                    {fmt(totalSpend)} spent of {fmt(quotedPrice, quotedCurrency)}
                  </span>
                </div>
              </div>
              {totalSpend > quotedPrice && (
                <p className="text-sm text-red-400 font-medium">
                  ⚠ Spend exceeds quoted price by {fmt(totalSpend - quotedPrice, quotedCurrency)}
                </p>
              )}
            </div>
          )}

          {/* Breakdown by category */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--ink)]">Spend by Category</p>
            {byCategory.length === 0 && (
              <p className="text-sm text-[var(--ink)]/40">No budget categories set. Add them in Procurement → Budget.</p>
            )}
            {byCategory.map(({ category, budget: bgt, spent, currency }) => {
              const over = spent > bgt && bgt > 0;
              const barColor = over ? "bg-red-500" : spent / (bgt || 1) > 0.8 ? "bg-orange-400" : "bg-emerald-400";
              return (
                <div key={category} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-[var(--ink)]">{category}</p>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${over ? "text-red-400" : "text-[var(--ink)]"}`}>
                        {fmt(spent, currency)}
                      </p>
                      <p className="text-xs text-[var(--ink)]/40">
                        {bgt > 0 ? `of ${fmt(bgt, currency)} budgeted` : "No budget set"}
                      </p>
                    </div>
                  </div>
                  {bgt > 0 && <Bar value={spent} max={bgt} color={barColor} />}
                  {over && (
                    <p className="text-xs text-red-400 mt-1">Over budget by {fmt(spent - bgt, currency)}</p>
                  )}
                </div>
              );
            })}

            {uncategorisedSpend > 0 && (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 opacity-60">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-[var(--ink)]/60">Uncategorised</p>
                  <p className="text-sm font-semibold text-[var(--ink)]">{fmt(uncategorisedSpend)}</p>
                </div>
                <p className="text-xs text-[var(--ink)]/40 mt-1">
                  {uncategorisedPos.length + uncategorisedFab.length} item(s) with no category assigned
                </p>
              </div>
            )}
          </div>

          {/* PO breakdown table */}
          {pos.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <p className="text-sm font-medium text-[var(--ink)]">Purchase Orders</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--paper)]">
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--ink)]/50">Item</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--ink)]/50">Supplier</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--ink)]/50">Category</th>
                      <th className="px-4 py-2 text-center text-xs font-medium text-[var(--ink)]/50">Status</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-[var(--ink)]/50">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pos.map(po => (
                      <tr key={po.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-2.5 font-medium max-w-[200px] truncate">{po.item_description}</td>
                        <td className="px-4 py-2.5 text-[var(--ink)]/60">{po.supplier_name}</td>
                        <td className="px-4 py-2.5 text-xs text-[var(--ink)]/50">{po.category || "—"}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--border)] text-[var(--ink)]/60 font-medium">
                            {po.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmt(po.total_price, po.currency)}</td>
                      </tr>
                    ))}
                    <tr className="bg-[var(--paper)] border-t border-[var(--border)]">
                      <td colSpan={4} className="px-4 py-2.5 text-sm font-medium text-right text-[var(--ink)]/60">PO Total</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmt(totalPoSpend)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Fab breakdown */}
          {fab.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <p className="text-sm font-medium text-[var(--ink)]">Fabrication Items</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--paper)]">
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--ink)]/50">Item</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--ink)]/50">Vendor</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--ink)]/50">Category</th>
                      <th className="px-4 py-2 text-center text-xs font-medium text-[var(--ink)]/50">Status</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-[var(--ink)]/50">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fab.map(f => (
                      <tr key={f.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-2.5 font-medium max-w-[200px] truncate">{f.item_name}</td>
                        <td className="px-4 py-2.5 text-[var(--ink)]/60">{f.fab_vendor || "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-[var(--ink)]/50">{f.category || "—"}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--border)] text-[var(--ink)]/60 font-medium">
                            {f.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmt(f.cost, f.currency)}</td>
                      </tr>
                    ))}
                    <tr className="bg-[var(--paper)] border-t border-[var(--border)]">
                      <td colSpan={4} className="px-4 py-2.5 text-sm font-medium text-right text-[var(--ink)]/60">Fab Total</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmt(totalFabSpend)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
