"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

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

interface ProjectInvite {
  email: string;
  created_at: string;
}

/**
 * Member management for a single project -- the "Members of this project"
 * section that used to be the whole Team page, before Team became an
 * accordion of every project. Mounted only while its row is expanded, so
 * it fetches its own data on mount rather than the page loading every
 * project's membership up front.
 *
 * onMembershipChange fires after any add/remove/invite action so the
 * collapsed-row summary counts on the parent page can be refreshed without
 * a full reload.
 */
export default function ProjectMembersPanel({
  projectId,
  onMembershipChange,
}: {
  projectId: string;
  onMembershipChange?: () => void;
}) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [addable, setAddable] = useState<AddableMember[]>([]);
  const [invites, setInvites] = useState<ProjectInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedToAdd, setSelectedToAdd] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [resendingEmail, setResendingEmail] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [
      { data: memberData, error: memberErr },
      { data: addableData },
      { data: inviteData },
    ] = await Promise.all([
      supabase.rpc("list_project_members", { p_project_id: projectId }),
      supabase.rpc("list_addable_members", { p_project_id: projectId }),
      supabase.rpc("list_project_invites", { p_project_id: projectId }),
    ]);
    if (memberErr) setError(memberErr.message);
    setMembers((memberData as ProjectMember[]) || []);
    setAddable((addableData as AddableMember[]) || []);
    setInvites((inviteData as ProjectInvite[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

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
    await load();
    onMembershipChange?.();
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
    await load();
    onMembershipChange?.();
  }

  // Shared by the "Add by email" form and the "Resend" button on a pending
  // invite -- both just need the same call made against a different email
  // and a different message to show for the result.
  async function sendInvite(email: string): Promise<{
    ok: boolean;
    message: string;
  }> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return { ok: false, message: "Your session expired -- please sign in again." };
    }
    let res: Response;
    try {
      res = await fetch("/api/team-invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ project_id: projectId, email }),
      });
    } catch {
      return { ok: false, message: "Couldn't reach the server -- check your connection and try again." };
    }
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, message: data.error || "Something went wrong." };
    }
    if (data.result === "added") {
      return { ok: true, message: `${email} already had an account -- added to the project right away.` };
    }
    // result === "invited"
    if (data.emailSent) {
      return { ok: true, message: `Invite email sent to ${email}. They'll land on the project as soon as they set a password.` };
    }
    return {
      ok: true,
      message: `Saved -- but the invite email didn't go out (${data.emailError || "unknown reason"}). They can still get in by signing up manually at /signup with that exact email.`,
    };
  }

  async function inviteByEmail(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true);
    setError(null);
    setInviteMessage(null);
    const result = await sendInvite(email);
    setInviting(false);
    setInviteMessage(result.message);
    if (result.ok) setInviteEmail("");
    await load();
    onMembershipChange?.();
  }

  async function resendInvite(email: string) {
    setResendingEmail(email);
    setError(null);
    setInviteMessage(null);
    const result = await sendInvite(email);
    setResendingEmail(null);
    setInviteMessage(result.message);
    await load();
  }

  async function cancelInvite(email: string) {
    setError(null);
    const { error: err } = await supabase.rpc("cancel_project_invite", {
      p_project_id: projectId,
      p_email: email,
    });
    if (err) {
      setError(err.message);
      return;
    }
    await load();
    onMembershipChange?.();
  }

  return (
    <div className="p-4 border-t border-[var(--line)] bg-[var(--paper)]/40">
      {error && (
        <div className="mb-3 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      <form
        onSubmit={inviteByEmail}
        className="border border-[var(--line)] rounded-lg p-4 bg-white/60 mb-3 flex items-center gap-3 flex-wrap"
      >
        <input
          type="email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="Add by email — someone@company.com"
          className="border border-[var(--line)] rounded px-2.5 py-1.5 text-sm bg-white flex-1 min-w-[220px]"
        />
        <button
          type="submit"
          disabled={!inviteEmail.trim() || inviting}
          className="text-sm bg-[var(--accent)] text-white rounded px-3 py-1.5 font-medium disabled:opacity-50 shrink-0"
        >
          {inviting ? "Adding…" : "Add by email"}
        </button>
      </form>
      {inviteMessage && (
        <p className="text-xs text-[var(--ink)]/60 mb-3">{inviteMessage}</p>
      )}
      <p className="text-xs text-[var(--ink)]/40 mb-4">
        If they already have an account, they're added right away. If not,
        we send them a real invite email with a link to set a password --
        they land on the project the moment they use it. They can also
        always just sign up manually at /signup with that exact email if
        the email doesn't arrive.
      </p>

      {addable.length > 0 && (
        <div className="border border-[var(--line)] rounded-lg p-4 bg-white/60 mb-3 flex items-center gap-3 flex-wrap">
          <select
            value={selectedToAdd}
            onChange={(e) => setSelectedToAdd(e.target.value)}
            className="border border-[var(--line)] rounded px-2 py-1.5 text-sm bg-white flex-1 min-w-[200px]"
          >
            <option value="">Or choose an existing account to add…</option>
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
      )}

      {invites.length > 0 && (
        <div className="border border-[var(--line)] rounded-lg bg-white/60 divide-y divide-[var(--line)] mb-3">
          {invites.map((inv) => (
            <div key={inv.email} className="flex items-center justify-between gap-4 p-3">
              <p className="text-sm text-[var(--ink)]/70 truncate">
                {inv.email}{" "}
                <span className="text-xs text-[var(--ink)]/40">— awaiting sign-up</span>
              </p>
              <div className="flex items-center gap-3 shrink-0 text-xs">
                <button
                  onClick={() => resendInvite(inv.email)}
                  disabled={resendingEmail === inv.email}
                  className="underline text-[var(--ink)]/40 hover:text-[var(--accent)] disabled:opacity-50"
                  title="Re-sends the invite email. If they already opened the first one, Supabase may report the account as already pending rather than sending a fresh link -- point them at /signup directly if a resend doesn't help."
                >
                  {resendingEmail === inv.email ? "Resending…" : "Resend"}
                </button>
                <button
                  onClick={() => cancelInvite(inv.email)}
                  className="underline text-[var(--ink)]/40 hover:text-[var(--rust)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
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
    </div>
  );
}
