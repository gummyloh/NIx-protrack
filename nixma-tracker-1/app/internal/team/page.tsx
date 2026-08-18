"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useProjectId, withProject } from "@/lib/useProjectId";

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  approved: boolean;
  is_admin: boolean;
  created_at: string;
}

interface ProjectMember {
  user_id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  added_at: string;
}

interface AddableMember {
  id: string;
  email: string;
  full_name: string | null;
}

interface ProjectRow {
  name: string;
  customer: string;
  project_code: string | null;
}

export default function TeamAdmin() {
  const projectId = useProjectId();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [addable, setAddable] = useState<AddableMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [selectedToAdd, setSelectedToAdd] = useState("");
  const [addingMember, setAddingMember] = useState(false);

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

  async function loadProjectMembers() {
    setMembersLoading(true);
    const [{ data: projectData }, { data: memberData, error: memberErr }, { data: addableData }] =
      await Promise.all([
        supabase
          .from("projects")
          .select("name, customer, project_code")
          .eq("id", projectId)
          .single(),
        supabase.rpc("list_project_members", { p_project_id: projectId }),
        supabase.rpc("list_addable_members", { p_project_id: projectId }),
      ]);
    setProject((projectData as ProjectRow) || null);
    if (memberErr) setError(memberErr.message);
    setMembers((memberData as ProjectMember[]) || []);
    setAddable((addableData as AddableMember[]) || []);
    setMembersLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadProjectMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

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

  async function addMember() {
    if (!selectedToAdd) return;
    setAddingMember(true);
    setError(null);
    const { error: err } = await supabase.rpc("add_project_member", {
      p_project_id: projectId,
      p_user_id: selectedToAdd,
    });
    setAddingMember(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSelectedToAdd("");
    await loadProjectMembers();
  }

  async function removeMember(userId: string) {
    setError(null);
    const { error: err } = await supabase.rpc("remove_project_member", {
      p_project_id: projectId,
      p_user_id: userId,
    });
    if (err) {
      setError(err.message);
      return;
    }
    await loadProjectMembers();
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
        href={withProject("/internal", projectId)}
        className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 hover:text-[var(--accent)]"
      >
        &larr; Dashboard
      </Link>
      <h1 className="text-2xl font-semibold mt-1 mb-1">Team</h1>
      <p className="text-sm text-[var(--ink)]/60 mb-8">
        Project membership determines who can open{" "}
        <span className="font-medium">{project?.name ?? "this project"}</span>
        {project?.customer ? ` (${project.customer})` : ""} -- admins can
        always reach every project regardless of the list below.
      </p>

      {error && (
        <div className="mb-4 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      <section className="mb-10">
        <h2 className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 mb-3">
          Members of this project
        </h2>

        <div className="border border-[var(--line)] rounded-lg p-4 bg-white/60 mb-3 flex items-center gap-3 flex-wrap">
          <select
            value={selectedToAdd}
            onChange={(e) => setSelectedToAdd(e.target.value)}
            className="border border-[var(--line)] rounded px-2 py-1.5 text-sm bg-white flex-1 min-w-[200px]"
          >
            <option value="">
              {addable.length === 0 ? "No approved accounts left to add" : "Choose an account to add…"}
            </option>
            {addable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name || a.email} ({a.email})
              </option>
            ))}
          </select>
          <button
            onClick={addMember}
            disabled={!selectedToAdd || addingMember}
            className="text-sm bg-[var(--accent)] text-white rounded px-3 py-1.5 font-medium disabled:opacity-50"
          >
            {addingMember ? "Adding…" : "Add to project"}
          </button>
        </div>

        {membersLoading ? (
          <p className="text-sm text-[var(--ink)]/50">Loading members…</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-[var(--ink)]/50">
            No one's been explicitly added yet -- only admins can open this project.
          </p>
        ) : (
          <div className="border border-[var(--line)] rounded-lg bg-white/60 divide-y divide-[var(--line)]">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {m.full_name || "—"}
                    {m.is_admin && (
                      <span className="ml-2 text-[10px] font-mono uppercase tracking-wide text-[var(--accent)] border border-[var(--accent)]/40 rounded px-1.5 py-0.5">
                        Admin
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--ink)]/50 truncate">{m.email}</p>
                </div>
                <button
                  onClick={() => removeMember(m.user_id)}
                  className="text-xs underline text-[var(--ink)]/40 hover:text-[var(--rust)] shrink-0"
                >
                  Remove from project
                </button>
              </div>
            ))}
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
