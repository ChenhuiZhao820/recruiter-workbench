"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

const POLL_MS = 60_000;
// Sent when something on the page marked news as read.
export const ACTIVITY_CHANGED = "capture:activity-changed";

// What clients did since the recruiter last looked. The count comes with the
// page and is asked for again every minute while the tab is in front, so news
// arrives without a reload; a hidden tab asks nothing.
export function useUnreadActivity(initial: number) {
  const [unread, setUnread] = useState(initial);
  const pathname = usePathname();
  useEffect(() => setUnread(initial), [initial]);
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/notifications/unread", { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json();
        if (!stopped && Number.isInteger(body.unread)) setUnread(body.unread);
      } catch { /* the next tick tries again */ }
    };
    const timer = window.setInterval(check, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(ACTIVITY_CHANGED, check);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener(ACTIVITY_CHANGED, check); };
  }, [pathname]);
  return unread;
}

export function UnreadBadge({ count }: { count: number }) {
  if (!count) return null;
  return <span className="unread-badge" aria-hidden="true">{count > 99 ? "99+" : count}</span>;
}

export function ActivityBell({ unread }: { unread: number }) {
  const label = unread ? `Notifications: ${unread} new` : "Notifications";
  return <Link href="/notifications" className={unread ? "activity-bell has-unread" : "activity-bell"} aria-label={label} title={label} data-unread={unread}>
    <Icon name="bell" size={17} />
    <UnreadBadge count={unread} />
  </Link>;
}
