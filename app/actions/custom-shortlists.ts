"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWritableFeature } from "@/lib/feature-access";
import { activeShortlistLimit } from "@/lib/features";
import type { FormState } from "@/lib/formState";
import { consentPersonSelect, knownConsentAt } from "@/lib/shortlists";
import { canOpenAnother, customExpiry, defaultShortlistTitle, newNonce, shortlistStatus } from "@/lib/shortlist-core.mjs";
import { recordUsage } from "@/lib/usage";

// Shortlists the recruiter puts together themselves: any people, for one
// client, on a link that expires. Below Pro only a few may be active at once;
// the count and the insert happen in one transaction, and reaching the limit
// only ever refuses a new or reopened one, never closes a link already sent.

const MAX_PEOPLE = 50;
const TEXT_LIMIT = 120;

class LimitReached extends Error {}

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_LIMIT);
}

function limitMessage(limit: number) {
  return `You already have ${limit} active shortlists, the most your plan keeps open at once. Close one, or let one expire, to open another.`;
}

async function activeCustomCount(tx: Prisma.TransactionClient, ownerId: string, now: Date) {
  return tx.shortlist.count({ where: { userId: ownerId, kind: "custom", revokedAt: null, expiresAt: { gt: now } } });
}

// The people named in the form, owned by this account, each with what Capture
// knows about their agreement to this client. Anyone not to be contacted, or
// not agreed to be put forward, stops the whole save with their names.
async function consentedPeople(ownerId: string, formData: FormData, client: string) {
  const ids = Array.from(new Set(formData.getAll("p").map(String))).slice(0, MAX_PEOPLE);
  const people = await db.person.findMany({ where: { id: { in: ids }, userId: ownerId }, select: { id: true, fullName: true, ...consentPersonSelect } });
  const byId = new Map(people.map((person) => [person.id, person]));
  const ordered = ids.map((id) => byId.get(id)).filter((person): person is (typeof people)[number] => Boolean(person));
  if (ordered.length === 0) return { error: "Choose at least one person." };
  const blocked = ordered.filter((person) => person.doNotContact);
  if (blocked.length) return { error: `${blocked.map((person) => person.fullName).join(", ")} ${blocked.length === 1 ? "is" : "are"} marked do not contact. Take them off the list first.` };
  const agreed = new Set(formData.getAll("agreed").map(String));
  const now = new Date();
  const withConsent = ordered.map((person) => ({ person, consentAt: knownConsentAt(person, "", client) ?? (agreed.has(person.id) ? now : null) }));
  const missing = withConsent.filter((entry) => !entry.consentAt);
  if (missing.length) {
    return { error: `Tick that ${missing.map((entry) => entry.person.fullName).join(", ")} agreed to be put forward${client ? ` to ${client}` : ""}, or take them off the list.` };
  }
  return { people: withConsent as { person: (typeof people)[number]; consentAt: Date }[] };
}

export async function createShortlist(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("clientShortlists");
  const now = new Date();
  const client = text(formData, "client");
  if (!client) return { error: "Say which client this shortlist is for." };
  const title = text(formData, "title") || defaultShortlistTitle(client, now);
  const chosen = await consentedPeople(user.id, formData, client);
  if (chosen.error) return { error: chosen.error };
  const limit = activeShortlistLimit(user, now);
  let id = "";
  try {
    id = await db.$transaction(async (tx) => {
      if (!canOpenAnother(await activeCustomCount(tx, user.id, now), limit)) throw new LimitReached();
      const shortlist = await tx.shortlist.create({
        data: {
          userId: user.id,
          kind: "custom",
          title,
          client,
          access: "link",
          expiresAt: customExpiry(now),
          accesses: { create: { nonce: newNonce() } },
          items: { create: chosen.people!.map(({ person, consentAt }, position) => ({ personId: person.id, consentAt, position })) },
        },
      });
      await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "shortlist.created" } });
      await recordUsage(tx, user.id, "shortlist_created");
      return shortlist.id;
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof LimitReached) return { error: limitMessage(limit!) };
    throw error;
  }
  revalidatePath("/shortlists");
  redirect(`/shortlists?open=${id}#shortlist-${id}`);
}

async function ownedCustom(id: string, ownerId: string) {
  return db.shortlist.findFirst({ where: { id, userId: ownerId, kind: "custom" }, include: { items: { select: { personId: true } } } });
}

