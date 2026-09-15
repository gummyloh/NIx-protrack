-- Admin-only aggregate for the Team page's collapsed-row badges ("3
-- members - 1 pending") -- one query across every project instead of
-- fetching each project's full member/invite lists just to display a count.
CREATE OR REPLACE FUNCTION nixma.list_project_membership_summary()
RETURNS TABLE(project_id text, member_count bigint, pending_invite_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'nixma'
AS $function$
begin
  if not nixma.is_approved_admin(auth.uid()) then
    raise exception 'Only admins can view project membership';
  end if;

  return query
    select
      p.id,
      coalesce(m.cnt, 0) as member_count,
      coalesce(i.cnt, 0) as pending_invite_count
    from nixma.projects p
    left join (
      select pm.project_id, count(*) as cnt
      from nixma.project_members pm
      group by pm.project_id
    ) m on m.project_id = p.id
    left join (
      select pi.project_id, count(*) as cnt
      from nixma.project_invites pi
      group by pi.project_id
    ) i on i.project_id = p.id;
end;
$function$;
