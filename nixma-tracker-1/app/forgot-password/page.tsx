"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    // Always show the same "check your email" message regardless of
    // whether the address matched an account -- otherwise this form could
    // be used to enumerate which emails have accounts.
    if (err) {
      setError(err.message);
      return;
    }
    setSent(true);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-sm w-full">
        <p className="text-xs tracking-[0.2em] uppercase text-[var(--accent)] font-mono mb-2">
          Nixma Test Solutions
        </p>
        <h1 className="text-2xl font-semibold">Reset your password</h1>

        {sent ? (
          <p className="text-sm text-[var(--ink)]/70 mt-4">
            If an account exists for {email.trim()}, we&apos;ve sent a link to
            reset your password. Check your inbox.
          </p>
        ) : (
          <>
            <p className="text-sm text-[var(--ink)]/60 mt-1 mb-8">
              Enter your team email and we&apos;ll send you a link to set a
              new password.
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
                {busy ? "Sending…" : "Send reset link"}
              </button>
            </form>
          </>
        )}

        <div className="mt-6 text-sm">
          <Link href="/login" className="underline text-[var(--ink)]/60 hover:text-[var(--accent)]">
            &larr; Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
