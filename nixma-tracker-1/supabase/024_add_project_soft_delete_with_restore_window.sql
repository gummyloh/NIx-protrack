-- Soft delete for projects with a 5-hour restore window. deleted_at is
-- checked by list_projects (below) and can_access_project so a deleted
-- project disappears from every list and loses non-admin access
-- immediately; admins keep access so they can still review/restore it.
-- list_recently_deleted_projects lazily hard-deletes (a real cascading
-- DELETE -- every project_id-scoped table already has ON DELETE CASCADE)
-- anything past the 5-hour window before returning what's still
-- restorable, rather than needing a cron job.
alter table nixma.projects add column if not exists deleted_at timestamptz;

CREATE OR REPLACE FUNCTION nixma.list_projects()
RETURNS TABLE(id text, name text, customer text, project_code text, kickoff_date date, target_buyoff_date date, target_end_date date, created_at timestamp with time zone)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'nixma'
AS $function$
  select id, name, customer, project_code, kickoff_date, target_buyoff_date, target_end_date, created_at
  from nixma.projects
  where auth.uid() is not null
    and can_access_project(id, auth.uid())
    and is_template = false
    and deleted_at is null
  order by created_at desc;
$function$;

CREATE OR REPLACE FUNCTION nixma.can_access_project(p_project_id text, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'nixma'
AS $function$
  select
    nixma.is_approved_admin(p_uid)
    or exists (
      select 1 from nixma.project_members pm
      join nixma.projects p on p.id = pm.project_id
      where pm.project_id = p_project_id and pm.user_id = p_uid
        and p.deleted_at is null
    );
$function$;

CREATE OR REPLACE FUNCTION nixma.delete_project(p_project_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'nixma'
AS $function$
declare
  is_tpl boolean;
  already_deleted timestamptz;
begin
  if not nixma.is_approved_admin(auth.uid()) then
    raise exception 'Only admins can delete projects';
  end if;

  select is_template, deleted_at into is_tpl, already_deleted
  from nixma.projects where id = p_project_id;

  if is_tpl is null then
    raise exception 'No such project';
  end if;
  if is_tpl then
    raise exception 'Can''t delete the master template';
  end if;
  if already_deleted is not null then
    raise exception 'Already deleted';
  end if;

  update nixma.projects set deleted_at = now() where id = p_project_id;
end;
$function$;

CREATE OR REPLACE FUNCTION nixma.restore_project(p_project_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'nixma'
AS $function$
declare
  deleted_ts timestamptz;
begin
  if not nixma.is_approved_admin(auth.uid()) then
    raise exception 'Only admins can restore projects';
  end if;

  select deleted_at into deleted_ts from nixma.projects where id = p_project_id;

  if deleted_ts is null then
    raise exception 'Project is not deleted';
  end if;
  if deleted_ts < now() - interval '5 hours' then
    raise exception 'The 5-hour restore window has passed';
  end if;

  update nixma.projects set deleted_at = null where id = p_project_id;
end;
$function$;

CREATE OR REPLACE FUNCTION nixma.list_recently_deleted_projects()
RETURNS TABLE(id text, name text, customer text, project_code text, deleted_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'nixma'
AS $function$
begin
  if not nixma.is_approved_admin(auth.uid()) then
    raise exception 'Only admins can view deleted projects';
  end if;

  delete from nixma.projects
  where deleted_at is not null and deleted_at < now() - interval '5 hours';

  return query
    select p.id, p.name, p.customer, p.project_code, p.deleted_at
    from nixma.projects p
    where p.deleted_at is not null
    order by p.deleted_at desc;
end;
$function$;
