"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ResetPassword() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Clicking the emailed link lands here with a recovery token in the URL;
    // the Supabase client auto-exchanges it for a session (detectSessionInUrl
    // defaults to true), which fires a PASSWORD_RECOVERY event once ready.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });

    const timeout = setTimeout(() => {
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) setInvalid(true);
      });
    }, 4000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDone(true);
    setTimeout(() => router.replace("/internal/projects"), 1500);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-sm w-full">
        <p className="text-xs tracking-[0.2em] uppercase text-[var(--accent)] font-mono mb-2">
          Nixma Test Solutions
        </p>
        <h1 className="text-2xl font-semibold">Set a new password</h1>

        {invalid && !ready ? (
          <p className="text-sm text-[var(--rust)] mt-4">
            This reset link is invalid or has expired. Request a new one from
            the sign-in page.
          </p>
        ) : done ? (
          <p className="text-sm text-[var(--ink)]/70 mt-4">
            Password updated. Redirecting you to your projects…
          </p>
        ) : !ready ? (
          <p className="text-sm text-[var(--ink)]/50 mt-4">Verifying link…</p>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4 mt-6">
            <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
              New password
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full border border-[var(--line)] rounded-lg px-3 py-2 bg-white/70 text-sm text-[var(--ink)] font-sans normal-case tracking-normal focus:outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="text-xs font-mono uppercase tracking-wide text-[var(--ink)]/50">
              Confirm password
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
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
              {busy ? "Saving…" : "Save new password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
