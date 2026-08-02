"use client";

import { useEffect, useState } from "react";

export const DEFAULT_PROJECT_ID = "liquick-go-pack-n-seal";

/**
 * Reads ?project=<id> from the URL client-side (not Next's useSearchParams,
 * to avoid forcing every page into a Suspense boundary just for this).
 * Falls back to the original Teleflex project so every existing link and
 * bookmark keeps working unchanged.
 */
export function useProjectId(): string {
  const [projectId, setProjectId] = useState(DEFAULT_PROJECT_ID);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("project");
    if (fromUrl) setProjectId(fromUrl);
  }, []);

  return projectId;
}

/** Builds an internal link that carries the current project along, unless
 * it's the default project (keeps URLs clean for the common case). */
export function withProject(path: string, projectId: string): string {
  if (projectId === DEFAULT_PROJECT_ID) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}project=${encodeURIComponent(projectId)}`;
}
