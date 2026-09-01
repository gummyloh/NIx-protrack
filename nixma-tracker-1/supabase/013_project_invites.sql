-- 013: Add-by-email project invites, plus backfilling the team/project
-- access objects that already exist live but were never captured in a
-- migration (project_members, is_approved_admin, can_access_project,
-- can_i_access_project, handle_new_user, list_project_members,
-- list_addable_members, add_project_member, remove_project_member). Every
-- statement below is written to match the live database exactly, so
-- applying this migration to prod is a no-op for anything that already
-- exists -- it only stops the repo from silently drifting from prod, and
-- adds the new invite feature on top.
--
-- New feature: an admin can add someone to a project by email from the
-- Team page without them needing an account yet. If an account with that
-- email already exists, they're approved (if pending) and added
-- immediately. If not, the email is queued in project_invites and picked
-- up automatically the moment they sign up with that address -- no
-- separate email is sent by this app; the admin still tells the person to
-- go sign up, the same way access has always been shared.

-- ---------------------------------------------------------------------
-- 1. Backfill: objects that already exist live, recreated here verbatim
--    so the repo matches prod and future environments can be provisioned
--    from migrations alone.
-- ---------------------------------------------------------------------

create table if not exists nixma.project_members (
  project_id text not null references nixma.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table nixma.project_members enable row level security;
-- No policies here and no grants to anon/authenticated below (matching
-- prod) -- every read/write goes through the SECURITY DEFINER functions
-- below, which check nixma.is_approved_admin()/can_access_project()
-- themselves.

create or replace function nixma.is_approved_admin(uid uuid)
returns boolean
language sql
stable security definer
set search_path = nixma
as $$
  select coalesce(
    (select is_admin and approved from nixma.profiles where id = uid),
    false
  );
$$;

create or replace function nixma.can_access_project(p_project_id text, p_uid uuid)
returns boolean
language sql
stable security definer
set search_path = nixma
as $$
  select
    nixma.is_approved_admin(p_uid)
    or exists (
      select 1 from nixma.project_members pm
      where pm.project_id = p_project_id and pm.user_id = p_uid
    );
$$;

create or replace function nixma.can_i_access_project(p_project_id text)
returns boolean
language sql
stable security definer
set search_path = nixma
as $$
  select nixma.can_access_project(p_project_id, auth.uid());
$$;

create or replace function nixma.list_project_members(p_project_id text)
returns table (user_id uuid, email text, full_name text, is_admin boolean, added_at timestamptz)
language plpgsql
security definer
set search_path = nixma
as $$
begin
  if not nixma.can_access_project(p_project_id, auth.uid()) then
    raise exception 'Not authorized for this project';
  end if;

  return query
    select pr.id, pr.email, pr.full_name, pr.is_admin, pm.added_at
    from nixma.project_members pm
    join nixma.profiles pr on pr.id = pm.user_id
    where pm.project_id = p_project_id
    order by pm.added_at asc;
end;
$$;

create or replace function nixma.list_addable_members(p_project_id text)
returns table (id uuid, email text, full_name text)
language plpgsql
security definer
set search_path = nixma
as $$
begin
  if not nixma.is_approved_admin(auth.uid()) then
    raise exception 'Only admins can manage project members';
  end if;

  return query
    select pr.id, pr.email, pr.full_name
    from nixma.profiles pr
    where pr.approved = true
      and not exists (
        select 1 from nixma.project_members pm
        where pm.project_id = p_project_id and pm.user_id = pr.id
      )
    order by coalesce(pr.full_name, pr.email) asc;
end;
$$;

create or replace function nixma.add_project_member(p_project_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = nixma
as $$
begin
  if not nixma.is_approved_admin(auth.uid()) then
    raise exception 'Only admins can manage project members';
  end if;

  insert into nixma.project_members (project_id, user_id)
  values (p_project_id, p_user_id)
  on conflict do nothing;
end;
$$;

create or replace function nixma.remove_project_member(p_project_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = nixma
as $$
begin
  if not nixma.is_approved_admin(auth.uid()) then
    raise exception 'Only admins can manage project members';
  end if;

  delete from nixma.project_members
  where project_id = p_project_id and user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. New: project_invites. Keyed by (project_id, lowercased email) so an
--    admin can invite the same address to the same project only once at a
--    time. All access goes through the functions below, same as
--    project_members -- no direct grants to anon/authenticated.
-- ---------------------------------------------------------------------

create table if not exists nixma.project_invites (
  project_id text not null references nixma.projects(id) on delete cascade,
  email text not null,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, email)
);

alter table nixma.project_invites enable row level security;

-- handle_new_user gains one responsibility: if the email that just signed
-- up matches a pending invite, auto-approve the new profile and attach it
-- to every invited project immediately, instead of leaving it in the
-- "awaiting approval" queue for an admin to notice by hand.
create or replace function nixma.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = nixma
as $$
declare
  has_invite boolean;
begin
  has_invite := exists (
    select 1 from nixma.project_invites where email = lower(new.email)
  );

  insert into nixma.profiles (id, email, full_name, approved, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email = 'gummy@velaris.my' or has_invite,
    new.email = 'gummy@velaris.my'
  )
  on conflict (id) do nothing;

  if has_invite then
    insert into nixma.project_members (project_id, user_id)
    select pi.project_id, new.id
    from nixma.project_invites pi
    where pi.email = lower(new.email)
    on conflict do nothing;

    delete from nixma.project_invites where email = lower(new.email);
  end if;

  return new;
end;
$$;

-- Add-by-email entry point for the Team page. If an account with this
-- email already exists (approved or still pending), attach it to the
-- project right now -- no reason to make the admin wait for a fresh
-- signup when one already happened. Otherwise queue the invite for
-- handle_new_user() to pick up.
create or replace function nixma.invite_project_member(p_project_id text, p_email text)
returns text
language plpgsql
security definer
set search_path = nixma
as $$
declare
  v_email text := lower(trim(p_email));
  v_profile_id uuid;
begin
  if not nixma.is_approved_admin(auth.uid()) then
    raise exception 'Only admins can manage project members';
  end if;

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;

  select id into v_profile_id from nixma.profiles where lower(email) = v_email limit 1;

  if v_profile_id is not null then
    update nixma.profiles set approved = true where id = v_profile_id and approved = false;

    insert into nixma.project_members (project_id, user_id)
    values (p_project_id, v_profile_id)
    on conflict do nothing;

    return 'added';
  end if;

  insert into nixma.project_invites (project_id, email, invited_by)
  values (p_project_id, v_email, auth.uid())
  on conflict (project_id, email) do nothing;

  return 'invited';
end;
$$;

grant execute on function nixma.invite_project_member(text, text) to authenticated;

create or replace function nixma.list_project_invites(p_project_id text)
returns table (email text, created_at timestamptz)
language plpgsql
security definer
set search_path = nixma
as $$
begin
  if not nixma.can_access_project(p_project_id, auth.uid()) then
    raise exception 'Not authorized for this project';
  end if;

  return query
    select pi.email, pi.created_at
    from nixma.project_invites pi
    where pi.project_id = p_project_id
    order by pi.created_at asc;
end;
$$;

grant execute on function nixma.list_project_invites(text) to authenticated;

create or replace function nixma.cancel_project_invite(p_project_id text, p_email text)
returns void
language plpgsql
security definer
set search_path = nixma
as $$
begin
  if not nixma.is_approved_admin(auth.uid()) then
    raise exception 'Only admins can manage project members';
  end if;

  delete from nixma.project_invites
  where project_id = p_project_id and email = lower(trim(p_email));
end;
$$;

grant execute on function nixma.cancel_project_invite(text, text) to authenticated;
