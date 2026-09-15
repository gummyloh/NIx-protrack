-- Points the clone default at the newly-split-off master template instead
-- of Liquick's live project, and keeps template rows out of the normal
-- project listing so they don't clutter the Projects page or Team
-- accordion.
CREATE OR REPLACE FUNCTION nixma.create_project_from_template(
  p_new_project_id text,
  p_name text,
  p_customer text,
  p_project_code text,
  p_kickoff_date date,
  p_source_project_id text DEFAULT 'master-template'::text
)
RETURNS TABLE(project_id text, customer_pin text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'nixma'
AS $function$
declare
  source_kickoff date;
  date_offset integer;
  id_offset integer;
  target_end date;
  new_pin text;
begin
  if auth.uid() is null then
    raise exception 'Not authorized';
  end if;

  if exists (select 1 from nixma.projects where id = p_new_project_id) then
    raise exception 'Project id % already exists', p_new_project_id;
  end if;

  select min(t.planned_start) into source_kickoff
  from nixma.tasks t where t.project_id = p_source_project_id;

  if source_kickoff is null then
    raise exception 'Source project % has no tasks to clone', p_source_project_id;
  end if;

  date_offset := p_kickoff_date - source_kickoff;

  select max(t.planned_finish) + date_offset into target_end
  from nixma.tasks t where t.project_id = p_source_project_id;

  new_pin := nixma.generate_unique_customer_pin();

  insert into nixma.projects (id, name, customer, project_code, kickoff_date, target_end_date, customer_password)
  values (p_new_project_id, p_name, p_customer, p_project_code, p_kickoff_date, target_end, extensions.crypt(new_pin, extensions.gen_salt('bf')));

  select coalesce(max(id), 0) into id_offset from nixma.tasks;

  insert into nixma.tasks (
    id, project_id, phase, task_no, description, duration_days,
    planned_start, planned_finish, indent_level, parent_id,
    department, is_summary, is_active, assignee,
    predecessor_id, lag_days, scheduled_start, scheduled_finish,
    actual_start, actual_finish, percent_complete, status_note,
    updated_by, updated_at, show_to_client
  )
  select
    t.id + id_offset, p_new_project_id, t.phase, t.task_no, t.description, t.duration_days,
    t.planned_start + date_offset, t.planned_finish + date_offset, t.indent_level,
    case when t.parent_id is null then null else t.parent_id + id_offset end,
    t.department, t.is_summary, true, null,
    case when t.predecessor_id is null then null else t.predecessor_id + id_offset end,
    t.lag_days, t.planned_start + date_offset, t.planned_finish + date_offset,
    null, null, 0, null, null, null, true
  from nixma.tasks t where t.project_id = p_source_project_id;

  return query select p_new_project_id, new_pin;
end;
$function$;

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
  order by created_at desc;
$function$;
