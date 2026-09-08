"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useProjectId, withProject } from "@/lib/useProjectId";
import { ProjectRow } from "@/lib/types";
import ProjectMembersPanel from "./ProjectMembersPanel";

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  approved: boolean;
  is_admin: boolean;
  created_at: string;
}

interface MembershipSummary {
  project_id: string;
  member_count: number;
  pending_invite_count: number;
}

export default function TeamAdmin() {
  const currentProjectId = useProjectId();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [summary, setSummary] = useState<Record<string, MembershipSummary>>({});
  const [projectsLoading, setProjectsLoading] = useState(true);
  // Starts with the project you arrived from already open; every other
  // project starts collapsed until clicked.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([currentProjectId])
  );

  async function load() {
    setLoading(true);
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    setMe(session.user.id);

    const { data, error: err } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true });
    if (err) {
      setError(err.message);
    } else {
      const rows = (data as Profile[]) || [];
      setProfiles(rows);
      setIsAdmin(rows.some((p) => p.id === session.user.id && p.is_admin));
    }
    setLoading(false);
  }

  async function loadProjects() {
    setProjectsLoading(true);
    const [{ data: projectData, error: projErr }, { data: summaryData }] =
      await Promise.all([
        supabase.rpc("list_projects"),
        supabase.rpc("list_project_membership_summary"),
      ]);
    if (projErr) setError(projErr.message);
    setProjects((projectData as ProjectRow[]) || []);
    const byId: Record<string, MembershipSummary> = {};
    for (const row of (summaryData as MembershipSummary[]) || []) {
      byId[row.project_id] = row;
    }
    setSummary(byId);
    setProjectsLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    // list_projects / list_project_membership_summary are admin-only
    // server-side -- don't even fire the calls for a non-admin who lands on
    // this route directly. isAdmin starts false until load() resolves, so
    // this waits for that and simply never runs for anyone who isn't
    // actually an admin.
    if (!isAdmin) {
      setProjectsLoading(false);
      return;
    }
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  function toggle(projectId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  async function patch(id: string, changes: Partial<Profile>) {
    setError(null);
    const { error: err } = await supabase
      .from("profiles")
      .update(changes)
      .eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    setProfiles((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...changes } : p))
    );
  }

  if (loading) {
    return (
      <main className="p-6 md:p-10 max-w-4xl mx-auto">
        <p className="text-sm text-[var(--ink)]/50">Loading…</p>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="p-6 md:p-10 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Team</h1>
        <p className="text-sm text-[var(--ink)]/60">
          Only admins can manage team accounts.
        </p>
      </main>
    );
  }

  const pending = profiles.filter((p) => !p.approved);
  const allApproved = profiles.filter((p) => p.approved);

  return (
    <main className="p-6 md:p-10 max-w-4xl mx-auto">
      <Link
        href={withProject("/internal", currentProjectId)}
        className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 hover:text-[var(--accent)]"
      >
        &larr; Dashboard
      </Link>
      <h1 className="text-2xl font-semibold mt-1 mb-1">Team</h1>
      <p className="text-sm text-[var(--ink)]/60 mb-8">
        Project membership determines who can open each project -- admins
        can always reach every project regardless of the lists below. Click
        a project to manage who's on it.
      </p>

      {error && (
        <div className="mb-4 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      <section className="mb-10">
        <h2 className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 mb-3">
          Project membership
        </h2>

        {projectsLoading ? (
          <p className="text-sm text-[var(--ink)]/50">Loading projects…</p>
        ) : (
          <div className="border border-[var(--line)] rounded-lg bg-white/60 divide-y divide-[var(--line)] overflow-hidden">
            {projects.map((p) => {
              const isOpen = expanded.has(p.id);
              const s = summary[p.id];
              return (
                <div key={p.id}>
                  <button
                    onClick={() => toggle(p.id)}
                    className="w-full flex items-center justify-between gap-4 p-4 text-left hover:bg-[var(--accent)]/5"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{p.name}</p>
                      <p className="text-xs text-[var(--ink)]/50 truncate">
                        {p.customer}
                        {p.project_code ? ` · ${p.project_code}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {s && (
                        <span className="text-xs text-[var(--ink)]/40 font-mono-num">
                          {s.member_count} member{s.member_count === 1 ? "" : "s"}
                          {s.pending_invite_count > 0
                            ? ` · ${s.pending_invite_count} pending`
                            : ""}
                        </span>
                      )}
                      <span className="text-[var(--ink)]/40 text-xs font-mono">
                        {isOpen ? "▲" : "▼"}
                      </span>
                    </div>
                  </button>
                  {isOpen && (
                    <ProjectMembersPanel
                      projectId={p.id}
                      onMembershipChange={loadProjects}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {pending.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-mono uppercase tracking-wide text-[var(--amber)] mb-3">
            Awaiting approval ({pending.length})
          </h2>
          <div className="border border-[var(--line)] rounded-lg bg-white/60 divide-y divide-[var(--line)]">
            {pending.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="font-medium truncate">{p.full_name || "—"}</p>
                  <p className="text-xs text-[var(--ink)]/50 truncate">{p.email}</p>
                </div>
                <button
                  onClick={() => patch(p.id, { approved: true })}
                  className="bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:opacity-90 shrink-0"
                >
                  Approve
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 mb-3">
          All team accounts ({allApproved.length})
        </h2>
        <p className="text-xs text-[var(--ink)]/40 mb-3">
          Account-wide settings -- admin status and login access apply across
          every project, not just this one.
        </p>
        <div className="border border-[var(--line)] rounded-lg bg-white/60 divide-y divide-[var(--line)]">
          {allApproved.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {p.full_name || "—"}
                  {p.is_admin && (
                    <span className="ml-2 text-[10px] font-mono uppercase tracking-wide text-[var(--accent)] border border-[var(--accent)]/40 rounded px-1.5 py-0.5">
                      Admin
                    </span>
                  )}
                </p>
                <p className="text-xs text-[var(--ink)]/50 truncate">{p.email}</p>
              </div>
              {p.id !== me && (
                <div className="flex gap-3 shrink-0 text-xs">
                  <button
                    onClick={() => patch(p.id, { is_admin: !p.is_admin })}
                    className="underline text-[var(--ink)]/60 hover:text-[var(--accent)]"
                  >
                    {p.is_admin ? "Remove admin" : "Make admin"}
                  </button>
                  <button
                    onClick={() => patch(p.id, { approved: false })}
                    className="underline text-[var(--rust)]/70 hover:text-[var(--rust)]"
                  >
                    Revoke access
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
