"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function TeamSignup() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"confirm_email" | "pending" | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    // If email confirmation is enabled in Supabase, there's no session yet.
    setDone(data.session ? "pending" : "confirm_email");
  }

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-sm w-full text-center">
          <p className="text-xs tracking-[0.2em] uppercase text-[var(--accent)] font-mono mb-4">
            Nixma Test Solutions
          </p>
          <h1 className="text-2xl font-semibold mb-3">Account created</h1>
          <p className="text-sm text-[var(--ink)]/70">
            {done === "confirm_email"
              ? "Check your email to confirm your address. After that, an admin needs to approve your account before you can sign in to the tracker."
              : "Your account is awaiting admin approval. You'll have access once an admin approves it."}
          </p>
          <Link
            href="/login"
            className="inline-block mt-6 underline text-sm text-[var(--ink)]/60 hover:text-[var(--accent)]"
          >
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-sm w-full">
        <p className="text-xs tracking-[0.2em] uppercase text-[var(--accent)] font-mono mb-2">
          Nixma Test Solutions
        </p>
        <h1 className="text-2xl font-semibold">Create team account</h1>
        <p className="text-sm text-[var(--ink)]/60 mt-1 mb-8">
          New accounts need admin approval before they can access the tracker.
        </p>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
            Full name
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 block w-full border border-[var(--line)] rounded-lg px-3 py-2 bg-white/70 text-sm text-[var(--ink)] font-sans normal-case tracking-normal focus:outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full border border-[var(--line)] rounded-lg px-3 py-2 bg-white/70 text-sm text-[var(--ink)] font-sans normal-case tracking-normal focus:outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
            Password
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full border border-[var(--line)] rounded-lg px-3 py-2 bg-white/70 text-sm text-[var(--ink)] font-sans normal-case tracking-normal focus:outline-none focus:border-[var(--accent)]"
            />
            <span className="block mt-1 text-[10px] normal-case tracking-normal text-[var(--ink)]/40 font-sans">
              At least 8 characters.
            </span>
          </label>

          {error && (
            <p className="text-sm text-[var(--rust)] bg-[var(--rust)]/10 border border-[var(--rust)]/30 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="bg-[var(--accent)] text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>

        <Link
          href="/login"
          className="inline-block mt-6 underline text-sm text-[var(--ink)]/60 hover:text-[var(--accent)]"
        >
          Already have an account? Sign in
        </Link>
      </div>
    </main>
  );
}
