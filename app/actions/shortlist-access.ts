"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { appOrigin, assertSameOrigin, takeAuthAttempt } from "@/lib/auth";
import { requireWritableFeature } from "@/lib/feature-access";
import type { FormState } from "@/lib/formState";
import { GATE_COOKIE } from "@/lib/shortlists";
import {
  EMAILS_PER_SHORTLIST,
  GATE_DAYS,
  emailMatches,
  gateCookieValue,
  newNonce,
  nonceMatches,
  parseEmailList,
  readShortlistToken,
  shortlistSecret,
} from "@/lib/shortlist-core.mjs";

// Who may open a shortlist: anyone with its one link, or only named people,
// each with their own. A named link asks for the email it was sent to once
// per browser. That keeps a forwarded link from opening for whoever gets it;
// it does not prove the reader owns the inbox, because Capture sends nothing.

// --- The client's side -------------------------------------------------------

export async function openNamedLink(_prev: FormState, formData: FormData): Promise<FormState> {
  assertSameOrigin();
  const token = String(formData.get("token") ?? "");
  const secret = shortlistSecret();
  const read = readShortlistToken(secret, token);
  const access = read ? await db.shortlistAccess.findUnique({ where: { id: read.accessId } }) : null;
  if (!read || !access || !access.email || access.revokedAt || !nonceMatches(access.nonce, read.nonce)) {
    return { error: "This link is no longer active. Ask the recruiter who sent it for a new one." };
  }
  if (!(await takeAuthAttempt(`shortlist-gate:${access.id}`, 10, 3600))) {
    return { error: "Too many tries. Wait an hour, or ask the recruiter who sent it." };
  }
  if (!emailMatches(access.email, String(formData.get("email") ?? ""))) {
    return { error: "That is not the address this link was sent to. Use the one the email came to." };
  }
  cookies().set(GATE_COOKIE, gateCookieValue(secret!, access.id, access.nonce), {
    httpOnly: true,
    sameSite: "lax",
    secure: appOrigin().startsWith("https:"),
    path: `/s/${token}`,
    maxAge: GATE_DAYS * 86_400,
  });
  redirect(`/s/${token}`);
}

// --- The recruiter's side ----------------------------------------------------

async function ownedShortlist(id: string, ownerId: string) {
  return db.shortlist.findFirst({ where: { id, userId: ownerId }, select: { id: true, kind: true, roleId: true, access: true } });
}

function revalidateShortlist(shortlist: { kind: string; roleId: string | null }) {
  if (shortlist.roleId) revalidatePath(`/roles/${shortlist.roleId}`);
  revalidatePath("/shortlists");
}

// Switching closes every address of the other kind at once: a public link
// stops working when the page becomes named-only, and named links stop when it
// becomes public again.
export async function setShortlistAccess(formData: FormData) {
  const user = await requireWritableFeature("clientShortlists");
  const shortlist = await ownedShortlist(String(formData.get("shortlistId") ?? ""), user.id);
  const mode = String(formData.get("access") ?? "");
  if (!shortlist || (mode !== "link" && mode !== "people") || shortlist.access === mode) return;
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.shortlist.update({ where: { id: shortlist.id }, data: { access: mode } });
    await tx.shortlistAccess.updateMany({
      where: { shortlistId: shortlist.id, revokedAt: null, email: mode === "people" ? null : { not: null } },
      data: { revokedAt: now },
    });
    if (mode === "link") await tx.shortlistAccess.create({ data: { shortlistId: shortlist.id, nonce: newNonce() } });
    await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "shortlist.access_changed" } });
  });
  revalidateShortlist(shortlist);
}

export async function addRecipients(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("clientShortlists");
  const shortlist = await ownedShortlist(String(formData.get("shortlistId") ?? ""), user.id);
  if (!shortlist) return { error: "That shortlist could not be found." };
  if (shortlist.access !== "people") return { error: "Choose \"Only these people\" first." };
  const { emails, invalid } = parseEmailList(formData.get("emails"));
  if (invalid.length) return { error: `${invalid.join(", ")} ${invalid.length === 1 ? "is not an email address" : "are not email addresses"}.` };
  if (!emails.length) return { error: "Type at least one email address." };
  const current = await db.shortlistAccess.findMany({ where: { shortlistId: shortlist.id, email: { not: null }, revokedAt: null }, select: { email: true } });
  const have = new Set(current.map((access) => access.email));
  const fresh = emails.filter((email: string) => !have.has(email));
  if (current.length + fresh.length > EMAILS_PER_SHORTLIST) return { error: `A shortlist can be shared with at most ${EMAILS_PER_SHORTLIST} people.` };
  await db.$transaction(async (tx) => {
    for (const email of fresh) await tx.shortlistAccess.create({ data: { shortlistId: shortlist.id, email, nonce: newNonce() } });
    if (fresh.length) await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "shortlist.recipients_added" } });
  });
  revalidateShortlist(shortlist);
  return fresh.length ? {} : { notice: "They already have their own links." };
}

// The person's link stops working at once. Adding the same address again
// gives them a new one.
export async function removeRecipient(formData: FormData) {
  const user = await requireWritableFeature("clientShortlists");
  const access = await db.shortlistAccess.findFirst({
    where: { id: String(formData.get("accessId") ?? ""), email: { not: null }, revokedAt: null, shortlist: { userId: user.id } },
    select: { id: true, shortlist: { select: { kind: true, roleId: true } } },
  });
  if (!access) return;
  await db.$transaction(async (tx) => {
    await tx.shortlistAccess.update({ where: { id: access.id }, data: { revokedAt: new Date() } });
    await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "shortlist.recipient_removed" } });
  });
  revalidateShortlist(access.shortlist);
}
