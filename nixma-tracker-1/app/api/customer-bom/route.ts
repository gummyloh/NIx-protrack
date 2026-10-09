import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabase } from "@/lib/supabase";

const COOKIE_NAME = "nixma_customer_auth";

// Same trust model as the other /api/customer-* routes: the cookie only
// saves a re-prompt, the RPC re-checks the PIN hash / access token against
// the projects table itself. The RPC returns nothing unless the team has
// switched on BOM sharing for the project, never returns supplier, PR/PO,
// price, DO or remarks, and collapses status to four customer stages.
export async function GET() {
  const raw = cookies().get(COOKIE_NAME)?.value;
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
    ? await supabase.rpc("list_client_bom_by_token", { p_project_id: project_id, p_token: access_token })
    : await supabase.rpc("list_client_bom", { p_project_id: project_id, p_password: password });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, items: data ?? [] });
}
