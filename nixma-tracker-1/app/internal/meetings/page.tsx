"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { MeetingNote, NoteAudience } from "@/lib/types";
import { useProjectId, withProject } from "@/lib/useProjectId";

function fmtDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function MeetingsPage() {
  const projectId = useProjectId();
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<NoteAudience>("internal");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");

  // form state
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [audience, setAudience] = useState<NoteAudience>("internal");
  const [content, setContent] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("nixma_updater_name");
    if (stored) setName(stored);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("nixma_updater_name", name);
  }, [name]);

  async function loadNotes() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("list_internal_meeting_notes", {
      p_project_id: projectId,
    });
    if (err) setError(err.message);
    else setNotes((data as MeetingNote[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    loadNotes();
  }, [projectId]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setError(null);
    try {
      const mammoth = (await import("mammoth")).default;
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      setContent(result.value);
      if (!title) {
        setTitle(file.name.replace(/\.docx?$/i, ""));
      }
    } catch (err) {
      setError(
        "Couldn't read that file. Only .docx is supported right now -- if it's a Pages file, export to Word first, or just paste the text directly."
      );
    } finally {
      setParsing(false);
    }
  }

  async function handleSave() {
    if (!title.trim() || !content.trim()) {
      setError("Title and content are both required.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.rpc("upsert_meeting_note", {
      p_id: null,
      p_project_id: projectId,
      p_audience: audience,
      p_title: title.trim(),
      p_meeting_date: meetingDate,
      p_raw_content: content,
      p_formatted_content: content, // AI polish isn't wired up yet -- see note below
      p_created_by: name || "Unknown",
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setTitle("");
    setContent("");
    setShowForm(false);
    await loadNotes();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this note? This can't be undone.")) return;
    const { error: err } = await supabase.rpc("delete_meeting_note", { p_id: id });
    if (err) setError(err.message);
    else await loadNotes();
  }

  const visibleNotes = notes.filter((n) => n.audience === tab);

  return (
    <main className="p-6 md:p-10 max-w-4xl mx-auto">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <Link
            href={withProject("/internal", projectId)}
            className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 hover:text-[var(--accent)]"
          >
            &larr; Dashboard
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Meeting Notes</h1>
          <p className="text-sm text-[var(--ink)]/60">
            Internal notes are only ever visible here. Client-facing notes also
            show up on the customer&rsquo;s page -- nothing internal is ever
            reachable from there, even directly.
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm((s) => !s);
            setAudience(tab);
          }}
          className="text-sm bg-[var(--accent)] text-white rounded px-3 py-1.5 font-medium h-fit"
        >
          {showForm ? "Cancel" : "+ New note"}
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      {showForm && (
        <div className="border border-[var(--line)] rounded-lg p-5 bg-white/60 mb-6 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 block mb-1">
                Title
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Week 3 progress sync"
                className="border border-[var(--line)] rounded px-2 py-1.5 text-sm w-full bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 block mb-1">
                Meeting date
              </label>
              <input
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                className="border border-[var(--line)] rounded px-2 py-1.5 text-sm w-full bg-white"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 block mb-1">
              Visible to
            </label>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={audience === "internal"}
                  onChange={() => setAudience("internal")}
                />
                Internal only
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={audience === "client"}
                  onChange={() => setAudience("client")}
                />
                Client-facing (shows on customer page too)
              </label>
            </div>
          </div>

          <div>
            <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 block mb-1">
              Upload a .docx, or just paste the text below
            </label>
            <input
              type="file"
              accept=".docx"
              onChange={handleFileUpload}
              className="text-sm mb-2"
            />
            {parsing && <p className="text-xs text-[var(--ink)]/50">Reading file…</p>}
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              placeholder="Paste or type meeting notes here…"
              className="border border-[var(--line)] rounded px-2 py-1.5 text-sm w-full bg-white font-sans"
            />
            <p className="text-xs text-[var(--ink)]/40 mt-1">
              Stored as-is for now -- AI formatting isn&rsquo;t wired into the
              app yet (needs an API key). In the meantime, paste your notes to
              Claude in chat and it'll format them and save directly.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="border border-[var(--line)] rounded px-2 py-1.5 text-sm w-40 bg-white"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm bg-[var(--accent)] text-white rounded px-4 py-1.5 font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save note"}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab("internal")}
          className={`text-sm px-3 py-1.5 rounded-full border ${
            tab === "internal"
              ? "bg-[var(--accent)] text-white border-[var(--accent)]"
              : "border-[var(--line)] text-[var(--ink)]/60"
          }`}
        >
          Internal
        </button>
        <button
          onClick={() => setTab("client")}
          className={`text-sm px-3 py-1.5 rounded-full border ${
            tab === "client"
              ? "bg-[var(--accent)] text-white border-[var(--accent)]"
              : "border-[var(--line)] text-[var(--ink)]/60"
          }`}
        >
          Client-facing
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ink)]/50">Loading…</p>
      ) : visibleNotes.length === 0 ? (
        <p className="text-sm text-[var(--ink)]/50">
          No {tab === "internal" ? "internal" : "client-facing"} notes yet.
        </p>
      ) : (
        <div className="space-y-4">
          {visibleNotes.map((n) => (
            <div key={n.id} className="border border-[var(--line)] rounded-lg p-4 bg-white/60">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-medium">{n.title}</h3>
                  <p className="text-xs text-[var(--ink)]/50">
                    {fmtDate(n.meeting_date)}
                    {n.created_by ? ` · ${n.created_by}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(n.id)}
                  className="text-xs text-[var(--ink)]/40 hover:text-[var(--rust)]"
                >
                  Delete
                </button>
              </div>
              <p className="text-sm text-[var(--ink)]/80 whitespace-pre-wrap">
                {n.formatted_content}
              </p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
