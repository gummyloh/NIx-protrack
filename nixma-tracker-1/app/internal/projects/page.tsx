"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ProjectRow } from "@/lib/types";
import { withProject, DEFAULT_PROJECT_ID } from "@/lib/useProjectId";
import { useInternalAuth } from "@/lib/internalAuth";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function ProjectsPage() {
  const { isAdmin } = useInternalAuth();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState("");
  const [customer, setCustomer] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [kickoffDate, setKickoffDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newProjectPin, setNewProjectPin] = useState<{ project_id: string; customer_pin: string } | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [revealedPins, setRevealedPins] = useState<Record<string, string>>({});

  async function loadProjects() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("list_projects");
    if (err) setError(err.message);
    else setProjects((data as ProjectRow[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    loadProjects();
  }, []);

  async function handleCreate() {
    if (!name.trim() || !customer.trim()) {
      setError("Project name and customer are required.");
      return;
    }
    const newId = slugify(name);
    if (!newId) {
      setError("Couldn't generate a valid project id from that name -- try adding a letter or two.");
      return;
    }
    setCreating(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("create_project_from_template", {
      p_new_project_id: newId,
      p_name: name.trim(),
      p_customer: customer.trim(),
      p_project_code: projectCode.trim() || null,
      p_kickoff_date: kickoffDate,
      p_source_project_id: DEFAULT_PROJECT_ID,
    });
    setCreating(false);
    if (err) {
      setError(err.message);
      return;
    }
    const row = (data as { project_id: string; customer_pin: string }[] | null)?.[0] ?? null;
    setName("");
    setCustomer("");
    setProjectCode("");
    setShowForm(false);
    setNewProjectPin(row);
    await loadProjects();
  }

  async function handleResetPin(projectId: string) {
    if (!confirm("Reset this project's customer PIN? The old PIN will stop working immediately.")) {
      return;
    }
    setResettingId(projectId);
    setError(null);
    const { data, error: err } = await supabase.rpc("reset_customer_pin", {
      p_project_id: projectId,
    });
    setResettingId(null);
    if (err) {
      setError(err.message);
      return;
    }
    setRevealedPins((prev) => ({ ...prev, [projectId]: data as string }));
  }

  return (
    <main className="p-6 md:p-10 max-w-4xl mx-auto">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-[var(--ink)]/60">
            {isAdmin
              ? "Every new project starts as a full copy of Liquick GO Pack N Seal’s 74-task structure, with dates shifted to your new kickoff date. Switch which tasks apply in that project’s Task Table afterward."
              : "Projects you've been added to."}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className="text-sm bg-[var(--accent)] text-white rounded px-3 py-1.5 font-medium h-fit"
          >
            {showForm ? "Cancel" : "+ New project"}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      {newProjectPin && (
        <div className="mb-4 flex items-center justify-between gap-3 text-sm bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded px-3 py-2">
          <span>
            Customer PIN for <span className="font-medium">{newProjectPin.project_id}</span>:{" "}
            <span className="font-mono-num font-semibold">{newProjectPin.customer_pin}</span> — share
            this with the customer now, it won&apos;t be shown again.
          </span>
          <button
            onClick={() => setNewProjectPin(null)}
            className="text-[var(--ink)]/40 hover:text-[var(--ink)]/70 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {showForm && (
        <div className="border border-[var(--line)] rounded-lg p-5 bg-white/60 mb-6 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 block mb-1">
                Project name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Bottle Capper"
                className="border border-[var(--line)] rounded px-2 py-1.5 text-sm w-full bg-white"
              />
              {name && (
                <p className="text-xs text-[var(--ink)]/40 mt-1">
                  URL id: <span className="font-mono">{slugify(name) || "(needs a letter)"}</span>
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 block mb-1">
                Customer
              </label>
              <input
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder="e.g. Acme Corp, Penang"
                className="border border-[var(--line)] rounded px-2 py-1.5 text-sm w-full bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 block mb-1">
                Project code (optional)
              </label>
              <input
                value={projectCode}
                onChange={(e) => setProjectCode(e.target.value)}
                placeholder="e.g. MH070"
                className="border border-[var(--line)] rounded px-2 py-1.5 text-sm w-full bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 block mb-1">
                Kick-off date
              </label>
              <input
                type="date"
                value={kickoffDate}
                onChange={(e) => setKickoffDate(e.target.value)}
                className="border border-[var(--line)] rounded px-2 py-1.5 text-sm w-full bg-white"
              />
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="text-sm bg-[var(--accent)] text-white rounded px-4 py-1.5 font-medium disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create project"}
          </button>
          <p className="text-xs text-[var(--ink)]/40">
            A 6-digit access PIN is generated automatically when you create
            the project -- it&apos;ll be shown once, right here, so you can
            pass it on to the customer for the login page at /customer/login.
            You can generate a new one anytime from "Reset PIN" below.
          </p>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--ink)]/50">Loading…</p>
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="border border-[var(--line)] rounded-lg p-4 bg-white/60 hover:border-[var(--accent)] transition-colors"
            >
              <div className="flex items-center justify-between gap-4">
                <Link
                  href={withProject("/internal", p.id)}
                  className="flex-1 flex items-center justify-between gap-4"
                >
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-[var(--ink)]/50">
                      {p.customer}
                      {p.project_code ? ` · ${p.project_code}` : ""}
                    </p>
                  </div>
                  <p className="text-xs text-[var(--ink)]/40 font-mono-num">
                    Kickoff {fmtDate(p.kickoff_date)}
                  </p>
                </Link>
                {isAdmin && (
                  <button
                    onClick={() => handleResetPin(p.id)}
                    disabled={resettingId === p.id}
                    className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 border border-[var(--line)] rounded px-2 py-1 hover:text-[var(--accent)] hover:border-[var(--accent)] disabled:opacity-50 shrink-0"
                  >
                    {resettingId === p.id ? "…" : "Reset PIN"}
                  </button>
                )}
              </div>
              {revealedPins[p.id] && (
                <p className="text-xs mt-2 bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded px-2 py-1.5 font-mono-num">
                  New PIN for {p.customer}:{" "}
                  <span className="font-semibold">{revealedPins[p.id]}</span> — share this with
                  them now, it won&apos;t be shown again.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
