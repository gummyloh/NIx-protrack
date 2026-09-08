import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, AI_MODELS } from "@/lib/ai";

// Phase 1 of the AI layer -- deliberately the smallest, lowest-risk piece:
// read-only (never writes a task or punch item), internal-only (never
// shown to a customer), and manually triggered (a button, not a cron) so
// output quality can be judged before anything gets automated. The other
// three features discussed (meeting-notes-to-task-updates, client
// summaries, smarter template cloning) build on this same pattern once
// this one's proven out -- see AI_MODELS in lib/ai.ts for why each of
// those would use a different model than this one does.
//
// Authorization is delegated to the tasks table's own RLS policy (project
// members only) via a client scoped to the caller's access token -- same
// "runs as the real signed-in user" pattern as /api/team-invite and
// /api/team-delete-user. The service-role client is used only for the one
// step that needs to bypass RLS: caching the result for every project
// member to read back, not just whoever clicked Refresh.

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://iszsyffdxvgdpbulujfa.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzenN5ZmZkeHZnZHBidWx1amZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MjU0NTQsImV4cCI6MjA5OTUwMTQ1NH0.yIz4D9vM5TAnRj4WDzwAxRppHu3j85vWsWrqLReQFPc";

interface TaskForDigest {
  id: number;
  description: string;
  department: string | null;
  status_note: string | null;
  percent_complete: number;
}

interface DigestItem {
  task_id: number;
  signal: string;
  severity: "high" | "medium";
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

  const { data: taskData, error: taskErr } = await scopedClient
    .from("tasks")
    .select("id, description, department, status_note, percent_complete")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .not("status_note", "is", null);

  if (taskErr) {
    return NextResponse.json({ ok: false, error: taskErr.message }, { status: 400 });
  }

  const rows = (taskData as TaskForDigest[]) || [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, digest: [], generated_at: new Date().toISOString() });
  }

  const notesBlock = rows
    .map(
      (t) =>
        `Task #${t.id} (${t.department || "General"}, ${t.percent_complete}% complete): ${t.description}\nNote: ${t.status_note}`
    )
    .join("\n\n");

  const prompt = `You're scanning status notes from an industrial automation/manufacturing
project for risk signals that schedule-date math alone wouldn't catch --
explicit risk language, blockers, unresolved open questions, or a deadline
mentioned in the prose that sounds tight or already missed. Department names
like Mechanical, Electrical, Procurement are normal for this domain.

Status notes:

${notesBlock}

Return ONLY a JSON array (no other text, no markdown code fence), each item
shaped exactly like:
{"task_id": <number>, "signal": "<one sentence on what's risky, in your own words, not a quote from the note>", "severity": "high" or "medium"}

Only include tasks that show a genuine risk signal in the prose -- skip
routine progress updates with no real concern in them. If nothing looks
risky, return an empty array: []`;

  let digest: DigestItem[];
  try {
    const raw = await callClaude({
      model: AI_MODELS.haiku,
      prompt,
      maxTokens: 1500,
    });
    const cleaned = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    digest = JSON.parse(cleaned);
    if (!Array.isArray(digest)) throw new Error("not an array");
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof Error && e.message.startsWith("Claude API")
            ? e.message
            : "Couldn't read the AI's response -- try refreshing again.",
      },
      { status: 502 }
    );
  }

  const generatedAt = new Date().toISOString();
  const admin = getSupabaseAdmin();
  await admin
    .from("ai_risk_digests")
    .upsert({ project_id: projectId, content: digest, generated_at: generatedAt });

  return NextResponse.json({ ok: true, digest, generated_at: generatedAt });
}
