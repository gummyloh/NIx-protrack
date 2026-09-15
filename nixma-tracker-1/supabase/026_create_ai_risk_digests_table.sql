-- Cache table for the AI risk digest (app/api/ai/risk-digest) -- one row
-- per project, upserted via the service-role client so it persists across
-- page reloads instead of vanishing the moment you navigate away. RLS
-- mirrors tasks' own SELECT policy exactly: anyone who can already see a
-- project's tasks can see its risk digest.
create table if not exists nixma.ai_risk_digests (
  project_id text primary key,
  content jsonb not null,
  generated_at timestamptz not null default now()
);

alter table nixma.ai_risk_digests enable row level security;

drop policy if exists "ai risk digests readable by project members" on nixma.ai_risk_digests;
create policy "ai risk digests readable by project members"
  on nixma.ai_risk_digests for select
  using (auth.uid() is not null and nixma.can_access_project(project_id, auth.uid()));
