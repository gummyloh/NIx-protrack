"use client";

import { useSearchParams } from "next/navigation";

export const DEFAULT_PROJECT_ID = "liquick-go-pack-n-seal";

/**
 * Reads ?project=<id> from the URL.
 *
 * Uses next/navigation's useSearchParams() rather than manually parsing
 * window.location.search in an effect: the manual version only updated on
 * pathname change (or on mount), so a query-string-only navigation --
 * exactly what switching projects while staying on the same route does --
 * could be served from Next's client router cache without ever re-running
 * that effect, leaving the nav frozen on a previous project indefinitely.
 * useSearchParams() is the framework's own reactive primitive for this and
 * doesn't have that gap, at the cost of needing a Suspense boundary
 * somewhere above (added in app/internal/layout.tsx).
 */
export function useProjectId(): string {
  const searchParams = useSearchParams();
  return searchParams.get("project") || DEFAULT_PROJECT_ID;
}

/** Builds an internal link that carries the current project along, unless
 * it's the default project (keeps URLs clean for the common case). */
export function withProject(path: string, projectId: string): string {
  if (projectId === DEFAULT_PROJECT_ID) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}project=${encodeURIComponent(projectId)}`;
}
