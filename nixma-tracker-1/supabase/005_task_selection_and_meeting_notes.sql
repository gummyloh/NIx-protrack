-- Two additions for the multi-project template phase:
-- 1. is_active on tasks -- lets each project instance turn tasks on/off
--    without losing them from the underlying template.
-- 2. meeting_notes -- internal vs client-facing, with a real security
--    boundary (not just a hidden UI tab) between the two.

alter table nixma.tasks
  add column if not exists is_active boolean not null default true;

create table if not exists nixma.meeting_notes (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references nixma.projects(id) on delete cascade,
  audience text not null check (audience in ('internal', 'client')),
  title text not null,
  meeting_date date not null,
  raw_content text,
  formatted_content text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_meeting_notes_project on nixma.meeting_notes(project_id, audience);

alter table nixma.meeting_notes enable row level security;

-- Deliberately NO direct select/insert policy on this table for anon/
-- authenticated. Everything goes through the functions below. This matters
-- specifically for client-facing notes: without this, the anon key (which
-- is public, baked into the deployed site) would let anyone read every
-- internal note by querying the REST API directly, regardless of what the
-- app's UI shows them.

-- Internal team: no password gate (matches the rest of /internal today),
-- sees both internal and client-facing notes since they need visibility
-- into what was told to the customer.
create or replace function nixma.list_internal_meeting_notes(p_project_id text)
returns setof nixma.meeting_notes
language sql
security definer
set search_path = nixma
as $$
  select * from nixma.meeting_notes
  where project_id = p_project_id
  order by meeting_date desc, created_at desc;
$$;

-- Customer-facing: the password is checked INSIDE the function itself, not
-- just via a cookie set earlier. That way this function is safe to call
-- directly (e.g. from a browser devtools console) -- a caller without the
-- real password gets nothing back, same as the /customer login itself.
create or replace function nixma.list_client_meeting_notes(p_project_id text, p_password text)
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
      where p.id = p_project_id and p.customer_password = p_password
    )
  order by mn.meeting_date desc, mn.created_at desc;
$$;

create or replace function nixma.upsert_meeting_note(
  p_id uuid,
  p_project_id text,
  p_audience text,
  p_title text,
  p_meeting_date date,
  p_raw_content text,
  p_formatted_content text,
  p_created_by text
) returns nixma.meeting_notes
language plpgsql
security definer
set search_path = nixma
as $$
declare
  result nixma.meeting_notes;
begin
  insert into nixma.meeting_notes
    (id, project_id, audience, title, meeting_date, raw_content, formatted_content, created_by)
  values
    (coalesce(p_id, gen_random_uuid()), p_project_id, p_audience, p_title, p_meeting_date, p_raw_content, p_formatted_content, p_created_by)
  on conflict (id) do update set
    title = excluded.title,
    meeting_date = excluded.meeting_date,
    raw_content = excluded.raw_content,
    formatted_content = excluded.formatted_content,
    updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function nixma.delete_meeting_note(p_id uuid)
returns void
language sql
security definer
set search_path = nixma
as $$
  delete from nixma.meeting_notes where id = p_id;
$$;

grant execute on function nixma.list_internal_meeting_notes(text) to anon, authenticated;
grant execute on function nixma.list_client_meeting_notes(text, text) to anon, authenticated;
grant execute on function nixma.upsert_meeting_note(uuid, text, text, text, date, text, text, text) to anon, authenticated;
grant execute on function nixma.delete_meeting_note(uuid) to anon, authenticated;
