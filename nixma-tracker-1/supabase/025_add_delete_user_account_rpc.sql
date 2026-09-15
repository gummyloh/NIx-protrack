-- Real account deletion (profile + project_members + the actual Supabase
-- Auth login, the latter handled by app/api/team-delete-user, not SQL) --
-- distinct from "Revoke access", which only flips approved back to false
-- and leaves the account intact. Admin-only, blocks deleting yourself, and
-- refuses to delete the last remaining admin so there's no path to
-- locking everyone out.
CREATE OR REPLACE FUNCTION nixma.delete_user_account(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'nixma'
AS $function$
declare
  target_email text;
  remaining_admins int;
begin
  if not nixma.is_approved_admin(auth.uid()) then
    raise exception 'Only admins can delete team accounts';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You can''t delete your own account from here';
  end if;

  select email into target_email from nixma.profiles where id = p_user_id;
  if target_email is null then
    raise exception 'No such team account';
  end if;

  select count(*) into remaining_admins
  from nixma.profiles
  where is_admin = true and approved = true and id <> p_user_id;
  if remaining_admins < 1 then
    raise exception 'Can''t delete the last remaining admin';
  end if;

  delete from nixma.project_members where user_id = p_user_id;
  delete from nixma.profiles where id = p_user_id;
end;
$function$;
