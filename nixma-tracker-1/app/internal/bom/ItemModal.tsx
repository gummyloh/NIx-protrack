"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { BomItem, ModuleRow, StationRow, ProcurementPo } from "@/lib/types";
import {
  BOM_CATEGORIES,
  BOM_DISCIPLINES,
  BOM_DISCIPLINE_LABEL,
  BOM_MAKE_BUY_LABEL,
  BOM_STATUSES,
  BOM_STATUS_LABEL,
  BOM_UNITS,
} from "@/lib/bom";

type Form = Record<string, string | boolean>;

const TEXT = [
  "sub_assembly", "description", "part_no", "manufacturer", "category", "unit", "drawing_no",
  "nsw_part_no", "engineer_pic", "supplier", "pr_no", "po_no", "do_invoice_no", "issued_to", "remarks",
] as const;
const NUM = ["qty", "multiple", "qty_received", "unit_price", "qty_issued"] as const;
const DATE = ["issue_date", "required_date", "po_date", "eta", "received_date", "issued_date"] as const;

// Defined at module level so React keeps the same component identity
// across renders (an inline component would remount and drop input focus).
function Section({ title, tint, children }: { title: string; tint: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[10px] font-mono uppercase tracking-wide mb-2 px-2 py-1 rounded" style={{ background: tint }}>{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{children}</div>
    </section>
  );
}

function toForm(i: Partial<BomItem>): Form {
  const f: Form = {};
  for (const k of [...TEXT, ...DATE]) f[k] = (i[k] as string | null) ?? "";
  for (const k of NUM) f[k] = i[k] != null ? String(i[k]) : "";
  f.multiple = i.multiple != null ? String(i.multiple) : "1";
  f.unit = i.unit ?? "Pcs";
  f.discipline = i.discipline ?? "mechanical";
  f.make_buy = i.make_buy ?? "buy";
  f.status = i.status ?? "not_finalized";
  f.station_id = i.station_id != null ? String(i.station_id) : "";
  f.linked_po_id = i.linked_po_id != null ? String(i.linked_po_id) : "";
  f.show_to_client = i.show_to_client ?? true;
  return f;
}

