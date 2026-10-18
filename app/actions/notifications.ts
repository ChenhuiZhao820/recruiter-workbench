"use server";

import { requireWritableWorkspace } from "@/lib/workspace";
import { markReadUpTo, markRoleRead, markShortlistsRead } from "@/lib/notifications";

// Called by the page once it is on screen, never by rendering it, so a
// prefetch or a read-only view marks nothing. Only what existed when the page
// was rendered is marked, so news that arrives while it is open stays new.
// `where` is a role id, "shortlists" for the custom shortlists library, or
// nothing for the activity page, which is everything.
export async function markActivitySeen(renderedAt: string, where?: string) {
  const user = await requireWritableWorkspace();
  const upTo = new Date(renderedAt);
  if (Number.isNaN(upTo.getTime())) return;
  if (where === "shortlists") await markShortlistsRead(user.id, upTo);
  else if (where) await markRoleRead(user.id, where, upTo);
  else await markReadUpTo(user.id, upTo);
  // No revalidation: the page keeps showing what was new when it opened, and
  // only the bell is told to count again.
}
