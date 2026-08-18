-- Lets a photo be tagged to a specific meeting note, the same way it can
-- already (optionally) be tagged to a task. Nullable, since most photos
-- will still just be task- or project-level.
--
-- NOTE: this column was applied directly to the live Supabase project via
-- the Supabase MCP connector on 2026-08-18. This file exists so a fresh
-- project created from these migrations ends up with the same schema.

alter table nixma.photos
  add column if not exists meeting_note_id uuid references nixma.meeting_notes(id);
