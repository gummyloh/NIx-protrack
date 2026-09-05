import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const COOKIE_NAME = "nixma_customer_auth";

// Same trust model as the other /api/customer-* routes: the cookie only
// saves a re-prompt, the RPC re-checks the password/token against the
// projects table itself and only ever returns photos an admin explicitly
// flagged visible_to_customer. The customer's browser never talks to
// Storage directly -- signed URLs are generated here, server-side, with
// the service-role client, since the customer has no Supabase session for
// Storage's own access checks to key off of.
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
    ? await supabase.rpc("list_client_photos_by_token", {
        p_project_id: project_id,
        p_token: access_token,
      })
    : await supabase.rpc("list_client_photos", {
        p_project_id: project_id,
        p_password: password,
      });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data as { id: string; storage_path: string; caption: string | null; taken_date: string }[]) ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, photos: [] });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    // SUPABASE_SERVICE_ROLE_KEY isn't set -- fail soft here rather than
    // breaking the whole customer page over a missing photos feature.
    return NextResponse.json({ ok: true, photos: [], warning: (err as Error).message });
  }

  const photos = await Promise.all(
    rows.map(async (row) => {
      const { data: signed } = await admin.storage
        .from("project-photos")
        .createSignedUrl(row.storage_path, 3600);
      return {
        id: row.id,
        caption: row.caption,
        taken_date: row.taken_date,
        url: signed?.signedUrl ?? null,
      };
    })
  );

  return NextResponse.json({ ok: true, photos: photos.filter((p) => p.url) });
}
