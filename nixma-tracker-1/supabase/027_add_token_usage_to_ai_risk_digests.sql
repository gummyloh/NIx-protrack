-- Token usage / estimated cost for a risk digest run, so the actual number
-- from Anthropic's API response is visible in the app instead of only
-- being knowable from Anthropic's own console.
alter table nixma.ai_risk_digests
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists estimated_cost_usd numeric;
