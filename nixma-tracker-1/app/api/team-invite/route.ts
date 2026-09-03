import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Real email invites, layered on top of the existing invite_project_member
// RPC rather than replacing it. That RPC already does 100% of the
// authorization + bookkeeping work (admin-only check, project_invites row,
// handle_new_user() auto-attachment on signup) -- this route's only job is
// to (a) call it as the actual signed-in admin, so nothing about who's
// allowed to invite changes, and (b) if it queued a real invite, also send
// the email Phase 1 never sent.
//
// Why a per-request client instead of the service-role client for the RPC
// call: supabase.auth in this app persists sessions in browser localStorage,
// so this route has no cookie/session of its own. The client forwards its
// access token and this route builds a client scoped to that token, so
// auth.uid() inside invite_project_member() resolves to the calling user --
// exactly as if they'd called the RPC directly from the browser. The
// service-role client (lib/supabaseAdmin.ts) is used only for the one
// operation that genuinely needs to bypass RLS: sending the invite email.

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://iszsyffdxvgdpbulujfa.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzenN5ZmZkeHZnZHBidWx1amZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MjU0NTQsImV4cCI6MjA5OTUwMTQ1NH0.yIz4D9vM5TAnRj4WDzwAxRppHu3j85vWsWrqLReQFPc";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  let body: { project_id?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const projectId = body.project_id?.trim();
  const email = body.email?.trim();
  if (!projectId || !email) {
    return NextResponse.json(
      { ok: false, error: "project_id and email are required." },
      { status: 400 }
    );
  }

  // Scoped to the calling user's own token -- carries the exact same
  // identity/authorization the RPC would see if called client-side, no
  // more and no less.
  const scopedClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "nixma" },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: result, error: rpcError } = await scopedClient.rpc(
    "invite_project_member",
    { p_project_id: projectId, p_email: email }
  );

  if (rpcError) {
    return NextResponse.json({ ok: false, error: rpcError.message }, { status: 400 });
  }

  // "added" means an existing account was attached immediately -- no email
  // to send, they already have a way in (they can just sign in).
  if (result !== "invited") {
    return NextResponse.json({ ok: true, result });
  }

  // The invite record is already saved at this point (the RPC above wrote
  // it), so from here on we're strictly best-effort: if the email fails to
  // send for any reason -- including SUPABASE_SERVICE_ROLE_KEY not being
  // configured yet -- the invite itself is not lost, and the person can
  // still fall back to signing up manually at /signup with that email.
  try {
    const admin = getSupabaseAdmin();
    const redirectTo = `${req.nextUrl.origin}/reset-password`;
    const { error: emailError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
    });
    if (emailError) {
      return NextResponse.json({
        ok: true,
        result: "invited",
        emailSent: false,
        emailError: emailError.message,
      });
    }
    return NextResponse.json({ ok: true, result: "invited", emailSent: true });
  } catch (e) {
    return NextResponse.json({
      ok: true,
      result: "invited",
      emailSent: false,
      emailError: e instanceof Error ? e.message : "Unknown error sending invite email.",
    });
  }
}
