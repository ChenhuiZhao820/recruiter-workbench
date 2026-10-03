import { normalizeMessage } from "@/lib/render";

const DAY_MS = 86_400_000;

// The same text marked as sent more than once on the same (UTC) day is one
// message: a second click on "Mark as sent", or the same note logged from the
// queue and from the candidate's own page. Recording refuses the repeat, and
// every list and count reads through this, so rows logged before that rule
// existed count once too.
export function utcDayStart(now: Date) {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
}

export function sameMessageKey(log: { sentAt: Date; renderedBody: string }) {
  return `${Math.floor(log.sentAt.getTime() / DAY_MS)}|${normalizeMessage(log.renderedBody)}`;
}

// Keeps the first of each repeat in the order given, so a newest-first list
// keeps the latest. `scope` names who it went to, when the list mixes people.
export function oncePerDay<T extends { sentAt: Date; renderedBody: string }>(logs: T[], scope: (log: T) => string = () => ""): T[] {
  const seen = new Set<string>();
  return logs.filter((log) => {
    const key = `${scope(log)}|${sameMessageKey(log)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
