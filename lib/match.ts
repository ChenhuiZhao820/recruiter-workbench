import { NextResponse } from "next/server";
import { appOrigin, getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { canUseFeature } from "@/lib/features";
import { getWorkspace } from "@/lib/workspace";
import { matchMonthlyCap } from "@/lib/match-core.mjs";

// Instant Match's server side: who may ask, and how many briefs an account has
// had read this month. Reading a brief and adjusting criteria in words are the
// paid calls; everything else on the page is free and is not counted.

export const PAID_KINDS = ["match_brief_read", "match_adjusted"] as const;

function monthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function nextMonthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export async function matchReadsLeft(ownerId: string, now = new Date()) {
  const used = await db.usageEvent.count({ where: { userId: ownerId, kind: { in: [...PAID_KINDS] }, at: { gte: monthStart(now) } } });
  return Math.max(0, matchMonthlyCap() - used);
}

// For a route handler: the signed-in account in its own workspace, with the
// feature, from this site. Anything else is answered here, as JSON.
export async function writableMatchAccount(request: Request) {
  if (request.headers.get("origin") !== appOrigin()) {
    return { error: NextResponse.json({ error: "This request did not come from the workbench. Reload the page and try again." }, { status: 403 }) };
  }
  if (!(await getSession())) return { error: NextResponse.json({ error: "Sign in again to continue." }, { status: 401 }) };
  const { user, owner, readOnly } = await getWorkspace();
  const now = new Date();
  if (!canUseFeature(user, "instantMatch", now) || !canUseFeature(owner, "instantMatch", now)) {
    return { error: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  if (readOnly) {
    return { error: NextResponse.json({ error: "This workspace is read-only. Return to your own workspace to match a brief." }, { status: 403 }) };
  }
  return { user };
}
