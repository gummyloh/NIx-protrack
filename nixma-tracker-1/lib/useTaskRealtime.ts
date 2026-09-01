"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Subscribes to postgres_changes on nixma.tasks for one project and flags
 * when a change came in from somewhere else -- another team member editing
 * the same project in another tab/device. This is a lightweight conflict
 * *notice*, not a live merge: silently overwriting whatever the user is
 * mid-edit on (a Gantt drag, a note they're typing) would be worse than
 * just telling them to refresh once they're ready.
 *
 * Our own writes also come back through this same subscription, so calls
 * to markLocalWrite() right before/after an update suppress the notice for
 * a couple seconds -- long enough to cover the round trip without needing
 * to diff payloads.
 */
export function useTaskRealtime(projectId: string) {
  const [staleNotice, setStaleNotice] = useState(false);
  const lastLocalWriteRef = useRef(0);

  useEffect(() => {
    setStaleNotice(false);
    lastLocalWriteRef.current = 0;

    const channel = supabase
      .channel(`tasks-changes-${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "nixma",
          table: "tasks",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          const sinceLocalWrite = Date.now() - lastLocalWriteRef.current;
          if (sinceLocalWrite > 2000) {
            setStaleNotice(true);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  return {
    staleNotice,
    dismissStaleNotice: () => setStaleNotice(false),
    markLocalWrite: () => {
      lastLocalWriteRef.current = Date.now();
    },
  };
}
