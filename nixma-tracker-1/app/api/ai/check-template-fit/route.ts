import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { callClaude, AI_MODELS } from "@/lib/ai";

// AI layer: catches the exact failure mode that produced the H090 bug --
// a project cloned from the template inheriting tasks that don't actually
// apply to what it's building, discovered only later on a live dashboard
// instead of at creation time. Runs once, right after a new project is
// created, against that project's own freshly-cloned tasks.
//
// Read-only: fetches the project's name/customer and its active tasks via
// a client scoped to the caller's own access token (same authorization
// pattern as every other AI route -- if you can't see this project, you
// can't run this against it). Returns suggested task ids to deactivate;
// nothing is changed here. The actual deactivation happens client-side,
// one task at a time or via "select all", only when the admin reviews and
// applies it -- same review-before-write pattern as the risk digest and
// UpdateAnalyzer.
//
// Uses Sonnet, not Haiku: like UpdateAnalyzer, this drafts a change (which
// tasks to deactivate) a human might accept with one click, so getting the
// match right matters more than the fractional cost difference.

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://iszsyffdxvgdpbulujfa.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzenN5ZmZkeHZnZHBidWx1amZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MjU0NTQsImV4cCI6MjA5OTUwMTQ1NH0.yIz4D9vM5TAnRj4WDzwAxRppHu3j85vWsWrqLReQFPc";

interface TaskRow {
  id: number;
  description: string;
  department: string | null;
}

interface FlaggedTask {
  task_id: number;
  reason: string;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  let body: { project_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const projectId = body.project_id?.trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "project_id is required." }, { status: 400 });
  }

  const scopedClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "nixma" },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: projectData, error: projErr } = await scopedClient
    .from("projects")
    .select("name, customer")
    .eq("id", projectId)
    .single();
  if (projErr || !projectData) {
    return NextResponse.json(
      { ok: false, error: projErr?.message || "No such project." },
      { status: 400 }
    );
  }

  const { data: taskData, error: taskErr } = await scopedClient
    .from("tasks")
    .select("id, description, department")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .eq("is_summary", false);
  if (taskErr) {
    return NextResponse.json({ ok: false, error: taskErr.message }, { status: 400 });
  }

  const tasks = (taskData as TaskRow[]) || [];
  if (tasks.length === 0) {
    return NextResponse.json({ ok: true, flagged: [], input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 });
  }

  const project = projectData as { name: string; customer: string };
  const tasksBlock = tasks
    .map((t) => `TASK #${t.id} [${t.department || "General"}]: ${t.description}`)
    .join("\n");

  const prompt = `A new industrial automation/manufacturing project was just created by
cloning a generic master task template. Your job is to catch tasks that
were included by the generic clone but don't actually make sense for
THIS specific project, based on its name and customer.

Project: "${project.name}" for customer "${project.customer}"

Cloned tasks:
${tasksBlock}

Most of these tasks are genuinely generic project-management/engineering
lifecycle steps (kick-off, design sign-off, procurement, assembly, QA,
shipment, documentation) and apply to almost any build -- do NOT flag
those. Only flag a task if its description names a specific mechanism,
process, or component that clearly belongs to a DIFFERENT kind of machine
than what this project's name suggests (for example, a pouch-sealing or
catheter-handling task on a project that's clearly an HRS/charging-station
build, or vice versa). When in doubt, don't flag it -- a false alarm here
costs an admin's time for nothing; a real generic template shouldn't have
many hits at all.

Return ONLY a JSON array (no other text, no markdown fence), each item
shaped exactly like:
{"task_id": <number>, "reason": "<one short sentence on why this looks specific to a different kind of build>"}

If nothing looks out of place, return an empty array: []`;

  let flagged: FlaggedTask[];
  let usage: { inputTokens: number; outputTokens: number };
  let estimatedCostUsd: number | null;
  try {
    const result = await callClaude({
      model: AI_MODELS.sonnet,
      prompt,
      maxTokens: 1200,
    });
    const cleaned = result.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    flagged = JSON.parse(cleaned);
    if (!Array.isArray(flagged)) throw new Error("not an array");
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

  // Drop anything referencing a task id that wasn't actually fetched --
  // a hallucinated id shouldn't reach the UI as if it were real.
  const validIds = new Set(tasks.map((t) => t.id));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const clean = flagged
    .filter((f) => validIds.has(f.task_id))
    .map((f) => ({
      task_id: f.task_id,
      task_label: taskById.get(f.task_id)!.description,
      reason: f.reason,
    }));

  return NextResponse.json({
    ok: true,
    flagged: clean,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    estimated_cost_usd: estimatedCostUsd,
  });
}
