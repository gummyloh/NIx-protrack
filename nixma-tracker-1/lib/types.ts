export type TaskStatus =
  | "not_started"
  | "on_track"
  | "at_risk"
  | "delayed"
  | "completed";

export interface Task {
  id: number;
  project_id: string;
  phase: number;
  task_no: number;
  description: string;
  duration_days: number;
  planned_start: string; // ISO date -- baseline, frozen
  planned_finish: string; // ISO date -- baseline, frozen
  indent_level: number;
  parent_id: number | null;
  department: string;
  is_summary: boolean;
  is_active: boolean; // whether this task applies to the current project instance
  assignee: string | null;
  predecessor_id: number | null;
  lag_days: number;
  scheduled_start: string; // ISO date -- current live plan; edited via the Gantt view
  scheduled_finish: string; // ISO date -- current live plan; edited via the Gantt view
  // Still present in the database (kept for the cascade's "what really
  // happened" comparison and for historical data), but no longer exposed
  // as separate editable fields in the table UI -- Gantt editing sets
  // actual_finish automatically when percent_complete reaches 100.
  actual_start: string | null;
  actual_finish: string | null;
  percent_complete: number; // 0-100, edited via Gantt
  status_note: string | null;
  updated_by: string | null;
  updated_at: string | null;
  show_to_client: boolean; // included in the next published client update?
  // Which machine module(s)/station(s) this task belongs to, e.g.
  // "Vacuum Suction & Mandrel Insertion". Most master-schedule tasks are
  // generic process steps (design sign-off, procurement, ...) that apply to
  // the whole machine, so these are null for most rows -- only set for
  // tasks that map onto a specific station in the punch list. A task can
  // span more than one station (rare), hence arrays rather than a single
  // value.
  modules: string[] | null;
  stations: string[] | null;
}

export type NoteAudience = "internal" | "client";

export interface MeetingNote {
  id: string;
  project_id: string;
  audience: NoteAudience;
  title: string;
  meeting_date: string; // ISO date
  raw_content: string | null;
  formatted_content: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Photo {
  id: string;
  project_id: string;
  task_id: number | null;
  meeting_note_id: string | null;
  storage_path: string;
  caption: string | null;
  taken_by: string | null;
  taken_date: string;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  customer: string;
  project_code: string | null;
  kickoff_date: string | null;
  target_buyoff_date: string | null;
  target_end_date: string | null;
  created_at: string;
}

export type PunchSeverity = "blocker" | "minor" | "cosmetic";
export type PunchStatus = "open" | "closed" | "waived";

export interface ModuleRow {
  id: number;
  project_id: string;
  name: string;
  sequence: number;
  created_at: string;
}

export interface StationRow {
  id: number;
  module_id: number;
  project_id: string;
  name: string;
  sequence: number;
  created_at: string;
}

export interface PunchItem {
  id: number;
  station_id: number;
  project_id: string;
  description: string;
  severity: PunchSeverity;
  status: PunchStatus;
  show_to_client: boolean;
  linked_task_id: number | null;
  created_at: string;
  created_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  // Carried over from the flat Teleflex punch list this table was migrated
  // from (see supabase/015). All optional -- a punch item logged fresh from
  // the Modules page going forward only needs description/severity, but
  // migrated rows keep their original detail here rather than losing it.
  item_no: number | null;
  category: string | null;
  priority: string | null; // original Critical/High/Medium/Low, kept for reference; severity is what drives readiness now
  percent_complete: number | null;
  target_date: string | null; // ISO date
  pic: string | null; // person in charge, freeform name
  remarks: string | null;
  acceptance_criteria: string | null;
  source: string;
}

export const DEPARTMENTS = [
  "Project Management",
  "Mechanical",
  "Electrical",
  "Software/Controls",
  "Procurement",
  "Manufacturing",
  "Assembly",
  "Debug & Test",
  "QA",
  "Logistics",
  "Documentation",
  "Installation",
] as const;

export type Department = (typeof DEPARTMENTS)[number];
