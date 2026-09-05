-- 019: Let admins pick specific photos to show on the customer status
-- page, and close two leftover anon-key holes on nixma.photos while we're
-- already changing its access policies for this feature.
--
-- New feature: nixma.photos gets a visible_to_customer flag, off by
-- default. The internal Photo Archive page gets a "Show to customer"
-- toggle per photo; the customer page renders only the ones flagged. This
-- covers every photo regardless of how it was uploaded (task-linked,
-- meeting-linked, or standalone), since they all live in this one table.
--
-- Also fixes a pre-existing gap: migration 009 closed the anon-key
-- cross-project hole for nixma.tasks (select+update), nixma.projects
-- (select), and nixma.photos (insert only) -- but never got to
-- nixma.photos' SELECT and DELETE policies, which were still the original
-- `using (true)` from migration 006. That meant, until this migration,
-- anyone who extracted the public anon key (trivial -- it's in the
-- deployed JS bundle) could read every photo row from every project, and
-- delete any photo from any project, with no login at all. Since we're
-- touching this table's policies anyway for the new toggle, this brings
-- photos in line with the same "authenticated + project member" gate
-- tasks/projects already got.
--
-- Safe to re-run: `add column if not exists`, `drop policy if exists` +
-- `create policy`, `create or replace function`, no data change to
-- existing rows (visible_to_customer defaults to false, so nothing that
-- wasn't already customer-visible becomes visible by applying this).

-- ---------------------------------------------------------------------
-- 1. New column.
-- ---------------------------------------------------------------------

alter table nixma.photos
  add column if not exists visible_to_customer boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. Close the leftover anon-key holes (select + delete), and add the
--    update policy the new toggle needs -- there wasn't one before, since
--    nothing on this table was ever editable in place until now.
-- ---------------------------------------------------------------------

drop policy if exists "photos readable by anyone with anon key" on nixma.photos;
drop policy if exists "photos readable by project members" on nixma.photos;
create policy "photos readable by project members"
  on nixma.photos for select
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));

drop policy if exists "photos deletable by anyone with anon key" on nixma.photos;
drop policy if exists "photos deletable by project members" on nixma.photos;
create policy "photos deletable by project members"
  on nixma.photos for delete
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));

drop policy if exists "photos updatable by project members" on nixma.photos;
create policy "photos updatable by project members"
  on nixma.photos for update
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()))
  with check (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));

grant update on nixma.photos to authenticated;

-- ---------------------------------------------------------------------
-- 3. Customer-facing reads: same password/token dual-path every other
--    customer feature uses. Returns only photos an admin has explicitly
--    flagged -- storage_path is handed back to the server route, which
--    turns it into a signed URL server-side (the customer's browser never
--    gets direct storage access, same as it never gets direct table
--    access).
-- ---------------------------------------------------------------------

create or replace function nixma.list_client_photos(p_project_id text, p_password text)
returns table (id uuid, storage_path text, caption text, taken_date date)
language sql
security definer
set search_path = nixma
as $$
  select ph.id, ph.storage_path, ph.caption, ph.taken_date
  from nixma.photos ph
  where ph.project_id = p_project_id
    and ph.visible_to_customer = true
    and exists (
      select 1 from nixma.projects p
      where p.id = p_project_id and p.customer_password = extensions.crypt(p_password, p.customer_password)
    )
  order by ph.taken_date desc, ph.created_at desc;
$$;

grant execute on function nixma.list_client_photos(text, text) to anon, authenticated;

create or replace function nixma.list_client_photos_by_token(p_project_id text, p_token text)
returns table (id uuid, storage_path text, caption text, taken_date date)
language sql
security definer
set search_path = nixma
as $$
  select ph.id, ph.storage_path, ph.caption, ph.taken_date
  from nixma.photos ph
  where ph.project_id = p_project_id
    and ph.visible_to_customer = true
    and exists (
      select 1 from nixma.projects p
      where p.id = p_project_id and p.customer_access_token = p_token
    )
  order by ph.taken_date desc, ph.created_at desc;
$$;

grant execute on function nixma.list_client_photos_by_token(text, text) to anon, authenticated;
