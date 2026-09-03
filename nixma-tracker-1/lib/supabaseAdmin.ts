import { createClient } from "@supabase/supabase-js";

// Server-only. Never imported from a "use client" file -- Next.js would
// refuse to bundle process.env.SUPABASE_SERVICE_ROLE_KEY into client code
// anyway (no NEXT_PUBLIC_ prefix), but this file additionally has no
// hardcoded fallback for the key itself, unlike lib/supabase.ts's anon key.
// The service role key bypasses RLS entirely, so it must come from Vercel's
// Environment Variables (set by the project owner from the Supabase
// dashboard) and nowhere else.
//
// Used for exactly one thing today: auth.admin.inviteUserByEmail from
// app/api/team-invite/route.ts. Anything that isn't an admin-only,
// server-side auth operation should keep using the regular request-scoped
// client instead of reaching for this.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://iszsyffdxvgdpbulujfa.supabase.co";

function buildAdminClient(serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "nixma" },
  });
}

let cached: ReturnType<typeof buildAdminClient> | null = null;

export function getSupabaseAdmin(): ReturnType<typeof buildAdminClient> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it in Vercel -> Project Settings -> " +
        "Environment Variables (the value is under Supabase -> Project Settings -> " +
        "API -> service_role secret) to enable sending real invite emails."
    );
  }
  if (cached) return cached;
  cached = buildAdminClient(serviceRoleKey);
  return cached;
}
