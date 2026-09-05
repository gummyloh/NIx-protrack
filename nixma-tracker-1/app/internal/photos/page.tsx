"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Photo, Task } from "@/lib/types";
import { useProjectId, withProject } from "@/lib/useProjectId";
import { prepareImageForUpload, ImageUploadError } from "@/lib/imageUpload";

interface PhotoWithUrl extends Photo {
  url: string | null;
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function PhotosPage() {
  const projectId = useProjectId();
  const [photos, setPhotos] = useState<PhotoWithUrl[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [caption, setCaption] = useState("");
  const [taskId, setTaskId] = useState<string>("");
  const [takenDate, setTakenDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [name, setName] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem("nixma_updater_name");
    if (stored) setName(stored);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("nixma_updater_name", name);
  }, [name]);

  async function loadPhotos() {
    setLoading(true);
    setError(null);

    const [{ data: photoRows, error: photoErr }, { data: taskRows }] = await Promise.all([
      supabase
        .from("photos")
        .select("*")
        .eq("project_id", projectId)
        .order("taken_date", { ascending: false }),
      supabase
        .from("tasks")
        .select("*")
        .eq("project_id", projectId)
        .eq("is_summary", false)
        .order("task_no", { ascending: true }),
    ]);

    if (photoErr) {
      setError(photoErr.message);
      setLoading(false);
      return;
    }

    const rows = (photoRows as Photo[]) || [];
    const withUrls: PhotoWithUrl[] = await Promise.all(
      rows.map(async (p) => {
        const { data: signed } = await supabase.storage
          .from("project-photos")
          .createSignedUrl(p.storage_path, 3600);
        return { ...p, url: signed?.signedUrl ?? null };
      })
    );

    setPhotos(withUrls);
    setTasks((taskRows as Task[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    loadPhotos();
  }, [projectId]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;
    setUploading(true);
    setError(null);

    let file: File;
    try {
      file = await prepareImageForUpload(rawFile);
    } catch (err) {
      setError(err instanceof ImageUploadError ? err.message : "Couldn't process that image.");
      setUploading(false);
      e.target.value = "";
      return;
    }

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: uploadErr } = await supabase.storage.from("project-photos").upload(path, file);
    if (uploadErr) {
      setError(uploadErr.message);
      setUploading(false);
      return;
    }

    const { error: insertErr } = await supabase.from("photos").insert({
      project_id: projectId,
      task_id: taskId ? Number(taskId) : null,
      storage_path: path,
      caption: caption.trim() || null,
      taken_by: name || "Unknown",
      taken_date: takenDate,
    });

    setUploading(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }

    setCaption("");
    setTaskId("");
    e.target.value = "";
    await loadPhotos();
  }

  async function handleDelete(photo: PhotoWithUrl) {
    if (!confirm("Delete this photo? This can't be undone.")) return;
    await supabase.storage.from("project-photos").remove([photo.storage_path]);
    const { error: err } = await supabase.from("photos").delete().eq("id", photo.id);
    if (err) setError(err.message);
    else await loadPhotos();
  }

  // Toggling this is the only thing that puts a photo in front of the
  // customer -- everything in this archive stays internal-only until an
  // admin explicitly flags it. Optimistic update with rollback on failure,
  // same pattern as the rest of this page's mutations.
  async function toggleCustomerVisible(photo: PhotoWithUrl) {
    const next = !photo.visible_to_customer;
    setPhotos((prev) =>
      prev.map((p) => (p.id === photo.id ? { ...p, visible_to_customer: next } : p))
    );
    const { error: err } = await supabase
      .from("photos")
      .update({ visible_to_customer: next })
      .eq("id", photo.id);
    if (err) {
      setError(err.message);
      setPhotos((prev) =>
        prev.map((p) => (p.id === photo.id ? { ...p, visible_to_customer: !next } : p))
      );
    }
  }

  return (
    <main className="p-6 md:p-10 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <Link
            href={withProject("/internal", projectId)}
            className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 hover:text-[var(--accent)]"
          >
            &larr; Dashboard
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Photo Archive</h1>
          <p className="text-sm text-[var(--ink)]/60">
            Internal record for revisions and future rebuilds. Check &ldquo;Show
            to customer&rdquo; on any photo you want included on their status
            page -- everything else here stays internal.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="border border-[var(--line)] rounded-lg p-5 bg-white/60 mb-6 space-y-3">
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 block mb-1">
              Related task (optional)
            </label>
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="border border-[var(--line)] rounded px-2 py-1.5 text-sm w-full bg-white"
            >
              <option value="">None</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.task_no} {t.description}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 block mb-1">
              Date taken
            </label>
            <input
              type="date"
              value={takenDate}
              onChange={(e) => setTakenDate(e.target.value)}
              className="border border-[var(--line)] rounded px-2 py-1.5 text-sm w-full bg-white"
            />
          </div>
          <div>
            <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 block mb-1">
              Your name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="border border-[var(--line)] rounded px-2 py-1.5 text-sm w-full bg-white"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 block mb-1">
            Caption (optional)
          </label>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="e.g. Rotary table assembly, before wiring"
            className="border border-[var(--line)] rounded px-2 py-1.5 text-sm w-full bg-white"
          />
        </div>
        <div>
          <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50 block mb-1">
            Upload photo
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={handleUpload}
            disabled={uploading}
            className="text-sm"
          />
          {uploading && <p className="text-xs text-[var(--ink)]/50 mt-1">Uploading…</p>}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ink)]/50">Loading…</p>
      ) : photos.length === 0 ? (
        <p className="text-sm text-[var(--ink)]/50">No photos yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {photos.map((p) => {
            const task = tasks.find((t) => t.id === p.task_id);
            return (
              <div
                key={p.id}
                className={`border rounded-lg overflow-hidden bg-white/60 ${
                  p.visible_to_customer ? "border-[var(--accent)]" : "border-[var(--line)]"
                }`}
              >
                <div className="aspect-square bg-[var(--line)] relative">
                  {p.url ? (
                    <img src={p.url} alt={p.caption ?? ""} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-[var(--ink)]/40">
                      No preview
                    </div>
                  )}
                  {p.visible_to_customer && (
                    <span className="absolute top-1.5 left-1.5 text-[9px] font-mono uppercase tracking-wide bg-[var(--accent)] text-white rounded px-1.5 py-0.5">
                      Shown to customer
                    </span>
                  )}
                </div>
                <div className="p-2.5">
                  {p.caption && <p className="text-xs font-medium truncate">{p.caption}</p>}
                  {task && <p className="text-xs text-[var(--ink)]/50 truncate">{task.description}</p>}
                  <p className="text-[10px] text-[var(--ink)]/40 font-mono-num mt-1">
                    {fmtDate(p.taken_date)}
                  </p>
                  <label className="flex items-center gap-1.5 mt-2 text-[10px] text-[var(--ink)]/60">
                    <input
                      type="checkbox"
                      checked={p.visible_to_customer}
                      onChange={() => toggleCustomerVisible(p)}
                      className="accent-[var(--accent)]"
                    />
                    Show to customer
                  </label>
                  <div className="flex justify-end mt-1">
                    <button
                      onClick={() => handleDelete(p)}
                      className="text-[10px] text-[var(--ink)]/40 hover:text-[var(--rust)]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
