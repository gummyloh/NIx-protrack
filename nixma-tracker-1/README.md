# Nixma Project Tracker

A live project schedule tracker for Nixma Test Solutions, built as a
reusable multi-project template. Piloted on the Liquick GO Pack N Seal
project for Teleflex Malaysia (MH063).

Live at: https://nixma-project-tracker-gummylohs-projects.vercel.app

## Stack

Next.js 14 (App Router, TypeScript, Tailwind) · Supabase (Postgres +
Storage) · Vercel.

## Views

| Route | What it's for |
|---|---|
| `/internal` | Dashboard — overall status, department health, needs-attention list, recent activity |
| `/internal/board` | Monday.com-style board grouped by department, colored status/priority pills |
| `/internal/tasks` | Task table — toggle which template tasks apply to this project, quick notes |
| `/internal/gantt` | Drag-resize Gantt chart; **click a bar** to edit dates/%/notes directly; downstream tasks auto-shift |
| `/internal/meetings` | Internal + client-facing meeting notes, `.docx` upload |
| `/internal/photos` | Internal photo archive (not customer-facing) |
| `/internal/projects` | List all projects; clone the template into a new one |
| `/customer` | Read-only, password-gated customer status page |

Every internal page reads its project from `?project=<id>` in the URL
(falls back to the original Teleflex project if omitted), via
`lib/useProjectId.ts`. No login on the internal side yet — anyone with the
link can edit. Each person types their name once (saved in the browser)
and it's stamped on their edits.

## Data model

Everything lives in the `nixma` schema of a shared Supabase project (not
`public`, so it doesn't collide with other apps in the same project). Key
tables:

- **`projects`** — one row per project; `customer_password` column is
  never exposed to `anon` directly (see security notes below).
- **`tasks`** — the task list. `planned_start`/`planned_finish` are the
  frozen baseline ("days behind schedule" is always measured against
  these). `scheduled_start`/`scheduled_finish` are the live plan, edited
  via the Gantt view, and shift downstream automatically when a
  predecessor's finish date moves (`lib/cascade.ts`). `is_active` lets a
  project instance turn template tasks on/off without deleting them.
- **`meeting_notes`** — `audience` is `'internal'` or `'client'`.
- **`photos`** — internal archive; files live in a private
  `project-photos` Storage bucket, served via signed URLs.

Migrations are in `supabase/`, numbered in the order they were applied —
run them in order against a fresh project.

### Multi-project cloning

`nixma.create_project_from_template(...)` (in migration 006) clones every
task from a source project into a new one: it shifts all dates by the
difference between the new kickoff date and the source's earliest
`planned_start`, and remaps task/predecessor/parent IDs into a fresh block
so they never collide with the source. Progress fields reset to zero —
it's a template clone, not a copy of someone's in-progress work.

### Security model

The internal side has no auth yet (anyone with the link can view/edit) —
that's a deliberate phase-1 tradeoff, not an oversight. The customer side
is a real boundary, though: `meeting_notes` has **no direct anon
select/insert policy** on the table itself. Everything goes through
Postgres functions:

- `list_internal_meeting_notes(project_id)` — no password, matches the
  open internal model, returns both audiences (internal team needs to see
  what was told to the customer).
- `list_client_meeting_notes(project_id, password)` — re-checks the
  password against `projects.customer_password` **inside the function**,
  not just via a cookie set earlier. Even a forged session cookie can't
  pull client notes without the real password matching in the database.

The customer-facing meeting notes API route (`/api/customer-meeting-notes`)
reads the httpOnly session cookie server-side and calls the password-gated
function — the raw password never reaches client-side JavaScript after
login.

## Known limitations / not built yet

- **AI-assisted meeting note formatting** isn't wired in — needs an
  Anthropic API key configured server-side, which hasn't been set up.
  Notes are stored as-is (`formatted_content` currently mirrors
  `raw_content`). In the meantime the workflow is: paste raw notes to
  Claude in chat, get them formatted, and have Claude write them
  directly into `meeting_notes` via the Supabase connector.
- **Customer login is single-project** — `/customer` and its login route
  are hardcoded to the original Teleflex project. New projects created via
  the wizard get a full internal view immediately, but wiring up their own
  customer-facing login is a follow-on step.
- **PDF export / curated customer snapshot** — discussed but not built.
  The idea: pick specific updates/photos/schedule view to hand to a
  customer without a login, instead of (or alongside) the live
  password-gated view.
- **`.docx` only** for meeting note uploads (via `mammoth`, parsed
  client-side). Pages files need exporting to Word first; PDF upload
  isn't supported yet.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in Supabase URL/anon key if not using the baked-in fallback
npm run dev
```

`lib/supabase.ts` has hardcoded fallback credentials for the live Supabase
project so the app works without any env vars set — the anon key is
meant to be public (protection comes from RLS/functions, not secrecy).
Override via `.env.local` if pointing at a different Supabase project.

## Deploying

Deployed to Vercel under the project name `nixma-project-tracker`. Project
settings auto-detect Next.js; no special build configuration needed.
