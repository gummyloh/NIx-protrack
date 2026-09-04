-- 018: Customer access link -- a shareable "join link" for customers, so
-- admins stop having to relay/reset the 6-digit PIN for every recurring
-- customer meeting.
--
-- Context: the customer PIN (nixma.projects.customer_password) is stored as
-- a bcrypt hash and is NEVER shown again after it's set/reset -- there's no
-- way for an admin to look it up later, only reset it (which breaks it for
-- anyone who already had it). That's fine for a low-entropy 6-digit secret
-- (hashing is the only safe way to store something with only 1,000,000
-- possibilities), but it makes the PIN awkward for a recurring weekly
-- customer meeting where the admin wants to just hand over access again
-- without a whole reset-and-redistribute cycle.
--
-- The fix: give each project a second, independent way in -- a long random
-- token (256 bits, via gen_random_bytes) embedded in a URL, e.g.
--   https://<app>/customer/access/<token>
-- A 256-bit random token is not guessable, so unlike the PIN it's safe to
-- store in a plainly-readable column and hand back to an admin as many
-- times as they ask ("Copy customer link") without ever hashing it. It
-- never expires on its own (regenerate it if it ever needs to be revoked),
-- and it's purely additive -- the existing 6-digit PIN login keeps working
-- exactly as it does today, untouched by anything in this migration.
--
-- Safe to re-run: `add column if not exists`, `create or replace` on every
-- function, no data change to existing rows (the new column defaults to
-- null -- a project only gets a token the first time an admin asks for its
-- link, via ensure_project_access_token).

-- ---------------------------------------------------------------------
-- 1. New column: the token itself. Plainly readable (not hashed) -- see
--    the reasoning above. Unique so find_project_by_access_token can do a
--    fast, unambiguous lookup.
-- ---------------------------------------------------------------------

alter table nixma.projects
  add column if not exists customer_access_token text unique;

-- ---------------------------------------------------------------------
-- 2. Admin-side management: get-or-create, and force-regenerate.
--    Same authorization gate as reset_customer_pin (can_access_project),
--    for consistency within this existing feature area.
-- ---------------------------------------------------------------------

create or replace function nixma.ensure_project_access_token(p_project_id text)
returns text
language plpgsql
security definer
set search_path = nixma
as $$
declare
  v_token text;
begin
  if not nixma.can_access_project(p_project_id, auth.uid()) then
    raise exception 'Not authorized for this project';
  end if;

  select customer_access_token into v_token
  from nixma.projects
  where id = p_project_id;

  if v_token is not null then
    return v_token;
  end if;

  loop
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    begin
      update nixma.projects
      set customer_access_token = v_token
      where id = p_project_id;
      exit;
    exception when unique_violation then
      -- astronomically unlikely with 256 bits of entropy, but loop rather
      -- than fail outright if it ever happens.
    end;
  end loop;

  return v_token;
end;
$$;

grant execute on function nixma.ensure_project_access_token(text) to authenticated;

create or replace function nixma.regenerate_project_access_token(p_project_id text)
returns text
language plpgsql
security definer
set search_path = nixma
as $$
declare
  v_token text;
begin
  if not nixma.can_access_project(p_project_id, auth.uid()) then
    raise exception 'Not authorized for this project';
  end if;

  loop
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    begin
      update nixma.projects
      set customer_access_token = v_token
      where id = p_project_id;
      exit;
    exception when unique_violation then
    end;
  end loop;

  return v_token;
end;
$$;

grant execute on function nixma.regenerate_project_access_token(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Customer-facing lookups: mirror the existing password-based
--    functions exactly (same return shapes), but authenticate via direct
--    token equality instead of crypt(). Granted to anon+authenticated,
--    same as the password equivalents, since the customer side has no
--    Supabase Auth session at all.
-- ---------------------------------------------------------------------

create or replace function nixma.find_project_by_access_token(p_token text)
returns text
language sql
stable security definer
set search_path = nixma
as $$
  select id from nixma.projects where customer_access_token = p_token;
$$;

grant execute on function nixma.find_project_by_access_token(text) to anon, authenticated;

create or replace function nixma.get_client_project_by_token(p_project_id text, p_token text)
returns table (
  name text,
  customer text,
  project_code text,
  kickoff_date date,
  target_buyoff_date date,
  target_end_date date
)
language sql
security definer
set search_path = nixma
as $$
  select p.name, p.customer, p.project_code, p.kickoff_date, p.target_buyoff_date, p.target_end_date
  from nixma.projects p
  where p.id = p_project_id
    and p.customer_access_token = p_token;
$$;

grant execute on function nixma.get_client_project_by_token(text, text) to anon, authenticated;

create or replace function nixma.list_client_meeting_notes_by_token(p_project_id text, p_token text)
returns setof nixma.meeting_notes
language sql
security definer
set search_path = nixma
as $$
  select mn.* from nixma.meeting_notes mn
  where mn.project_id = p_project_id
    and mn.audience = 'client'
    and exists (
      select 1 from nixma.projects p
      where p.id = p_project_id and p.customer_access_token = p_token
    )
  order by mn.meeting_date desc, mn.created_at desc;
$$;

grant execute on function nixma.list_client_meeting_notes_by_token(text, text) to anon, authenticated;

-- Token-verified read of the latest published update, mirroring
-- get_latest_client_update exactly (same columns, same source table).
create or replace function nixma.get_latest_client_update_by_token(p_project_id text, p_token text)
returns table (published_at timestamptz, note text, snapshot jsonb)
language sql
security definer
set search_path = nixma
as $$
  select u.published_at, u.note, u.snapshot
  from nixma.client_updates u
  where u.project_id = p_project_id
    and exists (
      select 1 from nixma.projects p
      where p.id = p_project_id and p.customer_access_token = p_token
    )
  order by u.published_at desc
  limit 1;
$$;

grant execute on function nixma.get_latest_client_update_by_token(text, text) to anon, authenticated;
