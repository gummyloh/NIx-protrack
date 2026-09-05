"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function TeamLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.replace("/internal/projects");
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-sm w-full">
        <img src="/brand/nixtecs-logo.png" alt="Nixtecs" className="h-5 w-auto mb-2" />
        <h1 className="text-2xl font-semibold">Team sign in</h1>
        <p className="text-sm text-[var(--ink)]/60 mt-1 mb-8">
          Sign in to see the project list and manage schedules.
        </p>

        <form onSubmit={handleSubmit} className="grid gap-4">
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full border border-[var(--line)] rounded-lg px-3 py-2 bg-white/70 text-sm text-[var(--ink)] font-sans normal-case tracking-normal focus:outline-none focus:border-[var(--accent)]"
            />
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
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-4 text-sm">
          <Link href="/forgot-password" className="underline text-[var(--ink)]/50 hover:text-[var(--accent)]">
            Forgot your password?
          </Link>
        </div>

        <div className="mt-6 flex items-center justify-between text-sm">
          <Link href="/signup" className="underline text-[var(--ink)]/60 hover:text-[var(--accent)]">
            Need an account? Sign up
          </Link>
          <Link href="/customer/login" className="underline text-[var(--ink)]/40 hover:text-[var(--accent)]">
            Customer access &rarr;
          </Link>
        </div>
      </div>
    </main>
  );
}
