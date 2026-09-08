import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Deleting a team account has two halves that need different privileges:
//
// 1. Removing their profiles row and project_members rows -- gated by
//    nixma.delete_user_account(), which checks the caller is an admin,
//    blocks self-deletion, and refuses to delete the last remaining admin.
//    Runs under a client scoped to the calling admin's own access token
//    (same pattern as /api/team-invite), so that check runs under their
//    real session -- nothing here trusts the client to have already
//    verified admin status.
//
// 2. Removing the actual Supabase Auth account (revokes any live session,
//    stops them ever logging in again) -- this needs the service-role key,
//    since deleting an auth.users row isn't something RLS/RPCs can do.
//
// Order matters: step 1 runs first. If the caller isn't actually
// authorized, or the target is the last admin, we never reach the
// harder-to-reverse Auth deletion in step 2. If step 2 fails after step 1
// succeeded, the account is already unusable in the app (no profile, no
// project access) even though the raw login technically still exists --
// a safe, inert leftover rather than a half-broken account.

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

  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const userId = body.user_id?.trim();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "user_id is required." }, { status: 400 });
  }

  const scopedClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "nixma" },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { error: rpcError } = await scopedClient.rpc("delete_user_account", {
    p_user_id: userId,
  });
  if (rpcError) {
    return NextResponse.json({ ok: false, error: rpcError.message }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { error: authError } = await admin.auth.admin.deleteUser(userId);
    if (authError) {
      return NextResponse.json({
        ok: true,
        authDeleted: false,
        authError: authError.message,
      });
    }
    return NextResponse.json({ ok: true, authDeleted: true });
  } catch (e) {
    return NextResponse.json({
      ok: true,
      authDeleted: false,
      authError:
        e instanceof Error ? e.message : "Unknown error removing the login account.",
    });
  }
}
