import { createClient } from "@supabase/supabase-js";

// Fallback defaults point at the PricePoint Supabase project this app was
// deployed into. These are safe to embed client-side — the anon key is
// meant to be public, that's how every Supabase frontend works, protection
// comes from RLS (see supabase/001_schema.sql), not from hiding this key.
// Override via env vars if you ever move this to a different project.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://iszsyffdxvgdpbulujfa.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzenN5ZmZkeHZnZHBidWx1amZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MjU0NTQsImV4cCI6MjA5OTUwMTQ1NH0.yIz4D9vM5TAnRj4WDzwAxRppHu3j85vWsWrqLReQFPc";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
  // This project's tables live in their own "nixma" schema rather than
  // "public", so they don't collide with VelSpec's or PricePoint's tables
  // if this is deployed into one of those existing Supabase projects.
  // Remember to add "nixma" under Project Settings -> API -> Exposed schemas,
  // or PostgREST will 404 on every request.
  db: { schema: "nixma" },
});
