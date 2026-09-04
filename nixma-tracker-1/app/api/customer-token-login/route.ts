import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const COOKIE_NAME = "nixma_customer_auth";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// Sibling to /api/customer-login, for the "join link" flow instead of the
// 6-digit PIN: the link itself carries a long random token that stands in
// for the password. Same rate limiting and same cookie shape as the PIN
// login, just with access_token instead of password -- every downstream
// /api/customer-* route branches on which of the two is present.
export async function POST(req: NextRequest) {
  const { token } = await req.json();

  if (!token || typeof token !== "string") {
    return NextResponse.json({ ok: false, error: "Missing link" }, { status: 400 });
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

  const { data: projectId, error } = await supabase.rpc(
    "find_project_by_access_token",
    { p_token: token }
  );

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!projectId) {
    return NextResponse.json({ ok: false, error: "This link is no longer valid" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    COOKIE_NAME,
    JSON.stringify({ project_id: projectId, access_token: token }),
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
