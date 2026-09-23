"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useProjectId } from "@/lib/useProjectId";
import { useInternalAuth } from "@/lib/internalAuth";
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

// ─── constants ────────────────────────────────────────────────────────────────

const CATEGORIES = ["Mechanical", "Electrical", "Fabrication", "Software", "Consumables", "Labour", "Misc"];

const PO_STATUSES: PoStatus[] = ["draft", "issued", "partial", "received", "closed", "cancelled"];
const FAB_STATUSES: FabStatus[] = ["not_started", "in_fabrication", "qc", "ready", "delivered", "cancelled"];

const PO_STATUS_COLOR: Record<PoStatus, string> = {
  draft:     "bg-[var(--surface)] text-[var(--ink)]/50",
  issued:    "bg-blue-500/15 text-blue-400",
  partial:   "bg-yellow-500/15 text-yellow-400",
  received:  "bg-emerald-500/15 text-emerald-400",
  closed:    "bg-[var(--surface)] text-[var(--ink)]/40",
  cancelled: "bg-red-500/15 text-red-400",
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
  not_started: "Not Started", in_fabrication: "In Fab",
  qc: "QC", ready: "Ready", delivered: "Delivered", cancelled: "Cancelled",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(val: number | null | undefined, currency = "MYR") {
  if (val == null) return "—";
  return `${currency} ${Number(val).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}

function daysUntil(d: string | null) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

function DeliveryBadge({ dateStr, status }: { dateStr: string | null; status: PoStatus }) {
  if (["received", "closed", "cancelled"].includes(status)) return null;
  const days = daysUntil(dateStr);
  if (days == null) return null;
  const cls = days < 0 ? "bg-red-500/15 text-red-400" : days <= 3 ? "bg-orange-500/15 text-orange-400" : "bg-emerald-500/15 text-emerald-400";
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `${days}d left`;
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cls}`}>{label}</span>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-[var(--ink)]/60 mb-1">{children}</label>;
}

function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--paper)] text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 ${className}`}
    />
  );
}

function Select({ className = "", children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--paper)] text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 ${className}`}
    >
      {children}
    </select>
  );
}

function Textarea({ className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      rows={2}
      className={`w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--paper)] text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 resize-none ${className}`}
    />
  );
}

// ─── PO form modal ─────────────────────────────────────────────────────────────

type PoFormData = {
  supplier_name: string; item_description: string; category: string;
  po_number: string; quantity: string; unit: string;
  unit_price: string; total_price: string; currency: string;
  payment_terms: string; date_ordered: string;
  expected_delivery: string; status: PoStatus; notes: string;
};

const EMPTY_PO: PoFormData = {
  supplier_name: "", item_description: "", category: "",
  po_number: "", quantity: "", unit: "pcs",
  unit_price: "", total_price: "", currency: "MYR",
  payment_terms: "", date_ordered: "", expected_delivery: "",
  status: "draft", notes: "",
};

