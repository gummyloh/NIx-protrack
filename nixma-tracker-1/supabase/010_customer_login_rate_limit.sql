-- 010: Basic rate limiting on /api/customer-login.
--
-- Nothing today stops repeated password guesses against
-- find_project_by_customer_password -- it's a single bcrypt comparison
-- with no throttle, callable directly by anyone with the anon key. This
-- adds a small per-IP attempt counter, checked (and recorded) before the
-- route even looks at the password, so a brute-force script gets a 429
-- instead of unlimited tries.

create table if not exists nixma.login_attempts (
  id bigserial primary key,
  ip text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_login_attempts_ip_time
  on nixma.login_attempts (ip, created_at);

-- Same posture as nixma.meeting_notes: RLS on, no policies -- only reachable
-- through the SECURITY DEFINER function below, never directly.
alter table nixma.login_attempts enable row level security;

-- Returns true if this IP is still under the attempt limit for the window
-- (and records this attempt), false if it should be blocked. Old rows are
-- opportunistically swept out on every call so the table doesn't grow
-- unbounded.
create or replace function nixma.check_login_rate_limit(
  p_ip text,
  p_max_attempts int default 8,
  p_window_minutes int default 15
) returns boolean
language plpgsql
security definer
set search_path = nixma
as $$
declare
  recent_count int;
begin
  delete from nixma.login_attempts
  where created_at < now() - make_interval(mins => p_window_minutes * 4);

  select count(*) into recent_count
  from nixma.login_attempts
  where ip = p_ip
    and created_at > now() - make_interval(mins => p_window_minutes);

  if recent_count >= p_max_attempts then
    return false;
  end if;

  insert into nixma.login_attempts (ip) values (p_ip);
  return true;
end;
$$;

grant execute on function nixma.check_login_rate_limit(text, int, int) to anon, authenticated;
