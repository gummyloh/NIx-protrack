"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CustomerLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/customer-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) {
      router.push("/customer");
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Something went wrong");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form
        onSubmit={handleSubmit}
        className="max-w-sm w-full border border-[var(--line)] rounded-lg p-6 bg-white/60"
      >
        <p className="text-xs tracking-[0.2em] uppercase text-[var(--accent)] font-mono mb-2">
          Nixma Test Solutions
        </p>
        <h1 className="text-xl font-semibold mb-1">Project status</h1>
        <p className="text-sm text-[var(--ink)]/60 mb-4">
          Liquick GO Pack N Seal &mdash; enter the access code shared with you
          to view live progress.
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Access code"
          autoFocus
          className="border border-[var(--line)] rounded px-3 py-2 text-sm w-full bg-white mb-3"
        />
        {error && (
          <p className="text-sm text-[var(--rust)] mb-3">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full bg-[var(--accent)] text-white rounded px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Checking…" : "View status"}
        </button>
      </form>
    </main>
  );
}