function PoModal({
  initial, onClose, onSave,
}: {
  initial?: ProcurementPo | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const projectId = useProjectId();

  if (!canViewProcurement) {
    return (
      <main className="p-8 text-center">
        <p className="text-sm text-[var(--ink)]/50">You don’t have access to Procurement.</p>
      </main>
    );
  }
  const [form, setForm] = useState<PoFormData>(
    initial
      ? {
          supplier_name: initial.supplier_name,
          item_description: initial.item_description,
          category: initial.category || "",
          po_number: initial.po_number || "",
          quantity: initial.quantity != null ? String(initial.quantity) : "",
          unit: initial.unit || "pcs",
          unit_price: initial.unit_price != null ? String(initial.unit_price) : "",
          total_price: initial.total_price != null ? String(initial.total_price) : "",
          currency: initial.currency,
          payment_terms: initial.payment_terms || "",
          date_ordered: initial.date_ordered || "",
          expected_delivery: initial.expected_delivery || "",
          status: initial.status,
          notes: initial.notes || "",
        }
      : EMPTY_PO
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof PoFormData, v: string) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      // Auto-compute total when unit_price or quantity changes
      if (k === "unit_price" || k === "quantity") {
        const up = parseFloat(k === "unit_price" ? v : f.unit_price);
        const qty = parseFloat(k === "quantity" ? v : f.quantity);
        if (!isNaN(up) && !isNaN(qty)) next.total_price = (up * qty).toFixed(2);
      }
      return next;
    });
  }

  async function save() {
    if (!form.supplier_name.trim() || !form.item_description.trim()) {
      setError("Supplier name and item description are required.");
      return;
    }
    setSaving(true);
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError("Not signed in."); setSaving(false); return; }

    const payload = {
      project_id: projectId,
      supplier_name: form.supplier_name.trim(),
      item_description: form.item_description.trim(),
      category: form.category || null,
      po_number: form.po_number || null,
      quantity: form.quantity ? parseFloat(form.quantity) : null,
      unit: form.unit || null,
      unit_price: form.unit_price ? parseFloat(form.unit_price) : null,
      total_price: form.total_price ? parseFloat(form.total_price) : null,
      currency: form.currency,
      payment_terms: form.payment_terms || null,
      date_ordered: form.date_ordered || null,
      expected_delivery: form.expected_delivery || null,
      status: form.status,
      notes: form.notes || null,
      updated_at: new Date().toISOString(),
    };

    let err;
    if (initial) {
      ({ error: err } = await supabase.schema("nixma").from("procurement_pos").update(payload).eq("id", initial.id));
      // If closing/receiving a PO, update supplier track record
      if (!err && (form.status === "received" || form.status === "closed") && initial.status !== form.status) {
        await updateSupplierRecord(initial, form.expected_delivery, form.status);
      }
    } else {
      ({ error: err } = await supabase.schema("nixma").from("procurement_pos").insert({ ...payload, created_by: session.user.id }));
    }

    if (err) { setError(err.message); setSaving(false); return; }
    onSave();
  }

  async function updateSupplierRecord(po: ProcurementPo, expectedDelivery: string, newStatus: PoStatus) {
    if (!po.supplier_id) return;
    const { data: sup } = await supabase.schema("nixma").from("procurement_suppliers").select("*").eq("id", po.supplier_id).single();
    if (!sup) return;

    const onTime = expectedDelivery ? new Date() <= new Date(expectedDelivery) : true;
    const delayDays = expectedDelivery && !onTime
      ? Math.floor((Date.now() - new Date(expectedDelivery).getTime()) / 86400000)
      : 0;

    const totalOrders = (sup.total_orders || 0) + 1;
    const onTimeCount = (sup.on_time_count || 0) + (onTime ? 1 : 0);
    const lateCount = (sup.late_count || 0) + (onTime ? 0 : 1);
    const avgDelay = lateCount > 0
      ? (((sup.avg_delay_days || 0) * (sup.late_count || 0)) + delayDays) / lateCount
      : null;

    await supabase.schema("nixma").from("procurement_suppliers").update({
      total_orders: totalOrders,
      on_time_count: onTimeCount,
      late_count: lateCount,
      avg_delay_days: avgDelay,
      last_order_date: new Date().toISOString().split("T")[0],
    }).eq("id", po.supplier_id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--paper)] rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--paper)] px-6 pt-5 pb-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--ink)]">{initial ? "Edit Purchase Order" : "New Purchase Order"}</h2>
          <button onClick={onClose} className="text-[var(--ink)]/40 hover:text-[var(--ink)] text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3">{error}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Supplier Name *</Label>
              <Input value={form.supplier_name} onChange={e => set("supplier_name", e.target.value)} placeholder="e.g. ABC Engineering Sdn Bhd" />
            </div>
            <div className="col-span-2">
              <Label>Item Description *</Label>
              <Input value={form.item_description} onChange={e => set("item_description", e.target.value)} placeholder="e.g. Servo Motor 750W" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.category} onChange={e => set("category", e.target.value)}>
                <option value="">— Select —</option>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <Label>PO Number</Label>
              <Input value={form.po_number} onChange={e => set("po_number", e.target.value)} placeholder="e.g. PO-2026-001" />
            </div>
            <div>
              <Label>Quantity</Label>
              <Input type="number" value={form.quantity} onChange={e => set("quantity", e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label>Unit</Label>
              <Input value={form.unit} onChange={e => set("unit", e.target.value)} placeholder="pcs, sets, kg…" />
            </div>
            <div>
              <Label>Unit Price</Label>
              <Input type="number" value={form.unit_price} onChange={e => set("unit_price", e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Total Price</Label>
              <Input type="number" value={form.total_price} onChange={e => set("total_price", e.target.value)} placeholder="auto-computed" />
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={form.currency} onChange={e => set("currency", e.target.value)}>
                {["MYR", "USD", "SGD", "EUR", "JPY", "CNY"].map(c => <option key={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <Label>Payment Terms</Label>
              <Input value={form.payment_terms} onChange={e => set("payment_terms", e.target.value)} placeholder="30 days / COD / 50% upfront" />
            </div>
            <div>
              <Label>Date Ordered</Label>
              <Input type="date" value={form.date_ordered} onChange={e => set("date_ordered", e.target.value)} />
            </div>
            <div>
              <Label>Expected Delivery</Label>
              <Input type="date" value={form.expected_delivery} onChange={e => set("expected_delivery", e.target.value)} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onChange={e => set("status", e.target.value as PoStatus)}>
                {PO_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Any remarks…" />
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-[var(--paper)] px-6 pb-5 pt-4 border-t border-[var(--border)] flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--ink)]/60 hover:text-[var(--ink)]">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : initial ? "Save Changes" : "Create PO"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Fab form modal ────────────────────────────────────────────────────────────

type FabFormData = {
  item_name: string; drawing_ref: string; fab_vendor: string;
  category: string; quantity: string; cost: string; currency: string;
  start_date: string; expected_completion: string; status: FabStatus; notes: string;
};

const EMPTY_FAB: FabFormData = {
  item_name: "", drawing_ref: "", fab_vendor: "", category: "",
  quantity: "", cost: "", currency: "MYR",
  start_date: "", expected_completion: "", status: "not_started", notes: "",
};

function FabModal({
  initial, onClose, onSave,
}: {
  initial?: ProcurementFabItem | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const projectId = useProjectId();

  if (!canViewProcurement) {
    return (
      <main className="p-8 text-center">
        <p className="text-sm text-[var(--ink)]/50">You don’t have access to Procurement.</p>
      </main>
    );
  }
  const [form, setForm] = useState<FabFormData>(
    initial
      ? {
          item_name: initial.item_name,
          drawing_ref: initial.drawing_ref || "",
          fab_vendor: initial.fab_vendor || "",
          category: initial.category || "",
          quantity: initial.quantity != null ? String(initial.quantity) : "",
          cost: initial.cost != null ? String(initial.cost) : "",
          currency: initial.currency,
          start_date: initial.start_date || "",
          expected_completion: initial.expected_completion || "",
          status: initial.status,
          notes: initial.notes || "",
        }
      : EMPTY_FAB
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof FabFormData, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.item_name.trim()) { setError("Item name is required."); return; }
    setSaving(true); setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError("Not signed in."); setSaving(false); return; }

    const payload = {
      project_id: projectId,
      item_name: form.item_name.trim(),
      drawing_ref: form.drawing_ref || null,
      fab_vendor: form.fab_vendor || null,
      category: form.category || null,
      quantity: form.quantity ? parseInt(form.quantity) : null,
      cost: form.cost ? parseFloat(form.cost) : null,
      currency: form.currency,
      start_date: form.start_date || null,
      expected_completion: form.expected_completion || null,
      status: form.status,
      notes: form.notes || null,
      updated_at: new Date().toISOString(),
    };

    let err;
    if (initial) {
      ({ error: err } = await supabase.schema("nixma").from("procurement_fab_items").update(payload).eq("id", initial.id));
    } else {
      ({ error: err } = await supabase.schema("nixma").from("procurement_fab_items").insert({ ...payload, created_by: session.user.id }));
    }
    if (err) { setError(err.message); setSaving(false); return; }
    onSave();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--paper)] rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--paper)] px-6 pt-5 pb-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--ink)]">{initial ? "Edit Fab Item" : "New Fabrication Item"}</h2>
          <button onClick={onClose} className="text-[var(--ink)]/40 hover:text-[var(--ink)] text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3">{error}</p>}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Item Name *</Label>
              <Input value={form.item_name} onChange={e => set("item_name", e.target.value)} placeholder="e.g. Main Frame Weldment" />
            </div>
            <div>
              <Label>Drawing Ref</Label>
              <Input value={form.drawing_ref} onChange={e => set("drawing_ref", e.target.value)} placeholder="e.g. DWG-MH063-001" />
            </div>
            <div>
              <Label>Fabricator / Vendor</Label>
              <Input value={form.fab_vendor} onChange={e => set("fab_vendor", e.target.value)} placeholder="e.g. Syarikat ABC" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.category} onChange={e => set("category", e.target.value)}>
                <option value="">— Select —</option>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <Label>Quantity</Label>
              <Input type="number" value={form.quantity} onChange={e => set("quantity", e.target.value)} placeholder="1" />
            </div>
            <div>
              <Label>Cost</Label>
              <Input type="number" value={form.cost} onChange={e => set("cost", e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={form.currency} onChange={e => set("currency", e.target.value)}>
                {["MYR", "USD", "SGD", "EUR", "JPY", "CNY"].map(c => <option key={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={form.start_date} onChange={e => set("start_date", e.target.value)} />
            </div>
            <div>
              <Label>Expected Completion</Label>
              <Input type="date" value={form.expected_completion} onChange={e => set("expected_completion", e.target.value)} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onChange={e => set("status", e.target.value as FabStatus)}>
                {FAB_STATUSES.map(s => <option key={s} value={s}>{FAB_STATUS_LABEL[s]}</option>)}
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Any remarks…" />
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-[var(--paper)] px-6 pb-5 pt-4 border-t border-[var(--border)] flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--ink)]/60 hover:text-[var(--ink)]">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : initial ? "Save Changes" : "Create Fab Item"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RFQ + Quote form modal ────────────────────────────────────────────────────

function RfqModal({
  initial, onClose, onSave,
}: {
  initial?: ProcurementRfq | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const projectId = useProjectId();

  if (!canViewProcurement) {
    return (
      <main className="p-8 text-center">
        <p className="text-sm text-[var(--ink)]/50">You don’t have access to Procurement.</p>
      </main>
    );
  }
  const [itemDescription, setItemDescription] = useState(initial?.item_description || "");
  const [category, setCategory] = useState(initial?.category || "");
  const [quantity, setQuantity] = useState(initial?.quantity != null ? String(initial.quantity) : "");
  const [unit, setUnit] = useState(initial?.unit || "pcs");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!itemDescription.trim()) { setError("Item description is required."); return; }
    setSaving(true); setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError("Not signed in."); setSaving(false); return; }

    const payload = {
      project_id: projectId,
      item_description: itemDescription.trim(),
      category: category || null,
      quantity: quantity ? parseFloat(quantity) : null,
      unit: unit || null,
      notes: notes || null,
    };

    let err;
    if (initial) {
      ({ error: err } = await supabase.schema("nixma").from("procurement_rfq").update(payload).eq("id", initial.id));
    } else {
      ({ error: err } = await supabase.schema("nixma").from("procurement_rfq").insert({ ...payload, status: "open", created_by: session.user.id }));
    }
    if (err) { setError(err.message); setSaving(false); return; }
    onSave();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--paper)] rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 pt-5 pb-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--ink)]">{initial ? "Edit RFQ" : "New RFQ"}</h2>
          <button onClick={onClose} className="text-[var(--ink)]/40 hover:text-[var(--ink)] text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3">{error}</p>}
          <div>
            <Label>Item / Service Required *</Label>
            <Input value={itemDescription} onChange={e => setItemDescription(e.target.value)} placeholder="e.g. Servo Motor 750W x5 units" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Category</Label>
              <Select value={category} onChange={e => setCategory(e.target.value)}>
                <option value="">— Select —</option>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <Label>Quantity</Label>
              <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label>Unit</Label>
              <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="pcs, sets, kg…" />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Specs, requirements, deadline…" />
          </div>
        </div>
        <div className="px-6 pb-5 pt-4 border-t border-[var(--border)] flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--ink)]/60 hover:text-[var(--ink)]">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : initial ? "Save Changes" : "Create RFQ"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add quote to RFQ modal ────────────────────────────────────────────────────

