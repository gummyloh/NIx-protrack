// Supabase Edge Function: send-whatsapp-alerts
//
// Triggered daily by Supabase cron. For each project with WhatsApp alerts
// enabled, it:
//   1. Finds overdue POs and fab items
//   2. Sends a WhatsApp message via Twilio for each alert type enabled
//
// Required env vars (set in Supabase Dashboard → Edge Functions → Secrets):
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_WHATSAPP_FROM   (e.g. "whatsapp:+14155238886")
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { db: { schema: "nixma" } }
);

const TWILIO_SID  = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const FROM_NUMBER = Deno.env.get("TWILIO_WHATSAPP_FROM")!;

async function sendWhatsApp(to: string, body: string) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${TWILIO_SID}:${TWILIO_AUTH}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      From: FROM_NUMBER,
      To:   to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
      Body: body,
    }),
  });
  return res.ok;
}

function daysDiff(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

Deno.serve(async () => {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const currentHourUtc = today.getUTCHours();

  // Load all active alert configs where the alert hour matches now
  const { data: configs } = await supabase
    .from("project_alert_config")
    .select("*")
    .eq("whatsapp_enabled", true)
    .eq("alert_hour_utc", currentHourUtc);

  if (!configs?.length) {
    return new Response(JSON.stringify({ sent: 0, reason: "No configs active at this hour" }));
  }

  let totalSent = 0;

  for (const cfg of configs) {
    const projectId     = cfg.project_id;
    const recipients    = (cfg.recipient_numbers as string || "")
      .split(",").map((n: string) => n.trim()).filter(Boolean);

    if (!recipients.length) continue;

    const messages: string[] = [];

    // Overdue POs
    if (cfg.alert_overdue_po) {
      const { data: overduePOs } = await supabase
        .from("procurement_pos")
        .select("item_description, supplier_name, expected_delivery, status")
        .eq("project_id", projectId)
        .not("status", "in", '("received","closed","cancelled","draft")')
        .lt("expected_delivery", todayStr);

      if (overduePOs?.length) {
        const lines = overduePOs.map((po: { item_description: string; supplier_name: string; expected_delivery: string }) =>
          `  • ${po.item_description} (${po.supplier_name}) — ${daysDiff(po.expected_delivery)}d overdue`
        ).join("\n");
        messages.push(`🔴 *Overdue PO Deliveries (${overduePOs.length}):*\n${lines}`);
      }
    }

    // Overdue fab items
    if (cfg.alert_overdue_fab) {
      const { data: overdueFab } = await supabase
        .from("procurement_fab_items")
        .select("item_name, fab_vendor, expected_completion, status")
        .eq("project_id", projectId)
        .not("status", "in", '("delivered","cancelled")')
        .lt("expected_completion", todayStr);

      if (overdueFab?.length) {
        const lines = overdueFab.map((f: { item_name: string; fab_vendor: string; expected_completion: string }) =>
          `  • ${f.item_name}${f.fab_vendor ? ` (${f.fab_vendor})` : ""} — ${daysDiff(f.expected_completion)}d overdue`
        ).join("\n");
        messages.push(`🔴 *Overdue Fabrication Items (${overdueFab.length}):*\n${lines}`);
      }
    }

    // Daily summary of all open POs
    if (cfg.alert_daily_summary) {
      const { data: openPOs } = await supabase
        .from("procurement_pos")
        .select("item_description, supplier_name, expected_delivery, status")
        .eq("project_id", projectId)
        .not("status", "in", '("received","closed","cancelled","draft")')
        .order("expected_delivery");

      if (openPOs?.length) {
        const lines = openPOs.map((po: { item_description: string; supplier_name: string; expected_delivery: string; status: string }) => {
          const days = po.expected_delivery
            ? Math.ceil((new Date(po.expected_delivery).getTime() - Date.now()) / 86400000)
            : null;
          const badge = !days ? "" : days < 0 ? ` ⚠ ${Math.abs(days)}d overdue` : days === 0 ? " ⏰ Due today" : ` ✅ ${days}d left`;
          return `  • ${po.item_description} — ${po.status}${badge}`;
        }).join("\n");
        messages.push(`📦 *Open POs (${openPOs.length}):*\n${lines}`);
      } else {
        messages.push("📦 *No open POs today.*");
      }
    }

    if (!messages.length) continue;

    // Fetch project name for the message header
    const { data: proj } = await (supabase as ReturnType<typeof createClient>).schema("nixma")
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .single() as { data: { name: string } | null };

    const header = `*NIx-ProTrack Alert*\nProject: ${proj?.name ?? projectId}\n${todayStr}\n\n`;
    const body   = header + messages.join("\n\n");

    for (const number of recipients) {
      const ok = await sendWhatsApp(number, body);
      if (ok) totalSent++;
    }
  }

  return new Response(JSON.stringify({ sent: totalSent }), {
    headers: { "Content-Type": "application/json" },
  });
});
