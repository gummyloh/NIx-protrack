import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-lg w-full">
        <div className="mb-10">
          <p className="text-xs tracking-[0.2em] uppercase text-[var(--accent)] font-mono mb-2">
            Nixma Test Solutions
          </p>
          <h1 className="text-3xl font-semibold leading-tight">
            Project Tracker
          </h1>
        </div>

        <div className="grid gap-4">
          <Link
            href="/login"
            className="block border border-[var(--line)] bg-white/60 rounded-lg p-5 hover:border-[var(--accent)] transition-colors"
          >
            <p className="font-mono text-xs uppercase tracking-wide text-[var(--ink)]/50 mb-1">
              Team
            </p>
            <p className="text-lg font-medium">Team sign in</p>
            <p className="text-sm text-[var(--ink)]/60 mt-1">
              Sign in to see all projects, schedules, and internal updates.
            </p>
          </Link>

          <Link
            href="/customer"
            className="block border border-[var(--line)] bg-white/60 rounded-lg p-5 hover:border-[var(--accent)] transition-colors"
          >
            <p className="font-mono text-xs uppercase tracking-wide text-[var(--ink)]/50 mb-1">
              Customer
            </p>
            <p className="text-lg font-medium">Status view</p>
            <p className="text-sm text-[var(--ink)]/60 mt-1">
              Read-only progress view, password protected.
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}
