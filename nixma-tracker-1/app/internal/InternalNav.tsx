"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useProjectId, withProject } from "@/lib/useProjectId";

interface ProjectRow {
  name: string;
  customer: string;
  project_code: string | null;
}

/**
 * Fixed top bar shown on every internal page: brand + current project on the
 * left, section links on the right. Sticky so it stays put while scrolling.
 *
 * The Projects list (/internal/projects) is where you pick which project to
 * work in, so it has no "current project" yet -- the nav shows the generic
 * title there and skips the project-scoped links (Dashboard, Photos, etc.),
 * since those don't make sense until a project has been chosen.
 */
export default function InternalNav({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const projectId = useProjectId();
  const [project, setProject] = useState<ProjectRow | null>(null);

  const isProjectsList = pathname === "/internal/projects";

  useEffect(() => {
    if (isProjectsList) {
      setProject(null);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("name, customer, project_code")
        .eq("id", projectId)
        .single();
      setProject((data as ProjectRow) || null);
    })();
  }, [projectId, isProjectsList]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const links: Array<{ label: string; href: string }> = isProjectsList
    ? [{ label: "Projects", href: "/internal/projects" }]
    : [
        { label: "Projects", href: "/internal/projects" },
        { label: "Dashboard", href: withProject("/internal", projectId) },
        { label: "Photos", href: withProject("/internal/photos", projectId) },
        { label: "Meeting Notes", href: withProject("/internal/meetings", projectId) },
        { label: "Board", href: withProject("/internal/board", projectId) },
        { label: "Task Table", href: withProject("/internal/tasks", projectId) },
        { label: "Gantt Chart", href: withProject("/internal/gantt", projectId) },
        { label: "Module Rollup", href: withProject("/internal/modules", projectId) },
      ];
  if (isAdmin && !isProjectsList) {
    links.push({ label: "Team", href: withProject("/internal/team", projectId) });
  }

  return (
    <header className="sticky top-0 z-40 bg-[var(--paper)]/95 backdrop-blur border-b border-[var(--line)]">
      <div className="max-w-7xl mx-auto px-6 md:px-10 py-3 flex items-center justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <img src="/brand/nixtecs-logo.png" alt="Nixtecs" className="h-4 w-auto" />
          <p className="text-base font-semibold leading-tight truncate">
            {isProjectsList ? "Project Tracker" : project?.name ?? "Project Tracker"}
          </p>
          {!isProjectsList && project && (
            <p className="text-xs text-[var(--ink)]/50 truncate">
              {project.customer}
              {project.project_code ? ` · ${project.project_code}` : ""}
            </p>
          )}
        </div>
        <nav className="flex items-center gap-4 text-[11px] font-mono uppercase tracking-wide flex-wrap">
          {links.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="text-[var(--ink)]/60 hover:text-[var(--accent)] underline underline-offset-4"
            >
              {l.label}
            </Link>
          ))}
          <button
            onClick={signOut}
            className="text-[var(--rust)]/70 hover:text-[var(--rust)] underline underline-offset-4 uppercase font-mono"
          >
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
}
