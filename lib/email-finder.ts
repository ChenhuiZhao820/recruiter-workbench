import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { getAccountTier, type TierAccount } from "./account-tiers";
import { monthlyQuota } from "./features";
import type { OutreachEmail } from "@/components/OutreachStep";
import {
  GIVE_UP_MS, PENDING_COUNTS_MS, REQUEST_TIMEOUT_MS, allowanceStart, countsAgainstAllowance, emailSourceLabel, enrowBase, enrowKey, finderTarget, readResult, readStart,
} from "./enrow-core.mjs";

// The server half of the email finder: the plan's allowance, starting a
// search and reading it. Every request to Enrow is made here, from the
// server, with the deployment's key; the page only ever talks to this app.

export type Allowance = { quota: number; used: number; remaining: number; trial: boolean };

type Client = typeof db | Prisma.TransactionClient;

// A deployment may lower every plan's allowance, never raise it.
export function emailFinderMonthlyCap(): number | null {
  const value = Number(process.env.CAPTURE_EMAIL_FINDER_MONTHLY_CAP);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export async function emailAllowance(account: TierAccount & { id: string }, client: Client = db, now = new Date()): Promise<Allowance> {
  const tier = getAccountTier(account, now);
  const trial = tier === "trial";
  const createdAt = trial ? (await client.user.findUnique({ where: { id: account.id }, select: { createdAt: true } }))?.createdAt ?? null : null;
  const since = allowanceStart(tier, now, createdAt);
  const rows = await client.emailLookup.findMany({
    where: { userId: account.id, createdAt: { gte: since }, OR: [{ status: "found" }, { status: "pending", createdAt: { gte: new Date(now.getTime() - PENDING_COUNTS_MS) } }] },
    select: { status: true, createdAt: true },
  });
  const used = rows.filter((row) => countsAgainstAllowance(row, now)).length;
  const quota = monthlyQuota(account, "emails", emailFinderMonthlyCap(), now);
  return { quota, used, remaining: Math.max(0, quota - used), trial };
}

async function enrow(path: string, init: RequestInit = {}) {
  const response = await fetch(`${enrowBase()}${path}`, {
    ...init,
    headers: { "x-api-key": enrowKey() ?? "", "content-type": "application/json" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

export async function startEnrowSearch(body: object) {
  try {
    const { status, body: reply } = await enrow("/email/find/single", { method: "POST", body: JSON.stringify(body) });
    return readStart(status, reply);
  } catch {
    return { state: "failed" as const };
  }
}

// Reads a pending search once and records how it ended. A found email is
// written onto the person only while they still have none: one typed in the
// meantime is the recruiter's and wins. Reading a result costs nothing.
export async function settleLookup(lookup: { id: string; userId: string; personId: string | null; method: string; enrowId: string | null; createdAt: Date }, now = new Date()) {
  if (!lookup.enrowId) return { status: "failed" as const, reason: null, email: null };
  let result: ReturnType<typeof readResult>;
  try {
    const { status, body } = await enrow(`/email/find/single?id=${encodeURIComponent(lookup.enrowId)}`);
    result = readResult(status, body);
  } catch {
    result = { state: "pending" };
  }
  if (result.state === "pending") {
    if (now.getTime() - lookup.createdAt.getTime() < GIVE_UP_MS) return { status: "pending" as const, reason: null, email: null };
    result = { state: "failed" };
  }
  const finished = result;
  const email = finished.state === "found" ? finished.email : null;
  await db.$transaction(async (tx) => {
    const { count } = await tx.emailLookup.updateMany({
      where: { id: lookup.id, userId: lookup.userId, status: "pending" },
      data: { status: finished.state, reason: finished.state === "not_found" ? finished.reason : null, enrowId: null, finishedAt: now },
    });
    if (!count || !email || !lookup.personId) return;
    await tx.person.updateMany({
      where: { id: lookup.personId, userId: lookup.userId, email: null, doNotContact: false },
      data: { email, emailSource: "finder", emailConsentAt: null },
    });
  });
  return { status: finished.state, reason: finished.state === "not_found" ? finished.reason : null, email };
}

// The email half of an outreach card: the address to draft to, or Find email
// when there is none and the plan has the finder. Nothing at all when there
// is neither, so a plan without the finder sees the card as it was. Emailing
// an address already held is a mailto: draft on any plan.
export async function outreachEmail(
  person: { id: string; fullName: string; profileUrl: string | null; headline: string | null; email: string | null; emailSource: string | null; doNotContact: boolean } | null,
  subject: string,
  { owner, canFind, readOnly }: { owner: TierAccount & { id: string }; canFind: boolean; readOnly: boolean },
): Promise<OutreachEmail | undefined> {
  if (!person || person.doNotContact) return undefined;
  if (person.email) return { address: person.email, sourceLabel: emailSourceLabel(person.emailSource), subject, finder: null };
  if (!canFind || readOnly) return undefined;
  return { address: null, sourceLabel: null, subject, finder: { ...finderTarget(person), allowance: await emailAllowance(owner) } };
}
