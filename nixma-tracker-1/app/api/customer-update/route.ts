import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabase } from "@/lib/supabase";

const COOKIE_NAME = "nixma_customer_auth";

// Replaces the old customer-tasks route now that the customer page renders
// a published snapshot instead of live tasks. Same pattern as
// customer-meeting-notes: the cookie only saves a re-prompt, the RPC
// re-checks the PIN against the projects table itself.
export async function GET() {
  const cookieStore = cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;

  if (!raw) {
    return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
  }

  let project_id: string;
  let password: string | undefined;
  let access_token: string | undefined;
  try {
    const parsed = JSON.parse(raw);
    project_id = parsed.project_id;
    password = parsed.password;
    access_token = parsed.access_token;
    if (!project_id || !(password || access_token)) throw new Error("Malformed cookie");
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 });
  }

  const { data, error } = access_token
    ? await supabase.rpc("get_latest_client_update_by_token", {
        p_project_id: project_id,
        p_token: access_token,
      })
    : await supabase.rpc("get_latest_client_update", {
        p_project_id: project_id,
        p_password: password,
      });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // get_latest_client_update returns a table (0 or 1 rows) -- no rows means
  // nothing has been published for this project yet, which is a normal
  // state, not an error.
  const row = (data as { published_at: string; note: string | null; snapshot: unknown }[])?.[0];
  if (!row) {
    return NextResponse.json({ ok: true, update: null });
  }

  return NextResponse.json({
    ok: true,
    update: { published_at: row.published_at, note: row.note, snapshot: row.snapshot },
  });
}
