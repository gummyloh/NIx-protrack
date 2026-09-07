"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export const DEFAULT_PROJECT_ID = "liquick-go-pack-n-seal";

/**
 * Reads ?project=<id> from the URL client-side (not Next's useSearchParams,
 * to avoid forcing every page into a Suspense boundary just for this).
 * Falls back to the original Teleflex project so every existing link and
 * bookmark keeps working unchanged.
 *
 * Re-reads on every pathname change (not just on mount): the /internal
 * layout -- and the nav bar it renders -- stays mounted across
 * client-side navigations within /internal, so a mount-only effect here
 * would freeze at whatever project was active when that layout first
 * mounted and never notice a later project switch, even though the page
 * content underneath re-fetches correctly for the new project.
 */
export function useProjectId(): string {
  const pathname = usePathname();
  const [projectId, setProjectId] = useState(DEFAULT_PROJECT_ID);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("project");
    setProjectId(fromUrl || DEFAULT_PROJECT_ID);
  }, [pathname]);

  return projectId;
}

/** Builds an internal link that carries the current project along, unless
 * it's the default project (keeps URLs clean for the common case). */
export function withProject(path: string, projectId: string): string {
  if (projectId === DEFAULT_PROJECT_ID) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}project=${encodeURIComponent(projectId)}`;
}
