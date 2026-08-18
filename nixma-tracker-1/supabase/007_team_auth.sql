-- 007: Team accounts via Supabase Auth with admin approval.
--
-- Self-signup flow: anyone can create an account (email + password), but a
-- profile row starts with approved = false. An approved admin flips the flag
-- before the person can see any internal page. gummy@velaris.my is
-- auto-approved and made admin by the signup trigger below.

create table if not exists nixma.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  approved boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table nixma.profiles enable row level security;

-- Security-definer helper so admin policies don't recurse into RLS.
create or replace function nixma.is_approved_admin(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = nixma
as $$
  select coalesce(
    (select is_admin and approved from nixma.profiles where id = uid),
    false
  );
$$;

drop policy if exists "read own profile" on nixma.profiles;
create policy "read own profile"
  on nixma.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "admins read all profiles" on nixma.profiles;
create policy "admins read all profiles"
  on nixma.profiles for select
  to authenticated
  using (nixma.is_approved_admin(auth.uid()));

drop policy if exists "admins update profiles" on nixma.profiles;
create policy "admins update profiles"
  on nixma.profiles for update
  to authenticated
  using (nixma.is_approved_admin(auth.uid()));

-- NOTE: deliberately no grant to anon — profiles are only visible when
-- signed in, and only your own row unless you're an approved admin.
grant select, update on nixma.profiles to authenticated;
grant execute on function nixma.is_approved_admin(uuid) to authenticated;

-- Auto-create a profile row whenever someone signs up.
create or replace function nixma.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = nixma
as $$
begin
  insert into nixma.profiles (id, email, full_name, approved, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email = 'gummy@velaris.my',
    new.email = 'gummy@velaris.my'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function nixma.handle_new_user();
