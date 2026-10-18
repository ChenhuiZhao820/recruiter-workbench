"use client";

import { useEffect } from "react";
import { markActivitySeen } from "@/app/actions/notifications";
import { ACTIVITY_CHANGED } from "@/components/ActivityBell";

// Marks the news on this page as read once it is actually on screen: an effect
// does not run for a prefetch, and a read-only view never mounts this. The
// page keeps its New marks until it is next opened; the bell counts again now.
export function MarkSeen({ renderedAt, roleId, scope }: { renderedAt: string; roleId?: string; scope?: "shortlists" }) {
  useEffect(() => {
    let cancelled = false;
    markActivitySeen(renderedAt, roleId ?? scope).then(() => { if (!cancelled) window.dispatchEvent(new Event(ACTIVITY_CHANGED)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [renderedAt, roleId, scope]);
  return null;
}