export default function ItemModal({
  projectId,
  item,
  defaults,
  modules,
  stations,
  pos,
  canViewProcurement,
  onClose,
  onSaved,
}: {
  projectId: string;
  item: BomItem | null;
  defaults?: Partial<BomItem>;
  modules: ModuleRow[];
  stations: StationRow[];
  pos: ProcurementPo[];
  canViewProcurement: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Form>(() => toForm(item ?? defaults ?? {}));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  function payload() {
    const p: Record<string, unknown> = {};
    for (const k of TEXT) p[k] = String(form[k] ?? "").trim() || null;
    for (const k of NUM) {
      const s = String(form[k] ?? "").trim();
      p[k] = s === "" ? null : Number(s);
    }
    for (const k of DATE) p[k] = String(form[k] ?? "") || null;
    p.multiple = p.multiple ?? 1;
    p.unit = p.unit ?? "Pcs";
    p.discipline = form.discipline;
    p.make_buy = form.make_buy;
    p.status = form.status;
    p.station_id = form.station_id ? Number(form.station_id) : null;
    p.show_to_client = !!form.show_to_client;
    if (canViewProcurement) p.linked_po_id = form.linked_po_id ? Number(form.linked_po_id) : null;
    else {
      // Users who can't see prices never overwrite them.
      delete p.unit_price;
    }
    return p;
  }

  async function save() {
    const p = payload();
    if (!p.description) { setError("Description is required."); return; }
    for (const k of NUM) {
      if (p[k] != null && !isFinite(p[k] as number)) { setError(`${k.replace("_", " ")} must be a number.`); return; }
    }
    setSaving(true); setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user.id ?? null;
    const res = item
      ? await supabase.from("bom_items").update({ ...p, updated_by: uid }).eq("id", item.id)
      : await supabase.from("bom_items").insert({ ...p, project_id: projectId, created_by: uid, updated_by: uid });
    if (res.error) { setError(res.error.message); setSaving(false); return; }
    onSaved();
  }

  async function remove() {
    if (!item) return;
    setSaving(true);
    const { error: err } = await supabase.from("bom_items").delete().eq("id", item.id);
    if (err) { setError(err.message); setSaving(false); return; }
    onSaved();
  }

  const input = "field w-full px-2.5 py-1.5 text-sm";
  const label = "block text-[11px] font-medium text-[var(--ink)]/55 mb-1";
  const T = (k: string, l: string, ph = "", span = "") => (
    <div className={span}>
      <label className={label}>{l}</label>
      <input value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value)} placeholder={ph} className={input} />
    </div>
  );
  const N = (k: string, l: string) => (
    <div>
      <label className={label}>{l}</label>
      <input inputMode="decimal" value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value)} className={`${input} font-mono-num`} />
    </div>
  );
  const D = (k: string, l: string) => (
    <div>
      <label className={label}>{l}</label>
      <input type="date" value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value)} className={input} />
    </div>
  );

  const total = Number(form.qty || 0) * Number(form.multiple || 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="px-5 pt-4 pb-3 border-b border-[var(--line)] flex items-center justify-between">
          <h2 className="font-semibold">{item ? "Edit part" : "Add part"}</h2>
          <button onClick={onClose} aria-label="Close" className="text-[var(--ink)]/40 hover:text-[var(--ink)] text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {error && <p className="text-sm text-[var(--rust)] bg-[var(--rust)]/10 rounded-lg p-2.5">{error}</p>}

          <Section title="Engineering" tint="#DDEBF7">
            <div className="col-span-2">
              <label className={label}>Station</label>
              <select value={String(form.station_id)} onChange={(e) => set("station_id", e.target.value)} className={input}>
                <option value="">— Not assigned —</option>
                {modules.map((m) => (
                  <optgroup key={m.id} label={m.name}>
                    {stations.filter((s) => s.module_id === m.id).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            {T("sub_assembly", "Sub-assembly", "e.g. 120 SINGULATOR", "col-span-2")}
            {T("description", "Description *", "e.g. CYLINDER", "col-span-2")}
            {T("part_no", "Manufacturer part no.", "e.g. CDU16-25D-M9BL")}
            {T("manufacturer", "Manufacturer", "e.g. SMC")}
            <div>
              <label className={label}>Discipline</label>
              <select value={String(form.discipline)} onChange={(e) => set("discipline", e.target.value)} className={input}>
                {BOM_DISCIPLINES.map((d) => <option key={d} value={d}>{BOM_DISCIPLINE_LABEL[d]}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Category</label>
              <input list="bom-categories" value={String(form.category)} onChange={(e) => set("category", e.target.value)} className={input} />
              <datalist id="bom-categories">{BOM_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <label className={label}>Make / Buy</label>
              <select value={String(form.make_buy)} onChange={(e) => set("make_buy", e.target.value)} className={input}>
                {(Object.keys(BOM_MAKE_BUY_LABEL) as (keyof typeof BOM_MAKE_BUY_LABEL)[]).map((k) => (
                  <option key={k} value={k}>{BOM_MAKE_BUY_LABEL[k]}</option>
                ))}
              </select>
            </div>
            {T("drawing_no", "Drawing no. / rev")}
            {N("qty", "Qty / set")}
            {N("multiple", "Multiple")}
            <div>
              <label className={label}>Total qty</label>
              <p className="px-2.5 py-1.5 text-sm font-mono-num text-[var(--ink)]/60">{form.qty ? total : "—"}</p>
            </div>
            <div>
              <label className={label}>Unit</label>
              <input list="bom-units" value={String(form.unit)} onChange={(e) => set("unit", e.target.value)} className={input} />
              <datalist id="bom-units">{BOM_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
            </div>
            {T("nsw_part_no", "NSW part no.")}
            {T("engineer_pic", "Engineer PIC")}
            {D("issue_date", "Issue date")}
            {D("required_date", "Required date")}
          </Section>

          <Section title="Purchasing" tint="#E2EFDA">
            <div className="col-span-2">
              <label className={label}>Status</label>
              <select value={String(form.status)} onChange={(e) => set("status", e.target.value)} className={input}>
                {BOM_STATUSES.map((s) => <option key={s} value={s}>{BOM_STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            {T("supplier", "Supplier", "", "col-span-2")}
            {T("pr_no", "PR no.")}
            {T("po_no", "PO no.")}
            {D("po_date", "PO date")}
            {D("eta", "ETA")}
            {T("do_invoice_no", "DO / invoice no.")}
            {N("qty_received", "Qty received")}
            {D("received_date", "Received date")}
            {canViewProcurement && N("unit_price", "Unit price (RM)")}
            {canViewProcurement && (
              <div className="col-span-2 sm:col-span-4">
                <label className={label}>Linked PO in Procurement</label>
                <select value={String(form.linked_po_id)} onChange={(e) => set("linked_po_id", e.target.value)} className={input}>
                  <option value="">— None —</option>
                  {pos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {(p.po_number || "Draft") + " · " + p.supplier_name + " · " + p.item_description}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Section>

          <Section title="Assembly" tint="#FCE4D6">
            {N("qty_issued", "Qty issued")}
            {T("issued_to", "Taken by")}
            {D("issued_date", "Issue date")}
          </Section>

          <div>
            <label className={label}>Remarks</label>
            <textarea value={String(form.remarks)} onChange={(e) => set("remarks", e.target.value)} rows={2} className={`${input} resize-none`} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.show_to_client} onChange={(e) => set("show_to_client", e.target.checked)} />
            Show on customer BOM (supplier, PO and price are never shown)
          </label>
        </div>

        <div className="px-5 py-3 border-t border-[var(--line)] flex items-center gap-2">
          {item && (
            confirmDelete ? (
              <span className="flex items-center gap-2 text-sm">
                Delete this part?
                <button onClick={remove} disabled={saving} className="px-3 py-1.5 rounded-lg bg-[var(--rust)] text-white text-xs font-medium">Yes, delete</button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-[var(--ink)]/50">No</button>
              </span>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="text-xs text-[var(--rust)] hover:underline" title="Tip: set status to Cancelled to keep history">
                Delete
              </button>
            )
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary px-5 py-2 text-sm">{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
