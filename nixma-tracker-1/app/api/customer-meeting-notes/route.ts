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
  let password: string;
  try {
    const parsed = JSON.parse(raw);
    project_id = parsed.project_id;
    password = parsed.password;
    if (!project_id || !password) throw new Error("Malformed cookie");
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 });
  }

  // The RPC re-checks the password against the projects table itself --
  // this route trusts the cookie only to avoid re-prompting, not as the
  // actual security boundary. Even a forged/stale cookie value can't
  // retrieve notes without the real password matching in the database.
  const { data, error } = await supabase.rpc("list_client_meeting_notes", {
    p_project_id: project_id,
    p_password: password,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, notes: data ?? [] });
}