export async function addToShortlist(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("clientShortlists");
  const shortlist = await ownedCustom(String(formData.get("shortlistId") ?? ""), user.id);
  if (!shortlist) return { error: "That shortlist could not be found." };
  if (shortlistStatus(shortlist, null, new Date()) !== "active") return { error: "This shortlist is closed or has expired. Keep it open before adding people." };
  const chosen = await consentedPeople(user.id, formData, shortlist.client ?? "");
  if (chosen.error) return { error: chosen.error };
  const already = new Set(shortlist.items.map((item) => item.personId));
  const fresh = chosen.people!.filter(({ person }) => !already.has(person.id));
  await db.$transaction(async (tx) => {
    for (let offset = 0; offset < fresh.length; offset++) {
      const { person, consentAt } = fresh[offset];
      await tx.shortlistItem.create({ data: { shortlistId: shortlist.id, personId: person.id, consentAt, position: shortlist.items.length + offset } });
    }
  });
  revalidatePath("/shortlists");
  redirect(`/shortlists?open=${shortlist.id}#shortlist-${shortlist.id}`);
}

export async function removeFromShortlist(formData: FormData) {
  const user = await requireWritableFeature("clientShortlists");
  const { count } = await db.shortlistItem.deleteMany({ where: { id: String(formData.get("itemId") ?? ""), shortlist: { userId: user.id, kind: "custom" } } });
  if (count) revalidatePath("/shortlists");
}

// The name only. Everyone on a shortlist agreed to be put forward to its
// client, so the client never changes under them.
export async function renameShortlist(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("clientShortlists");
  const title = text(formData, "title");
  if (!title) return { error: "A shortlist needs a name." };
  const { count } = await db.shortlist.updateMany({ where: { id: String(formData.get("shortlistId") ?? ""), userId: user.id, kind: "custom" }, data: { title } });
  if (!count) return { error: "That shortlist could not be found." };
  revalidatePath("/shortlists");
  return { notice: "Saved." };
}

// Keeps a shortlist open for another stretch from today. One that has already
// expired is opened again, which needs a free place under the plan's limit.
export async function keepShortlistOpen(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("clientShortlists");
  const now = new Date();
  const shortlist = await ownedCustom(String(formData.get("shortlistId") ?? ""), user.id);
  if (!shortlist || shortlist.revokedAt) return { error: "That shortlist could not be found." };
  const limit = activeShortlistLimit(user, now);
  try {
    await db.$transaction(async (tx) => {
      const reopening = shortlistStatus(shortlist, null, now) !== "active";
      if (reopening && !canOpenAnother(await activeCustomCount(tx, user.id, now), limit)) throw new LimitReached();
      await tx.shortlist.update({ where: { id: shortlist.id }, data: { expiresAt: customExpiry(now) } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof LimitReached) return { error: limitMessage(limit!) };
    throw error;
  }
  revalidatePath("/shortlists");
  return {};
}

export async function closeShortlist(formData: FormData) {
  const user = await requireWritableFeature("clientShortlists");
  const now = new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.shortlist.updateMany({ where: { id: String(formData.get("shortlistId") ?? ""), userId: user.id, kind: "custom", revokedAt: null }, data: { revokedAt: now } });
    if (count) await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "shortlist.revoked" } });
  });
  revalidatePath("/shortlists");
}

// A new address for the same shortlist. A closed one opens again under it,
// for a fresh stretch, which needs a free place under the plan's limit.
export async function newShortlistLink(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("clientShortlists");
  const now = new Date();
  const shortlist = await ownedCustom(String(formData.get("shortlistId") ?? ""), user.id);
  if (!shortlist) return { error: "That shortlist could not be found." };
  const limit = activeShortlistLimit(user, now);
  try {
    await db.$transaction(async (tx) => {
      const reopening = shortlistStatus(shortlist, null, now) !== "active";
      if (reopening && !canOpenAnother(await activeCustomCount(tx, user.id, now), limit)) throw new LimitReached();
      if (reopening) await tx.shortlist.update({ where: { id: shortlist.id }, data: { revokedAt: null, expiresAt: customExpiry(now) } });
      const { count } = await tx.shortlistAccess.updateMany({ where: { shortlistId: shortlist.id, email: null, revokedAt: null }, data: { nonce: newNonce(), lastViewedAt: null, viewCount: 0 } });
      if (!count) await tx.shortlistAccess.create({ data: { shortlistId: shortlist.id, nonce: newNonce() } });
      await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "shortlist.new_link" } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof LimitReached) return { error: limitMessage(limit!) };
    throw error;
  }
  revalidatePath("/shortlists");
  return {};
}
