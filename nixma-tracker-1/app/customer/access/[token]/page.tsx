"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

// Landing page for the customer "join link" (Copy customer link on the
// Projects page builds a URL like /customer/access/<token>). It has nothing
// to show itself -- it just exchanges the token in the URL for the same
// httpOnly session cookie the 6-digit PIN login sets, then hands off to
// /customer like a normal login would. A customer who bookmarks or reuses
// this URL logs back in the same way every time, with nothing to remember.
export default function CustomerAccessLink() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/customer-token-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: params.token }),
      });
      if (res.ok) {
        router.replace("/customer");
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "This link is no longer valid");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.token]);

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-sm w-full border border-[var(--line)] rounded-lg p-6 bg-white/60 text-center">
        <p className="text-xs tracking-[0.2em] uppercase text-[var(--accent)] font-mono mb-2">
          Nixma Test Solutions
        </p>
        {error ? (
          <>
            <h1 className="text-xl font-semibold mb-1">Link not valid</h1>
            <p className="text-sm text-[var(--ink)]/60 mb-4">{error}</p>
            <a
              href="/customer/login"
              className="text-sm text-[var(--accent)] underline underline-offset-4"
            >
              Enter a PIN instead
            </a>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold mb-1">Signing you in…</h1>
            <p className="text-sm text-[var(--ink)]/60">
              Checking your link, one moment.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
