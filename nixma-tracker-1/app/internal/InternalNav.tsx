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
 * icon strip below md). Dark sidebar surface -- separate token set from
 * the light main-content area, not a dark-mode variant of it (see
 * globals.css: --sidebar-* tokens vs --paper/--surface/--ink).
 *
 * The Projects list (/internal/projects) is where you pick which project to
 * work in, so it has no "current project" yet -- the nav shows the generic
 * title there and skips the project-scoped groups, since those don't make
 * sense until a project has been chosen.
 */
export default function InternalNav({
  isAdmin,
  userEmail,
}: {
  isAdmin: boolean;
  userEmail?: string | null;
}) {
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
  const userInitial = (userEmail || "?").trim().charAt(0).toUpperCase();

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:w-60 md:z-40 bg-[var(--sidebar-bg)]">
        <div className="px-4 pt-5 pb-4 flex items-center gap-2.5">
          <span
            className="h-7 w-7 rounded-lg shrink-0 flex items-center justify-center text-white text-sm font-bold"
            style={{ background: "var(--brand-gradient)" }}
          >
            N
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight text-[var(--sidebar-ink)] truncate">
              Nixtecs
            </p>
            <p className="text-[11px] text-[var(--sidebar-muted)] truncate">Project Tracker</p>
          </div>
        </div>

        {!isProjectsList && project && (
          <div className="mx-3 mb-3 px-3 py-2.5 rounded-lg bg-[var(--sidebar-active)]">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              <p className="text-sm font-medium text-white truncate">{project.name}</p>
            </div>
            <p className="text-[11px] text-white/70 truncate mt-0.5 ml-3">
              {project.project_code}
              {project.customer ? ` · ${project.customer}` : ""}
            </p>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
          {groups.map((group, i) => (
            <div key={i}>
              {group.label && (
                <p className="px-2.5 mb-1.5 text-[10px] font-mono uppercase tracking-wide text-[var(--sidebar-muted)]">
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
                          ? "bg-[var(--sidebar-active)] text-white font-medium"
                          : "text-[var(--sidebar-muted)] hover:bg-white/5 hover:text-[var(--sidebar-ink)]"
                      }`}
                    >
                      <LinkIcon className={`h-4 w-4 shrink-0 ${active ? "text-white" : "text-[var(--sidebar-muted)]"}`} />
                      <span className="truncate">{l.label}</span>
                      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white/70 shrink-0" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-[var(--sidebar-line)] space-y-2">
          {userEmail && (
            <div className="flex items-center gap-2.5 px-2.5 py-1">
              <span
                className="h-6 w-6 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-semibold"
                style={{ background: "var(--brand-gradient)" }}
              >
                {userInitial}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-[var(--sidebar-ink)] truncate">{userEmail}</p>
                <p className="text-[10px] text-[var(--sidebar-muted)]">{isAdmin ? "Admin" : "Member"}</p>
              </div>
            </div>
          )}
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm text-[var(--sidebar-muted)] hover:bg-white/5 hover:text-[var(--sidebar-ink)] transition-colors"
          >
            <IconLogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar: brand + horizontally scrollable icon strip */}
      <header className="md:hidden sticky top-0 z-40 bg-[var(--sidebar-bg)]">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="h-6 w-6 rounded-md shrink-0 flex items-center justify-center text-white text-xs font-bold"
              style={{ background: "var(--brand-gradient)" }}
            >
              N
            </span>
            <p className="text-sm font-semibold leading-tight text-[var(--sidebar-ink)] truncate">
              {isProjectsList ? "Project Tracker" : project?.name ?? "Project Tracker"}
            </p>
          </div>
          <button
            onClick={signOut}
            className="shrink-0 flex items-center gap-1.5 text-xs text-[var(--sidebar-muted)] hover:text-[var(--sidebar-ink)]"
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
                    ? "bg-[var(--sidebar-active)] text-white font-medium"
                    : "text-[var(--sidebar-muted)] hover:bg-white/5"
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
