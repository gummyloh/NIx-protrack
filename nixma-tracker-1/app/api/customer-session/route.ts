import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const COOKIE_NAME = "nixma_customer_auth";

// Tells the client-side customer page which project it's signed in to, so
// that page never has to hardcode a project id. The cookie is httpOnly, so
// this small server route is the only way client JS can learn the project
// id it resolved to at login time.
export async function GET() {
  const cookieStore = cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;

  if (!raw) {
    return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.project_id) throw new Error("Malformed cookie");
    return NextResponse.json({ ok: true, project_id: parsed.project_id as string });
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 });
  }
}
