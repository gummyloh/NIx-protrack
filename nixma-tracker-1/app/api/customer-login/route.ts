import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const COOKIE_NAME = "nixma_customer_auth";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function clientIp(req: NextRequest): string {
  // Vercel sits in front of every request, so x-forwarded-for is reliably
  // set there; fall back to a constant bucket if it's ever missing (e.g.
  // local dev) rather than skipping the throttle entirely.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (!password || typeof password !== "string") {
    return NextResponse.json({ ok: false, error: "Missing PIN" }, { status: 400 });
  }
  if (!/^\d{6}$/.test(password)) {
    // Fail fast on obviously-wrong input without spending a rate-limit
    // attempt on it -- a real PIN is always exactly 6 digits.
    return NextResponse.json({ ok: false, error: "Incorrect PIN" }, { status: 401 });
  }

  const ip = clientIp(req);
  const { data: allowed, error: rateLimitError } = await supabase.rpc(
    "check_login_rate_limit",
    { p_ip: ip }
  );
  if (rateLimitError) {
    return NextResponse.json({ ok: false, error: rateLimitError.message }, { status: 500 });
  }
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Please try again in a few minutes." },
      { status: 429 }
    );
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
    return NextResponse.json({ ok: false, error: "Incorrect PIN" }, { status: 401 });
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