function QuoteModal({
  rfq, onClose, onSave,
}: {
  rfq: ProcurementRfq;
  onClose: () => void;
  onSave: () => void;
}) {
  const projectId = useProjectId();

  if (!canViewProcurement) {
    return (
      <main className="p-8 text-center">
        <p className="text-sm text-[var(--ink)]/50">You don’t have access to Procurement.</p>
      </main>
    );
  }
  const [supplierName, setSupplierName] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [quantity, setQuantity] = useState(rfq.quantity != null ? String(rfq.quantity) : "");
  const [totalPrice, setTotalPrice] = useState("");
  const [currency, setCurrency] = useState("MYR");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [validityDate, setValidityDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePriceChange(up: string, qty: string) {
    const u = parseFloat(up), q = parseFloat(qty);
    if (!isNaN(u) && !isNaN(q)) setTotalPrice((u * q).toFixed(2));
  }

  async function save() {
    if (!supplierName.trim()) { setError("Supplier name is required."); return; }
    setSaving(true); setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError("Not signed in."); setSaving(false); return; }

    const { error: err } = await supabase.schema("nixma").from("procurement_quotes").insert({
      rfq_id: rfq.id,
      project_id: projectId,
      supplier_name: supplierName.trim(),
      unit_price: unitPrice ? parseFloat(unitPrice) : null,
      quantity: quantity ? parseFloat(quantity) : null,
      total_price: totalPrice ? parseFloat(totalPrice) : null,
      currency,
      lead_time_days: leadTimeDays ? parseInt(leadTimeDays) : null,
      payment_terms: paymentTerms || null,
      delivery_terms: deliveryTerms || null,
      validity_date: validityDate || null,
      notes: notes || null,
      created_by: session.user.id,
    });

    if (err) { setError(err.message); setSaving(false); return; }
    onSave();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--paper)] rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--paper)] px-6 pt-5 pb-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--ink)]">Add Supplier Quote</h2>
            <p className="text-xs text-[var(--ink)]/50 mt-0.5 truncate max-w-xs">{rfq.item_description}</p>
          </div>
          <button onClick={onClose} className="text-[var(--ink)]/40 hover:text-[var(--ink)] text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3">{error}</p>}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Supplier Name *</Label>
              <Input value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder="e.g. XYZ Supply Sdn Bhd" />
            </div>
            <div>
              <Label>Unit Price</Label>
              <Input type="number" value={unitPrice} onChange={e => { setUnitPrice(e.target.value); handlePriceChange(e.target.value, quantity); }} placeholder="0.00" />
            </div>
            <div>
              <Label>Quantity</Label>
              <Input type="number" value={quantity} onChange={e => { setQuantity(e.target.value); handlePriceChange(unitPrice, e.target.value); }} placeholder="0" />
            </div>
            <div>
              <Label>Total Price</Label>
              <Input type="number" value={totalPrice} onChange={e => setTotalPrice(e.target.value)} placeholder="auto-computed" />
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={currency} onChange={e => setCurrency(e.target.value)}>
                {["MYR", "USD", "SGD", "EUR", "JPY", "CNY"].map(c => <option key={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <Label>Lead Time (days)</Label>
              <Input type="number" value={leadTimeDays} onChange={e => setLeadTimeDays(e.target.value)} placeholder="e.g. 14" />
            </div>
            <div>
              <Label>Payment Terms</Label>
              <Input value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} placeholder="30 days / COD" />
            </div>
            <div>
              <Label>Delivery Terms</Label>
              <Input value={deliveryTerms} onChange={e => setDeliveryTerms(e.target.value)} placeholder="ex-works / delivered" />
            </div>
            <div>
              <Label>Quote Validity</Label>
              <Input type="date" value={validityDate} onChange={e => setValidityDate(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any remarks or conditions…" />
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-[var(--paper)] px-6 pb-5 pt-4 border-t border-[var(--border)] flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--ink)]/60 hover:text-[var(--ink)]">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : "Add Quote"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Budget modal ──────────────────────────────────────────────────────────────

function BudgetModal({ existing, onClose, onSave }: {
  existing: ProcurementBudget[];
  onClose: () => void;
  onSave: () => void;
}) {
  const projectId = useProjectId();

  if (!canViewProcurement) {
    return (
      <main className="p-8 text-center">
        <p className="text-sm text-[var(--ink)]/50">You don’t have access to Procurement.</p>
      </main>
    );
  }
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("MYR");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingCats = existing.map(b => b.category);
  const available = CATEGORIES.filter(c => !existingCats.includes(c));

  async function save() {
    if (!category || !amount) { setError("Category and amount are required."); return; }
    setSaving(true); setError(null);
    const { error: err } = await supabase.schema("nixma").from("procurement_budget").insert({
      project_id: projectId, category, budgeted_amount: parseFloat(amount), currency,
    });
    if (err) { setError(err.message); setSaving(false); return; }
    onSave();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--paper)] rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="px-6 pt-5 pb-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--ink)]">Add Budget Category</h2>
          <button onClick={onClose} className="text-[var(--ink)]/40 hover:text-[var(--ink)] text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3">{error}</p>}
          <div>
            <Label>Category</Label>
            <Select value={category} onChange={e => setCategory(e.target.value)}>
              <option value="">— Select —</option>
              {available.map(c => <option key={c}>{c}</option>)}
            </Select>
          </div>
          <div>
            <Label>Budget Amount</Label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <Label>Currency</Label>
            <Select value={currency} onChange={e => setCurrency(e.target.value)}>
              {["MYR", "USD", "SGD"].map(c => <option key={c}>{c}</option>)}
            </Select>
          </div>
        </div>
        <div className="px-6 pb-5 pt-4 border-t border-[var(--border)] flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--ink)]/60 hover:text-[var(--ink)]">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : "Add Budget"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Attention banner ──────────────────────────────────────────────────────────

function AttentionBanner({ pos, fab }: { pos: ProcurementPo[]; fab: ProcurementFabItem[] }) {
  const overduePOs = pos.filter(p =>
    !["received", "closed", "cancelled"].includes(p.status) &&
    p.expected_delivery && daysUntil(p.expected_delivery)! < 0
  );
  const dueSoonPOs = pos.filter(p =>
    !["received", "closed", "cancelled"].includes(p.status) &&
    p.expected_delivery && daysUntil(p.expected_delivery)! >= 0 && daysUntil(p.expected_delivery)! <= 3
  );
  const overdueFab = fab.filter(f =>
    !["delivered", "cancelled"].includes(f.status) &&
    f.expected_completion && daysUntil(f.expected_completion)! < 0
  );

  const total = overduePOs.length + dueSoonPOs.length + overdueFab.length;
  if (total === 0) return null;

  return (
    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 space-y-1.5">
      <p className="text-sm font-medium text-red-400">⚠ Attention needed ({total})</p>
      {overduePOs.map(p => (
        <p key={p.id} className="text-xs text-[var(--ink)]/70">
          PO overdue: <span className="font-medium">{p.item_description}</span> from {p.supplier_name} — expected {new Date(p.expected_delivery!).toLocaleDateString("en-MY")}
        </p>
      ))}
      {dueSoonPOs.map(p => (
        <p key={p.id} className="text-xs text-[var(--ink)]/70">
          PO due soon: <span className="font-medium">{p.item_description}</span> from {p.supplier_name} — {daysUntil(p.expected_delivery)} day(s) left
        </p>
      ))}
      {overdueFab.map(f => (
        <p key={f.id} className="text-xs text-[var(--ink)]/70">
          Fab overdue: <span className="font-medium">{f.item_name}</span>{f.fab_vendor ? ` at ${f.fab_vendor}` : ""} — expected {new Date(f.expected_completion!).toLocaleDateString("en-MY")}
        </p>
      ))}
    </div>
  );
}

// ─── Delivery Photo Upload ────────────────────────────────────────────────────

interface PoPhoto {
  id: number;
  po_id: number;
  storage_path: string;
  caption: string | null;
  uploaded_at: string;
  url?: string;
}

function DeliveryPhotos({ po, projectId }: { po: ProcurementPo; projectId: string }) {
  const [photos, setPhotos] = useState<PoPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState("");
  const [expanded, setExpanded] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const loadPhotos = useCallback(async () => {
    const { data } = await supabase.schema("nixma").from("procurement_po_photos")
      .select("*").eq("po_id", po.id).order("uploaded_at", { ascending: false });
    if (!data?.length) { setPhotos([]); return; }
    // Get signed URLs
    const withUrls = await Promise.all((data as PoPhoto[]).map(async (p) => {
      const { data: url } = await supabase.storage
        .from("delivery-photos")
        .createSignedUrl(p.storage_path, 3600);
      return { ...p, url: url?.signedUrl };
    }));
    setPhotos(withUrls);
  }, [po.id]);

  useEffect(() => { if (expanded) loadPhotos(); }, [expanded, loadPhotos]);

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setUploading(false); return; }

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${projectId}/${po.id}/${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("delivery-photos")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (!upErr) {
      await supabase.schema("nixma").from("procurement_po_photos").insert({
        po_id: po.id,
        project_id: projectId,
        storage_path: path,
        caption: caption.trim() || null,
        uploaded_by: session.user.id,
      });
      setCaption("");
      loadPhotos();
    }
    setUploading(false);
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  return (
    <div className="mt-2 pt-2 border-t border-[var(--border)]">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1.5 text-xs text-[var(--ink)]/50 hover:text-[var(--ink)] transition-colors"
      >
        <span>{expanded ? "▾" : "▸"}</span>
        <span>📷 Delivery photos{photos.length > 0 ? ` (${photos.length})` : ""}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Upload row */}
          <div className="flex gap-2 flex-wrap items-center">
            <input
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="Caption (optional)"
              className="flex-1 min-w-[140px] px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--paper)] text-xs text-[var(--ink)] focus:outline-none"
            />
            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={uploading}
              className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
            >
              {uploading ? "Uploading…" : "📷 Add photo"}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoUpload}
            />
          </div>
          {/* Photo grid */}
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map(p => (
                <div key={p.id} className="relative group">
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={p.url}
                        alt={p.caption || "Delivery photo"}
                        className="w-full h-24 object-cover rounded-lg border border-[var(--border)] hover:opacity-90 transition-opacity"
                      />
                    </a>
                  ) : (
                    <div className="w-full h-24 rounded-lg bg-[var(--border)] flex items-center justify-center text-xs text-[var(--ink)]/30">Loading…</div>
                  )}
                  {p.caption && (
                    <p className="text-[10px] text-[var(--ink)]/50 mt-1 truncate">{p.caption}</p>
                  )}
                  <p className="text-[10px] text-[var(--ink)]/30">
                    {new Date(p.uploaded_at).toLocaleDateString("en-MY")}
                  </p>
                </div>
              ))}
            </div>
          )}
          {photos.length === 0 && !uploading && (
            <p className="text-xs text-[var(--ink)]/40">No photos yet. Take a photo when goods arrive.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── main page ─────────────────────────────────────────────────────────────────

type Tab = "pos" | "fab" | "rfq" | "budget";

export default function ProcurementPage() {
  const { canViewProcurement } = useInternalAuth();
  const projectId = useProjectId();

  if (!canViewProcurement) {
    return (
      <main className="p-8 text-center">
        <p className="text-sm text-[var(--ink)]/50">You don’t have access to Procurement.</p>
      </main>
    );
  }
  const [tab, setTab] = useState<Tab>("pos");
  const [pos, setPos] = useState<ProcurementPo[]>([]);
  const [fab, setFab] = useState<ProcurementFabItem[]>([]);
  const [rfqs, setRfqs] = useState<ProcurementRfq[]>([]);
  const [quotes, setQuotes] = useState<ProcurementQuote[]>([]);
  const [budget, setBudget] = useState<ProcurementBudget[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [poModal, setPoModal] = useState<{ open: boolean; item?: ProcurementPo | null }>({ open: false });
  const [fabModal, setFabModal] = useState<{ open: boolean; item?: ProcurementFabItem | null }>({ open: false });
  const [rfqModal, setRfqModal] = useState<{ open: boolean; item?: ProcurementRfq | null }>({ open: false });
  const [quoteModal, setQuoteModal] = useState<{ open: boolean; rfq?: ProcurementRfq | null }>({ open: false });
  const [budgetModal, setBudgetModal] = useState(false);

  // AI scan
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<AiScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI compare
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<Record<string, unknown> | null>(null);
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

  // Cost summary
  const totalCommitted = pos.filter(p => !["cancelled", "draft"].includes(p.status)).reduce((s, p) => s + (p.total_price || 0), 0);
  const totalBudget = budget.reduce((s, b) => s + b.budgeted_amount, 0);
  const totalFabCost = fab.filter(f => f.status !== "cancelled").reduce((s, f) => s + (f.cost || 0), 0);

  // AI scan
  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanError(null); setScanResult(null); setScanning(true); setShowScanModal(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setScanError("Not signed in."); setScanning(false); return; }
      try {
        const res = await fetch("/api/ai/procurement-scan", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ file_base64: base64, media_type: file.type, project_id: projectId }),
        });
        const json = await res.json();
        if (!json.ok) setScanError(json.error);
        else setScanResult(json.result as AiScanResult);
      } catch (err) {
        setScanError(err instanceof Error ? err.message : "Scan failed.");
      } finally {
        setScanning(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  }

  async function saveScanAs(target: "po" | "fab" | "quote") {
    if (!scanResult) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    if (target === "po") {
      await supabase.schema("nixma").from("procurement_pos").insert({
        project_id: projectId,
        supplier_name: scanResult.supplier_name || "Unknown Supplier",
        item_description: scanResult.item_description || "Scanned item",
        category: scanResult.category, quantity: scanResult.quantity, unit: scanResult.unit,
        unit_price: scanResult.unit_price, total_price: scanResult.total_price,
        currency: scanResult.currency || "MYR", payment_terms: scanResult.payment_terms,
        date_ordered: scanResult.date_ordered, expected_delivery: scanResult.expected_delivery,
        po_number: scanResult.po_number, status: "draft",
        extracted_by_ai: true, raw_ai_json: scanResult as unknown as Record<string, unknown>,
        created_by: session.user.id,
      });
    } else if (target === "fab") {
      await supabase.schema("nixma").from("procurement_fab_items").insert({
        project_id: projectId,
        item_name: scanResult.item_description || "Scanned fab item",
        drawing_ref: scanResult.drawing_ref, fab_vendor: scanResult.supplier_name,
        category: scanResult.category, cost: scanResult.cost || scanResult.total_price,
        currency: scanResult.currency || "MYR", expected_completion: scanResult.expected_completion,
        status: "not_started", extracted_by_ai: true,
        raw_ai_json: scanResult as unknown as Record<string, unknown>,
        created_by: session.user.id,
      });
    } else {
      // Save as quote — open RFQ modal pre-filled, then quote modal
      setShowScanModal(false); setScanResult(null);
      setRfqModal({ open: true, item: null });
      return;
    }

    setShowScanModal(false); setScanResult(null); load();
  }

  // AI compare
  async function handleCompare(rfqId: number) {
    setComparing(true); setCompareError(null); setCompareResult(null); setSelectedRfqForCompare(rfqId);
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
      else setCompareResult(json.comparison as Record<string, unknown>);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : "Compare failed.");
    } finally {
      setComparing(false);
    }
  }

  // Quick status update
  async function updatePoStatus(id: number, status: PoStatus, po: ProcurementPo) {
    await supabase.schema("nixma").from("procurement_pos").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    // Update supplier track record when receiving/closing
    if ((status === "received" || status === "closed") && po.supplier_id) {
      const { data: sup } = await supabase.schema("nixma").from("procurement_suppliers").select("*").eq("id", po.supplier_id).single();
      if (sup) {
        const onTime = po.expected_delivery ? new Date() <= new Date(po.expected_delivery) : true;
        const delayDays = po.expected_delivery && !onTime ? Math.floor((Date.now() - new Date(po.expected_delivery).getTime()) / 86400000) : 0;
        const totalOrders = (sup.total_orders || 0) + 1;
        const onTimeCount = (sup.on_time_count || 0) + (onTime ? 1 : 0);
        const lateCount = (sup.late_count || 0) + (onTime ? 0 : 1);
        const avgDelay = lateCount > 0 ? (((sup.avg_delay_days || 0) * (sup.late_count || 0)) + delayDays) / lateCount : null;
        await supabase.schema("nixma").from("procurement_suppliers").update({
          total_orders: totalOrders, on_time_count: onTimeCount, late_count: lateCount,
          avg_delay_days: avgDelay, last_order_date: new Date().toISOString().split("T")[0],
        }).eq("id", po.supplier_id);
      }
    }
    load();
  }

  async function updateFabStatus(id: number, status: FabStatus) {
    await supabase.schema("nixma").from("procurement_fab_items").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    load();
  }

  return (
    <main className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-[var(--ink)]">Procurement</h1>
          <p className="text-sm text-[var(--ink)]/50 mt-0.5">Cost tracking, POs, fabrication, and quote comparison</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--ink)]/70 hover:text-[var(--ink)] hover:border-[var(--accent)] transition-colors">
            <span>📄</span> Scan Doc
          </button>
          {tab === "pos" && <button onClick={() => setPoModal({ open: true })} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90">+ Add PO</button>}
          {tab === "fab" && <button onClick={() => setFabModal({ open: true })} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90">+ Add Fab Item</button>}
          {tab === "rfq" && <button onClick={() => setRfqModal({ open: true })} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90">+ New RFQ</button>}
          {tab === "budget" && <button onClick={() => setBudgetModal(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90">+ Add Budget</button>}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={handleFilePick} />
      </div>

      {/* Attention banner */}
      <AttentionBanner pos={pos} fab={fab} />

      {/* Cost summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Budget", value: fmt(totalBudget), sub: `${budget.length} categories` },
          { label: "POs Committed", value: fmt(totalCommitted), sub: `${pos.filter(p => !["cancelled","draft"].includes(p.status)).length} active POs` },
          { label: "Fab Cost", value: fmt(totalFabCost), sub: `${fab.filter(f => f.status !== "cancelled").length} items` },
          { label: "Open RFQs", value: String(rfqs.filter(r => r.status === "open").length), sub: `${quotes.length} quotes total` },
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
        {(["pos", "fab", "rfq", "budget"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === t ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--ink)]/50 hover:text-[var(--ink)]"}`}>
            {t === "pos" ? "Purchase Orders" : t === "fab" ? "Fabrication" : t === "rfq" ? "RFQ / Quotes" : "Budget"}
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-[var(--ink)]/40 py-8 text-center">Loading…</p> : (
        <>
          {/* ── PO Tab ── */}
          {tab === "pos" && (
            <div className="space-y-2">
              {pos.length === 0 && <p className="text-sm text-[var(--ink)]/40 py-8 text-center">No purchase orders yet. Click "+ Add PO" or scan a document.</p>}
              {pos.map(po => (
                <div key={po.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
                  <div className="flex flex-wrap gap-3 items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${PO_STATUS_COLOR[po.status]}`}>{po.status.toUpperCase()}</span>
                        {po.extracted_by_ai && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-medium">AI</span>}
                        {po.po_number && <span className="text-xs text-[var(--ink)]/40">{po.po_number}</span>}
                      </div>
                      <p className="font-medium text-[var(--ink)] mt-1">{po.item_description}</p>
                      <p className="text-sm text-[var(--ink)]/60">{po.supplier_name}</p>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {po.expected_delivery && <span className="text-xs text-[var(--ink)]/50">Delivery: {new Date(po.expected_delivery).toLocaleDateString("en-MY")}</span>}
                        <DeliveryBadge dateStr={po.expected_delivery} status={po.status} />
                        {po.payment_terms && <span className="text-xs text-[var(--ink)]/40">{po.payment_terms}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-semibold text-[var(--ink)]">{fmt(po.total_price, po.currency)}</p>
                      {po.category && <p className="text-xs text-[var(--ink)]/40">{po.category}</p>}
                    </div>
                  </div>
                  {/* Status + actions row */}
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--border)] flex-wrap">
                    <span className="text-xs text-[var(--ink)]/40 mr-1">Move to:</span>
                    {PO_STATUSES.filter(s => s !== po.status).map(s => (
                      <button key={s} onClick={() => updatePoStatus(po.id, s, po)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-[var(--paper)] border border-[var(--border)] text-[var(--ink)]/60 hover:text-[var(--ink)] hover:border-[var(--accent)] transition-colors">
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                    <button onClick={() => setPoModal({ open: true, item: po })}
                      className="ml-auto text-xs px-2.5 py-1 rounded-lg bg-[var(--paper)] border border-[var(--border)] text-[var(--ink)]/60 hover:text-[var(--ink)] transition-colors">
                      Edit
                    </button>
                  </div>
                  <DeliveryPhotos po={po} projectId={projectId} />
                </div>
              ))}
            </div>
          )}

          {/* ── Fab Tab ── */}
          {tab === "fab" && (
            <div className="space-y-2">
              {fab.length === 0 && <p className="text-sm text-[var(--ink)]/40 py-8 text-center">No fabrication items yet. Click "+ Add Fab Item" or scan a job order.</p>}
              {fab.map(f => (
                <div key={f.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
                  <div className="flex flex-wrap gap-3 items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${FAB_STATUS_COLOR[f.status]}`}>{FAB_STATUS_LABEL[f.status]}</span>
                        {f.extracted_by_ai && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-medium">AI</span>}
                        {f.drawing_ref && <span className="text-xs text-[var(--ink)]/40">DWG: {f.drawing_ref}</span>}
                      </div>
                      <p className="font-medium text-[var(--ink)] mt-1">{f.item_name}</p>
                      {f.fab_vendor && <p className="text-sm text-[var(--ink)]/60">{f.fab_vendor}</p>}
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {f.expected_completion && <span className="text-xs text-[var(--ink)]/50">Due: {new Date(f.expected_completion).toLocaleDateString("en-MY")}</span>}
                        {f.quantity && <span className="text-xs text-[var(--ink)]/40">Qty: {f.quantity}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-semibold text-[var(--ink)]">{fmt(f.cost, f.currency)}</p>
                      {f.category && <p className="text-xs text-[var(--ink)]/40">{f.category}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--border)] flex-wrap">
                    <span className="text-xs text-[var(--ink)]/40 mr-1">Move to:</span>
                    {FAB_STATUSES.filter(s => s !== f.status).map(s => (
                      <button key={s} onClick={() => updateFabStatus(f.id, s)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-[var(--paper)] border border-[var(--border)] text-[var(--ink)]/60 hover:text-[var(--ink)] hover:border-[var(--accent)] transition-colors">
                        {FAB_STATUS_LABEL[s]}
                      </button>
                    ))}
                    <button onClick={() => setFabModal({ open: true, item: f })}
                      className="ml-auto text-xs px-2.5 py-1 rounded-lg bg-[var(--paper)] border border-[var(--border)] text-[var(--ink)]/60 hover:text-[var(--ink)] transition-colors">
                      Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── RFQ Tab ── */}
          {tab === "rfq" && (
            <div className="space-y-4">
              {rfqs.length === 0 && <p className="text-sm text-[var(--ink)]/40 py-8 text-center">No RFQs yet. Create one, then add supplier quotes to compare.</p>}
              {rfqs.map(rfq => {
                const rfqQuotes = quotes.filter(q => q.rfq_id === rfq.id);
                const isSelected = selectedRfqForCompare === rfq.id;
                const comparison = isSelected ? compareResult : null;
                return (
                  <div key={rfq.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                    <div className="p-4 flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${rfq.status === "awarded" ? "bg-emerald-500/15 text-emerald-400" : rfq.status === "cancelled" ? "bg-red-500/15 text-red-400" : "bg-blue-500/15 text-blue-400"}`}>
                            {rfq.status.toUpperCase()}
                          </span>
                          {rfq.category && <span className="text-xs text-[var(--ink)]/40">{rfq.category}</span>}
                        </div>
                        <p className="font-medium text-[var(--ink)] mt-1">{rfq.item_description}</p>
                        {rfq.quantity && <p className="text-xs text-[var(--ink)]/50">Qty: {rfq.quantity} {rfq.unit || ""}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-[var(--ink)]/50">{rfqQuotes.length} quote{rfqQuotes.length !== 1 ? "s" : ""}</span>
                        <button onClick={() => setQuoteModal({ open: true, rfq })}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--ink)]/70 hover:text-[var(--ink)] hover:border-[var(--accent)] transition-colors">
                          + Add Quote
                        </button>
                        {rfqQuotes.length >= 2 && rfq.status === "open" && (
                          <button onClick={() => handleCompare(rfq.id)} disabled={comparing && isSelected}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">
                            {comparing && isSelected ? "Comparing…" : "🤖 AI Compare"}
                          </button>
                        )}
                        <button onClick={() => setRfqModal({ open: true, item: rfq })}
                          className="px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--ink)]/50 hover:text-[var(--ink)] transition-colors">
                          Edit
                        </button>
                      </div>
                    </div>

                    {rfqQuotes.length > 0 && (
                      <div className="border-t border-[var(--border)] overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[var(--border)] bg-[var(--paper)]">
                              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--ink)]/50">Supplier</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-[var(--ink)]/50">Unit Price</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-[var(--ink)]/50">Total</th>
                              <th className="px-4 py-2 text-center text-xs font-medium text-[var(--ink)]/50">Lead</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--ink)]/50">Payment</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rfqQuotes.map(q => {
                              const isWinner = rfq.selected_quote_id === q.id;
                              return (
                                <tr key={q.id} className={`border-b border-[var(--border)] last:border-0 ${isWinner ? "bg-emerald-500/5" : ""}`}>
                                  <td className="px-4 py-2.5">
                                    <div className="flex items-center gap-1.5">
                                      {isWinner && <span className="text-emerald-400 text-xs">✓</span>}
                                      <span className={isWinner ? "font-medium" : "text-[var(--ink)]/80"}>{q.supplier_name}</span>
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

                    {isSelected && (
                      <div className="border-t border-[var(--border)] p-4 bg-[var(--paper)]">
                        {compareError && <p className="text-sm text-red-400">{compareError}</p>}
                        {comparison && (comparison as { summary?: string }).summary && (
                          <div className="space-y-3">
                            <p className="text-sm font-medium text-[var(--ink)]">🤖 AI Analysis</p>
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
                                <p className="text-xs font-medium text-[var(--ink)]/50 uppercase tracking-wide mb-1">Risks</p>
                                <ul className="space-y-1">
                                  {(comparison as { risks: string[] }).risks.map((r, i) => (
                                    <li key={i} className="text-sm text-[var(--ink)]/70 flex gap-2"><span className="text-orange-400 shrink-0">⚠</span>{r}</li>
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
              {budget.length === 0 && <p className="text-sm text-[var(--ink)]/40 py-8 text-center">No budget set. Click "+ Add Budget" to define category budgets.</p>}
              {budget.map(b => {
                const spent = pos.filter(p => p.category === b.category && !["cancelled", "draft"].includes(p.status)).reduce((s, p) => s + (p.total_price || 0), 0);
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
                      <div className={`h-2 rounded-full transition-all ${over ? "bg-red-500" : pct > 80 ? "bg-orange-400" : "bg-emerald-400"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-[var(--ink)]/40 mt-1">{pct.toFixed(0)}% used{over ? " — OVER BUDGET" : ""}</p>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {poModal.open && <PoModal initial={poModal.item} onClose={() => setPoModal({ open: false })} onSave={() => { setPoModal({ open: false }); load(); }} />}
      {fabModal.open && <FabModal initial={fabModal.item} onClose={() => setFabModal({ open: false })} onSave={() => { setFabModal({ open: false }); load(); }} />}
      {rfqModal.open && <RfqModal initial={rfqModal.item} onClose={() => setRfqModal({ open: false })} onSave={() => { setRfqModal({ open: false }); load(); }} />}
      {quoteModal.open && quoteModal.rfq && <QuoteModal rfq={quoteModal.rfq} onClose={() => setQuoteModal({ open: false })} onSave={() => { setQuoteModal({ open: false }); load(); }} />}
      {budgetModal && <BudgetModal existing={budget} onClose={() => setBudgetModal(false)} onSave={() => { setBudgetModal(false); load(); }} />}

      {/* AI Scan Modal */}
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
            {scanError && !scanning && <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3"><p className="text-sm text-red-400">{scanError}</p></div>}
            {scanResult && !scanning && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs px-2.5 py-1 rounded-full bg-purple-500/15 text-purple-400 font-medium capitalize">
                    📄 {scanResult.document_type.replace(/_/g, " ")} detected
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${scanResult.confidence === "high" ? "bg-emerald-500/15 text-emerald-400" : scanResult.confidence === "medium" ? "bg-yellow-500/15 text-yellow-400" : "bg-red-500/15 text-red-400"}`}>
                    {scanResult.confidence} confidence
                  </span>
                </div>
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
                {scanResult.notes && <p className="text-xs text-[var(--ink)]/50 bg-[var(--surface)] rounded-lg p-2.5">{scanResult.notes}</p>}
                <div className="flex gap-2 pt-1 flex-wrap">
                  <button onClick={() => saveScanAs("po")} className="flex-1 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90">Save as PO</button>
                  {scanResult.document_type === "fabrication_order" && (
                    <button onClick={() => saveScanAs("fab")} className="flex-1 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90">Save as Fab Item</button>
                  )}
                  {["quotation"].includes(scanResult.document_type) && (
                    <button onClick={() => saveScanAs("quote")} className="flex-1 px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--ink)]/70 hover:text-[var(--ink)]">Add to RFQ</button>
                  )}
                  <button onClick={() => { setShowScanModal(false); setScanResult(null); }} className="px-4 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-sm text-[var(--ink)]/60 hover:text-[var(--ink)]">Discard</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
