"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { DEFAULT_PROJECT_ID } from "@/lib/useProjectId";
import { InternalAuthProvider } from "@/lib/internalAuth";
import InternalNav from "./InternalNav";

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  approved: boolean;
  is_admin: boolean;
}

/**
 * Client-side auth guard for all /internal pages. Requires a signed-in,
 * admin-approved team account. Renders the fixed top nav for every page.
 *
 * Beyond account approval, most pages are also scoped to a specific project
 * (via ?project=), and team members only get to projects they've been
 * explicitly added to (admins can reach every project). The projects list
 * itself is exempt since that's the picker used to get into a project in
 * the first place.
 */
export default function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"loading" | "pending" | "ok">("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [projectState, setProjectState] = useState<"skip" | "checking" | "ok" | "denied">(
    "checking"
  );

  useEffect(() => {
    let mounted = true;

    async function check() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();
      if (!mounted) return;
      const p = data as Profile | null;
      setProfile(p);
      setState(p?.approved ? "ok" : "pending");
    }

    check();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login");
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (state !== "ok") return;

    if (pathname === "/internal/projects") {
      setProjectState("skip");
      return;
    }

    let mounted = true;
    setProjectState("checking");

    (async () => {
      const projectId =
        new URLSearchParams(window.location.search).get("project") || DEFAULT_PROJECT_ID;
      const { data, error } = await supabase.rpc("can_i_access_project", {
        p_project_id: projectId,
      });
      if (!mounted) return;
      if (error || !data) {
        setProjectState("denied");
        router.replace("/internal/projects");
        return;
      }
      setProjectState("ok");
    })();

    return () => {
      mounted = false;
    };
  }, [state, pathname, router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (state === "loading") {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-[var(--ink)]/50">Checking access…</p>
      </main>
    );
  }

  if (state === "pending") {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-sm w-full text-center">
          <p className="text-xs tracking-[0.2em] uppercase text-[var(--accent)] font-mono mb-4">
            Nixma Test Solutions
          </p>
          <h1 className="text-2xl font-semibold mb-3">Awaiting approval</h1>
          <p className="text-sm text-[var(--ink)]/70">
            Your account{profile?.email ? ` (${profile.email})` : ""} hasn&apos;t
            been approved by an admin yet. Check back once it&apos;s been
            approved.
          </p>
          <button
            onClick={signOut}
            className="mt-6 underline text-sm text-[var(--ink)]/60 hover:text-[var(--accent)]"
          >
            Sign out
          </button>
        </div>
      </main>
    );
  }

  if (projectState === "checking" || projectState === "denied") {
    return (
      <>
        <InternalNav isAdmin={profile?.is_admin ?? false} />
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-sm text-[var(--ink)]/50">
            {projectState === "denied" ? "Redirecting…" : "Checking project access…"}
          </p>
        </main>
      </>
    );
  }

  return (
    <InternalAuthProvider value={{ isAdmin: profile?.is_admin ?? false }}>
      <InternalNav isAdmin={profile?.is_admin ?? false} />
      {children}
    </InternalAuthProvider>
  );
}
