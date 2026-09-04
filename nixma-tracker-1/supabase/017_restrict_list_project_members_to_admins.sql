-- 017: Close a privacy gap in nixma.list_project_members().
--
-- The function was gated with can_access_project(), which is true for BOTH
-- admins and plain project members. That meant any regular team member --
-- once added to a project -- could call this RPC directly (it's exposed to
-- the "authenticated" Postgres role like every other function here) and get
-- back the full roster for that project, including the is_admin flag for
-- every row. In practice that means a non-admin could discover exactly who
-- the admin is, just by making the same network call the (admin-only) Team
-- page already makes in the background.
--
-- Every sibling function that touches project_members (list_addable_members,
-- add_project_member, remove_project_member, invite_project_member,
-- cancel_project_invite) already checks is_approved_admin() instead --
-- list_project_members was the one inconsistent case. This migration brings
-- it in line: only approved admins can call it now. Regular team members get
-- no team-roster visibility at all (matching what the UI already shows them
-- today -- there's no member-facing "who's on this project" screen yet), so
-- there's nothing left to reveal admin status or headcount through.
--
-- Safe to re-run: create or replace on an existing function, no data change.

create or replace function nixma.list_project_members(p_project_id text)
returns table (user_id uuid, email text, full_name text, is_admin boolean, added_at timestamptz)
language plpgsql
security definer
set search_path = nixma
as $$
begin
  if not nixma.is_approved_admin(auth.uid()) then
    raise exception 'Only admins can view project members';
  end if;

  return query
    select pr.id, pr.email, pr.full_name, pr.is_admin, pm.added_at
    from nixma.project_members pm
    join nixma.profiles pr on pr.id = pm.user_id
    where pm.project_id = p_project_id
    order by pm.added_at asc;
end;
$$;
