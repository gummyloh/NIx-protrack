import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const COOKIE_NAME = "nixma_customer_auth";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (!password || typeof password !== "string") {
    return NextResponse.json({ ok: false, error: "Missing password" }, { status: 400 });
  }

  // Each project has its own customer access password, so the password alone
  // tells us which project this customer belongs to -- no project picker
  // needed on the login form.
  const { data: projectId, error } = await supabase.rpc(
    "find_project_by_customer_password",
    { p_password: password }
  );

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!projectId) {
    return NextResponse.json({ ok: false, error: "Incorrect password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    COOKIE_NAME,
    JSON.stringify({ project_id: projectId, password }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: THIRTY_DAYS,
    }
  );
  return res;
}
