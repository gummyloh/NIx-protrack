import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { callClaude, AI_MODELS } from "@/lib/ai";

// AI layer, phase 2: turns a raw field/engineering update into proposed
// task and punch-item changes for a human to review. Nothing in this route
// writes to the database -- it only reads (via a client scoped to the
// caller's own access token, so authorization is just "can you already see
// this project's tasks", same as everywhere else) and returns suggestions.
// The actual write happens client-side, one suggestion at a time, only
// when the person clicks Apply -- see UpdateAnalyzer.tsx.
//
// Uses Sonnet, not Haiku: this is drafting changes a human might accept
// with one click, and a wrong task match or a naively-inflated percentage
// costs real review time -- worth the extra cost per lib/ai.ts's reasoning
// for when each model gets used.

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://iszsyffdxvgdpbulujfa.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzenN5ZmZkeHZnZHBidWx1amZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MjU0NTQsImV4cCI6MjA5OTUwMTQ1NH0.yIz4D9vM5TAnRj4WDzwAxRppHu3j85vWsWrqLReQFPc";

interface TaskRow {
  id: number;
  description: string;
  department: string | null;
  percent_complete: number;
  status_note: string | null;
}

interface PunchRow {
  id: number;
  description: string;
  category: string | null;
  severity: string | null;
  percent_complete: number | null;
  target_date: string | null;
  remarks: string | null;
}

interface RawSuggestion {
  target_type: "task" | "punch_item";
  target_id: number;
  proposed_percent_complete: number | null;
  note_addition: string | null;
  reasoning: string;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  let body: { project_id?: string; update_text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const projectId = body.project_id?.trim();
  const updateText = body.update_text?.trim();
  if (!projectId || !updateText) {
    return NextResponse.json(
      { ok: false, error: "project_id and update_text are required." },
      { status: 400 }
    );
  }

  const scopedClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "nixma" },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const [{ data: taskData, error: taskErr }, { data: punchData, error: punchErr }] =
    await Promise.all([
      scopedClient
        .from("tasks")
        .select("id, description, department, percent_complete, status_note")
        .eq("project_id", projectId)
        .eq("is_active", true),
      scopedClient
        .from("punch_items")
        .select("id, description, category, severity, percent_complete, target_date, remarks")
        .eq("project_id", projectId)
        .eq("status", "open"),
    ]);

  if (taskErr) return NextResponse.json({ ok: false, error: taskErr.message }, { status: 400 });
  if (punchErr) return NextResponse.json({ ok: false, error: punchErr.message }, { status: 400 });

  const tasks = (taskData as TaskRow[]) || [];
  const punchItems = (punchData as PunchRow[]) || [];

  const today = new Date();
  const todayLabel = `${today.getDate()}-${today.toLocaleString("en-US", { month: "short" })}`;

  const tasksBlock = tasks
    .map(
      (t) =>
        `TASK #${t.id} [${t.department || "General"}] "${t.description}" -- currently ${t.percent_complete}% complete. Existing note: ${t.status_note || "(none)"}`
    )
    .join("\n");
  const punchBlock = punchItems
    .map(
      (p) =>
        `PUNCH #${p.id} [${p.category || "General"}/${p.severity || "?"}] "${p.description}" -- ${p.percent_complete ?? 0}% complete, target ${p.target_date || "none set"}. Existing remarks: ${p.remarks || "(none)"}`
    )
    .join("\n");

  const prompt = `You're helping a project manager translate a raw field/engineering update
into proposed changes to specific tasks and punch list items on an
industrial automation build. Today's date is ${todayLabel}, 2026.

CURRENT ACTIVE TASKS:
${tasksBlock}

CURRENT OPEN PUNCH ITEMS:
${punchBlock}

THE UPDATE, AS WRITTEN BY THE PM:
"""
${updateText}
"""

Match this update only against the specific tasks/punch items above that it
actually describes -- don't touch anything it doesn't mention or clearly
imply.

Critical judgment call: work happening today is not automatically progress.
If the update describes a setback, a failed approach, or a pivot to a new
design, do NOT simply increase percent_complete -- consider holding it flat
or even suggesting a decrease, and say so plainly in your reasoning. Only
suggest an increase when the update genuinely describes forward progress
toward that specific task's completion.

If a task-level discovery affects a punch item's feasibility or target date
(e.g. a design pivot likely invalidating an existing target date), flag
that punch item too, even if the update didn't mention punch items by name.

Never invent numbers, dates, or outcomes the update didn't state -- if it
doesn't say a test passed or failed, don't claim either happened.

Return ONLY a JSON object (no other text, no markdown fence) shaped exactly
like:
{
  "suggestions": [
    {
      "target_type": "task" or "punch_item",
      "target_id": <number, must match one of the IDs listed above exactly>,
      "proposed_percent_complete": <integer 0-100, or null for no change>,
      "note_addition": "<one short sentence to append, starting with '${todayLabel}: ', or null for no note change>",
      "reasoning": "<one or two sentences explaining the suggestion, especially any judgment call about progress vs setback>"
    }
  ],
  "unaddressed_items": ["<short description of anything this update surfaces that isn't tracked as an existing task or punch item, if any>"]
}
If nothing in the update maps to anything trackable, return exactly {"suggestions": [], "unaddressed_items": []}.`;

  let parsed: { suggestions: RawSuggestion[]; unaddressed_items: string[] };
  let usage: { inputTokens: number; outputTokens: number };
  let estimatedCostUsd: number | null;
  try {
    const result = await callClaude({
      model: AI_MODELS.sonnet,
      prompt,
      maxTokens: 2000,
    });
    const cleaned = result.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.suggestions)) throw new Error("bad shape");
    usage = result.usage;
    estimatedCostUsd = result.estimatedCostUsd;
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof Error && e.message.startsWith("Claude API")
            ? e.message
            : "Couldn't read the AI's response -- try again.",
      },
      { status: 502 }
    );
  }

  // Attach ground-truth current values server-side rather than trusting the
  // model to echo them back accurately, and silently drop any suggestion
  // that references an id that doesn't actually exist in what was fetched
  // (a hallucinated id, given how many rows are in context).
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const punchById = new Map(punchItems.map((p) => [p.id, p]));

  const suggestions = parsed.suggestions
    .map((s) => {
      const source = s.target_type === "task" ? taskById.get(s.target_id) : punchById.get(s.target_id);
      if (!source) return null;
      return {
        target_type: s.target_type,
        target_id: s.target_id,
        target_label: source.description,
        current_percent_complete: source.percent_complete ?? 0,
        current_note: s.target_type === "task" ? (source as TaskRow).status_note : (source as PunchRow).remarks,
        proposed_percent_complete: s.proposed_percent_complete,
        note_addition: s.note_addition,
        reasoning: s.reasoning,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return NextResponse.json({
    ok: true,
    suggestions,
    unaddressed_items: parsed.unaddressed_items || [],
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    estimated_cost_usd: estimatedCostUsd,
  });
}
