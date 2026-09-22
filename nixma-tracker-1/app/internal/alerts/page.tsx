"use client";

import { useEffect, useState } from "react";
import { useProjectId } from "@/lib/useProjectId";
import { supabase } from "@/lib/supabase";

interface AlertConfig {
  project_id: string;
  whatsapp_enabled: boolean;
  recipient_numbers: string | null;
  alert_overdue_po: boolean;
  alert_overdue_fab: boolean;
  alert_daily_summary: boolean;
  alert_hour_utc: number;
  updated_at: string;
}

const DEFAULT_CONFIG: Omit<AlertConfig, "project_id" | "updated_at"> = {
  whatsapp_enabled: false,
  recipient_numbers: null,
  alert_overdue_po: true,
  alert_overdue_fab: true,
  alert_daily_summary: false,
  alert_hour_utc: 0, // 8am MYT = 0 UTC
};

// MYT = UTC+8, so hour_utc 0 = 8am MYT
function utcHourToMyt(h: number): string {
  const myt = (h + 8) % 24;
  const suffix = myt < 12 ? "am" : "myt";
  const display = myt === 0 ? 12 : myt > 12 ? myt - 12 : myt;
  return `${display}:00 ${myt < 12 ? "am" : "pm"} MYT`;
}

export default function AlertsPage() {
  const projectId = useProjectId();
  const [config, setConfig] = useState<AlertConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft state
  const [enabled, setEnabled]          = useState(false);
  const [numbers, setNumbers]          = useState("");
  const [overduePoAlert, setOverduePo] = useState(true);
  const [overdueFabAlert, setOverdueFab] = useState(true);
  const [dailySummary, setDailySummary] = useState(false);
  const [alertHourUtc, setAlertHourUtc] = useState(0);

  async function load() {
    setLoading(true);
    const { data } = await supabase.schema("nixma")
      .from("project_alert_config")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();

    const cfg = data as AlertConfig | null;
    setConfig(cfg);
    if (cfg) {
      setEnabled(cfg.whatsapp_enabled);
      setNumbers(cfg.recipient_numbers || "");
      setOverduePo(cfg.alert_overdue_po);
      setOverdueFab(cfg.alert_overdue_fab);
      setDailySummary(cfg.alert_daily_summary);
      setAlertHourUtc(cfg.alert_hour_utc);
    } else {
      setEnabled(DEFAULT_CONFIG.whatsapp_enabled);
      setOverduePo(DEFAULT_CONFIG.alert_overdue_po);
      setOverdueFab(DEFAULT_CONFIG.alert_overdue_fab);
      setDailySummary(DEFAULT_CONFIG.alert_daily_summary);
      setAlertHourUtc(DEFAULT_CONFIG.alert_hour_utc);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [projectId]);

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    const payload = {
      project_id:         projectId,
      whatsapp_enabled:   enabled,
      recipient_numbers:  numbers.trim() || null,
      alert_overdue_po:   overduePoAlert,
      alert_overdue_fab:  overdueFabAlert,
      alert_daily_summary: dailySummary,
      alert_hour_utc:     alertHourUtc,
      updated_at:         new Date().toISOString(),
    };

    const { error: err } = await supabase.schema("nixma")
      .from("project_alert_config")
      .upsert(payload, { onConflict: "project_id" });

    if (err) { setError(err.message); setSaving(false); return; }
    setSaved(true);
    setSaving(false);
    setTimeout(() => setSaved(false), 3000);
    load();
  }

  const Toggle = ({ checked, onChange, label, sub }: {
    checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string;
  }) => (
    <label className="flex items-start gap-3 cursor-pointer">
      <div className="relative mt-0.5 shrink-0">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only" />
        <div className={`w-10 h-5 rounded-full transition-colors ${checked ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`} />
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </div>
      <div>
        <p className="text-sm font-medium text-[var(--ink)]">{label}</p>
        {sub && <p className="text-xs text-[var(--ink)]/50 mt-0.5">{sub}</p>}
      </div>
    </label>
  );

  return (
    <main className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">

      <div>
        <h1 className="text-xl font-semibold text-[var(--ink)]">WhatsApp Alerts</h1>
        <p className="text-sm text-[var(--ink)]/50 mt-0.5">
          Get notified on WhatsApp when deliveries are overdue or a daily summary is ready.
          Uses Twilio — enter numbers in international format.
        </p>
      </div>

      {loading ? <p className="text-sm text-[var(--ink)]/40 py-8 text-center">Loading…</p> : (
        <div className="space-y-5">

          {/* Master toggle */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <Toggle
              checked={enabled}
              onChange={setEnabled}
              label="Enable WhatsApp alerts for this project"
              sub="Turn this on once you've added at least one recipient number below."
            />
          </div>

          {/* Recipient numbers */}
          <div className={`bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-3 transition-opacity ${!enabled ? "opacity-40 pointer-events-none" : ""}`}>
            <div>
              <p className="text-sm font-medium text-[var(--ink)]">Recipient Numbers</p>
              <p className="text-xs text-[var(--ink)]/50 mt-0.5">
                International format, comma-separated. e.g. <span className="font-mono">+60123456789, +60198765432</span>
              </p>
            </div>
            <textarea
              value={numbers}
              onChange={e => setNumbers(e.target.value)}
              rows={3}
              placeholder="+60123456789, +60198765432"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--paper)] text-sm font-mono text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 resize-none"
            />
          </div>

          {/* Alert types */}
          <div className={`bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4 transition-opacity ${!enabled ? "opacity-40 pointer-events-none" : ""}`}>
            <p className="text-sm font-medium text-[var(--ink)]">Alert Types</p>

            <Toggle
              checked={overduePoAlert}
              onChange={setOverduePo}
              label="Overdue PO delivery"
              sub="Sends when a PO's expected delivery date passes and status isn't received/closed."
            />
            <Toggle
              checked={overdueFabAlert}
              onChange={setOverdueFab}
              label="Overdue fabrication item"
              sub="Sends when a fab item's expected completion date passes."
            />
            <Toggle
              checked={dailySummary}
              onChange={setDailySummary}
              label="Daily procurement summary"
              sub="A morning message listing all open POs, their status and delivery countdown."
            />
          </div>

          {/* Alert time */}
          {dailySummary && enabled && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-3">
              <p className="text-sm font-medium text-[var(--ink)]">Daily Summary Time</p>
              <select
                value={alertHourUtc}
                onChange={e => setAlertHourUtc(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--paper)] text-sm text-[var(--ink)] focus:outline-none"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{utcHourToMyt(i)}</option>
                ))}
              </select>
              <p className="text-xs text-[var(--ink)]/40">
                Currently set to <strong>{utcHourToMyt(alertHourUtc)}</strong> — Malaysia time (UTC+8)
              </p>
            </div>
          )}

          {/* Setup instructions */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-blue-400">How to activate</p>
            <ol className="text-xs text-[var(--ink)]/60 space-y-1 list-decimal list-inside">
              <li>Sign up for a Twilio account at twilio.com and enable the WhatsApp sandbox</li>
              <li>Add <span className="font-mono">TWILIO_ACCOUNT_SID</span>, <span className="font-mono">TWILIO_AUTH_TOKEN</span>, and <span className="font-mono">TWILIO_WHATSAPP_FROM</span> to your Vercel environment variables</li>
              <li>Deploy the Edge Function: <span className="font-mono text-[10px]">supabase/functions/send-whatsapp-alerts/</span></li>
              <li>Set up a daily cron in Supabase → Edge Functions → Scheduled</li>
              <li>Recipients need to opt in by messaging the Twilio sandbox number first</li>
            </ol>
          </div>

          {/* Save */}
          {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3">{error}</p>}
          {saved && <p className="text-sm text-emerald-400 bg-emerald-500/10 rounded-lg p-3">Settings saved.</p>}

          <button onClick={save} disabled={saving}
            className="w-full py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : "Save Alert Settings"}
          </button>
        </div>
      )}
    </main>
  );
}
