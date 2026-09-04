import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabase } from "@/lib/supabase";

const COOKIE_NAME = "nixma_customer_auth";

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

  // Same trust model as the other /api/customer-* routes: the cookie only
  // saves a re-prompt, the RPC is the real check against the stored hash
  // (PIN login) or the stored token (join-link login).
  const { data, error } = access_token
    ? await supabase.rpc("get_client_project_by_token", {
        p_project_id: project_id,
        p_token: access_token,
      })
    : await supabase.rpc("get_client_project", {
        p_project_id: project_id,
        p_password: password,
      });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const project = Array.isArray(data) ? data[0] : data;
  if (!project) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, project });
}
