"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { MeetingNote, NoteAudience, Photo } from "@/lib/types";
import { useProjectId, withProject } from "@/lib/useProjectId";

interface PhotoWithUrl extends Photo {
  url: string | null;
}

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");

  // form state
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [audience, setAudience] = useState<NoteAudience>("internal");
  const [content, setContent] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState<PhotoWithUrl[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);

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

  async function loadPhotos(noteId: string) {
    const { data, error: err } = await supabase
      .from("photos")
      .select("*")
      .eq("meeting_note_id", noteId)
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      return;
    }
    const rows = (data as Photo[]) || [];
    const withUrls: PhotoWithUrl[] = await Promise.all(
      rows.map(async (p) => {
        const { data: signed } = await supabase.storage
          .from("project-photos")
          .createSignedUrl(p.storage_path, 3600);
        return { ...p, url: signed?.signedUrl ?? null };
      })
    );
    setPhotos(withUrls);
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !editingId) return;
    setPhotoUploading(true);
    setError(null);

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: uploadErr } = await supabase.storage.from("project-photos").upload(path, file);
    if (uploadErr) {
      setError(uploadErr.message);
      setPhotoUploading(false);
      return;
    }

    const { error: insertErr } = await supabase.from("photos").insert({
      project_id: projectId,
      meeting_note_id: editingId,
      storage_path: path,
      taken_by: name || "Unknown",
      taken_date: new Date().toISOString().slice(0, 10),
    });

    setPhotoUploading(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    e.target.value = "";
    await loadPhotos(editingId);
  }

  async function handlePhotoDelete(photo: PhotoWithUrl) {
    if (!confirm("Delete this photo? This can't be undone.")) return;
    await supabase.storage.from("project-photos").remove([photo.storage_path]);
    const { error: err } = await supabase.from("photos").delete().eq("id", photo.id);
    if (err) setError(err.message);
    else if (editingId) await loadPhotos(editingId);
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

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setContent("");
    setMeetingDate(new Date().toISOString().slice(0, 10));
    setPhotos([]);
  }

  function startNewNote() {
    resetForm();
    setAudience(tab);
    setShowForm(true);
  }

  function startEditNote(n: MeetingNote) {
    setEditingId(n.id);
    setTitle(n.title);
    setMeetingDate(n.meeting_date);
    setAudience(n.audience);
    setContent(n.raw_content ?? n.formatted_content ?? "");
    setShowForm(true);
    loadPhotos(n.id);
  }

  async function handleSave() {
    if (!title.trim() || !content.trim()) {
      setError("Title and content are both required.");
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("upsert_meeting_note", {
      p_id: editingId,
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
    // Keep the form open after saving (rather than closing it) so a
    // freshly-created note immediately has a stable id to attach photos to.
    const saved = (Array.isArray(data) ? data[0] : data) as MeetingNote;
    setEditingId(saved.id);
    await Promise.all([loadPhotos(saved.id), loadNotes()]);
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
            if (showForm) {
              resetForm();
              setShowForm(false);
            } else {
              startNewNote();
            }
          }}
          className="text-sm bg-[var(--accent)] text-white rounded px-3 py-1.5 font-medium h-fit"
        >
          {showForm ? (editingId ? "Done" : "Cancel") : "+ New note"}
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      {showForm && (
        <div className="border border-[var(--line)] rounded-lg p-5 bg-white/60 mb-6 space-y-3">
          <p className="text-xs font-mono uppercase tracking-wide text-[var(--accent)]">
            {editingId ? "Editing note" : "New note"}
          </p>
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

          <div className="border-t border-[var(--line)] pt-3">
            <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 block mb-2">
              Photos for this note
            </label>
            {editingId ? (
              <>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  disabled={photoUploading}
                  className="text-sm mb-3"
                />
                {photoUploading && (
                  <p className="text-xs text-[var(--ink)]/50 mb-2">Uploading…</p>
                )}
                {photos.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {photos.map((p) => (
                      <div key={p.id} className="relative group">
                        <div className="aspect-square bg-[var(--line)] rounded overflow-hidden">
                          {p.url ? (
                            <img
                              src={p.url}
                              alt={p.caption ?? ""}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] text-[var(--ink)]/40">
                              No preview
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handlePhotoDelete(p)}
                          className="absolute top-1 right-1 bg-black/60 text-white text-[10px] rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-[var(--ink)]/40">
                Save the note first, then you can attach photos here.
              </p>
            )}
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
              {saving ? "Saving…" : editingId ? "Update note" : "Save note"}
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
                <div className="flex gap-3 shrink-0">
                  <button
                    onClick={() => startEditNote(n)}
                    className="text-xs text-[var(--ink)]/40 hover:text-[var(--accent)]"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(n.id)}
                    className="text-xs text-[var(--ink)]/40 hover:text-[var(--rust)]"
                  >
                    Delete
                  </button>
                </div>
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
