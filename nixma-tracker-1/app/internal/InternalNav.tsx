"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useProjectId, withProject } from "@/lib/useProjectId";
import {
  IconFolder,
  IconGauge,
  IconGrid,
  IconImage,
  IconNotes,
  IconColumns,
  IconTable,
  IconBarChart,
  IconLayers,
  IconTrendUp,
  IconUsers,
  IconLogOut,
} from "./icons";

interface ProjectRow {
  name: string;
  customer: string;
  project_code: string | null;
}

interface NavLink {
  label: string;
  path: string;
  icon: (p: { className?: string }) => JSX.Element;
}

interface NavGroup {
  label: string | null;
  links: NavLink[];
}

/**
 * Left nav rail shown on every internal page (collapses to a horizontal
 * icon strip below md). Brand + current project sit above the link groups;
 * sign out sits pinned at the bottom.
 *
 * The Projects list (/internal/projects) is where you pick which project to
 * work in, so it has no "current project" yet -- the nav shows the generic
 * title there and skips the project-scoped groups, since those don't make
 * sense until a project has been chosen.
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

  const groups: NavGroup[] = isProjectsList
    ? [{ label: null, links: [{ label: "Projects", path: "/internal/projects", icon: IconFolder }] }]
    : [
        {
          label: null,
          links: [{ label: "Projects", path: "/internal/projects", icon: IconFolder }],
        },
        {
          label: "Overview",
          links: [
            { label: "Dashboard", path: "/internal", icon: IconGauge },
            ...(isAdmin ? [{ label: "Portfolio", path: "/internal/portfolio", icon: IconGrid }] : []),
          ],
        },
        {
          label: "Field",
          links: [
            { label: "Photos", path: "/internal/photos", icon: IconImage },
            { label: "Meeting Notes", path: "/internal/meetings", icon: IconNotes },
          ],
        },
        {
          label: "Schedule",
          links: [
            { label: "Board", path: "/internal/board", icon: IconColumns },
            { label: "Task Table", path: "/internal/tasks", icon: IconTable },
            { label: "Gantt Chart", path: "/internal/gantt", icon: IconBarChart },
            { label: "Module Rollup", path: "/internal/modules", icon: IconLayers },
            { label: "Progress", path: "/internal/progress", icon: IconTrendUp },
          ],
        },
        ...(isAdmin
          ? [{ label: "Admin", links: [{ label: "Team", path: "/internal/team", icon: IconUsers }] }]
          : []),
      ];

  const allLinks = groups.flatMap((g) => g.links);

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:w-60 md:z-40 border-r border-[var(--line)] bg-[var(--surface)]">
        <div className="px-5 pt-5 pb-4 border-b border-[var(--line)]">
          <img src="/brand/nixtecs-logo.png" alt="Nixtecs" className="h-4 w-auto mb-3" />
          <p className="text-sm font-semibold leading-tight truncate">
            {isProjectsList ? "Project Tracker" : project?.name ?? "Project Tracker"}
          </p>
          {!isProjectsList && project && (
            <p className="text-xs text-[var(--ink)]/50 truncate mt-0.5">
              {project.customer}
              {project.project_code ? ` · ${project.project_code}` : ""}
            </p>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {groups.map((group, i) => (
            <div key={i}>
              {group.label && (
                <p className="px-2.5 mb-1.5 text-[10px] font-mono uppercase tracking-wide text-[var(--ink)]/40">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.links.map((l) => {
                  const href = withProject(l.path, projectId);
                  const active = pathname === l.path;
                  const LinkIcon = l.icon;
                  return (
                    <Link
                      key={l.label}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                        active
                          ? "bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
                          : "text-[var(--ink)]/70 hover:bg-[var(--paper)] hover:text-[var(--ink)]"
                      }`}
                    >
                      <LinkIcon className={`h-4 w-4 shrink-0 ${active ? "text-[var(--accent)]" : "text-[var(--ink)]/40"}`} />
                      <span className="truncate">{l.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-[var(--line)]">
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm text-[var(--rust)]/70 hover:bg-[var(--rust)]/10 hover:text-[var(--rust)] transition-colors"
          >
            <IconLogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar: brand + horizontally scrollable icon strip */}
      <header className="md:hidden sticky top-0 z-40 bg-[var(--paper)]/95 backdrop-blur border-b border-[var(--line)]">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <img src="/brand/nixtecs-logo.png" alt="Nixtecs" className="h-4 w-auto" />
            <p className="text-sm font-semibold leading-tight truncate">
              {isProjectsList ? "Project Tracker" : project?.name ?? "Project Tracker"}
            </p>
          </div>
          <button
            onClick={signOut}
            className="shrink-0 flex items-center gap-1.5 text-xs text-[var(--rust)]/70 hover:text-[var(--rust)]"
          >
            <IconLogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto px-3 pb-2.5 -mx-1">
          {allLinks.map((l) => {
            const href = withProject(l.path, projectId);
            const active = pathname === l.path;
            const LinkIcon = l.icon;
            return (
              <Link
                key={l.label}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors ${
                  active
                    ? "bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
                    : "text-[var(--ink)]/60 hover:bg-[var(--surface)]"
                }`}
              >
                <LinkIcon className="h-3.5 w-3.5 shrink-0" />
                {l.label}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
