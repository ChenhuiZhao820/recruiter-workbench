import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { appOrigin } from "./auth";
import { clientProfile, type ClientProfile } from "./client-profile";
import {
  accessOpens,
  hasPriorConsent,
  itemVisible,
  newNonce,
  nonceMatches,
  readShortlistToken,
  shortlistSecret,
  shortlistStatus,
  shortlistToken,
} from "./shortlist-core.mjs";

// Client links on the server: making and finding a role's link, putting a
// candidate on it, and everything the public page needs from a token alone.
// Never a "use server" export: these take an owner id, which only an action
// that has already authorised the recruiter may supply.

type Tx = Prisma.TransactionClient;

// Stages putting someone forward moves on from; rejected and placed stay put.
export const BEFORE_SUBMITTED = ["sourced", "contacted", "replied", "booking_pending", "booked", "screened"];
// Who cannot be put forward at all.
export const CLOSED_STAGES = ["rejected", "placed"];

export function shortlistLink(accessId: string, nonce: string): string | null {
  const secret = shortlistSecret();
  if (!secret) return null;
  return `${appOrigin()}/s/${shortlistToken(secret, accessId, nonce)}`;
}

// A role's client link, made the first time it is needed, with its one
// "anyone with the link" access. The unique roleId makes a race harmless.
export async function ensureRoleShortlist(tx: Tx, ownerId: string, role: { id: string; title: string; client: string | null }) {
  const existing = await tx.shortlist.findUnique({ where: { roleId: role.id }, include: { accesses: true } });
  if (existing) {
    if (existing.userId !== ownerId) throw new Error("That role belongs to another account.");
    if (!existing.accesses.some((access) => access.email === null && !access.revokedAt)) {
      await tx.shortlistAccess.create({ data: { shortlistId: existing.id, nonce: newNonce() } });
    }
    return existing;
  }
  return tx.shortlist.create({
    data: {
      userId: ownerId,
      kind: "role",
      roleId: role.id,
      title: role.title,
      client: role.client,
      access: "link",
      accesses: { create: { nonce: newNonce() } },
    },
  });
}

type ConsentPerson = {
  candidates: { id: string; role: { client: string | null }; screenings: { representConsentAt: Date | null }[] }[];
  shortlistItems: { consentAt: Date; shortlist: { client: string | null } }[];
};

// When this person agreed to be put forward to this client, if Capture already
// knows: the screening on this candidacy, or any earlier screening or
// shortlist for the same client. Null means the recruiter has to confirm it.
export function knownConsentAt(person: ConsentPerson | null, candidateId: string, client: string | null): Date | null {
  if (!person) return null;
  const own = person.candidates.find((candidate) => candidate.id === candidateId)?.screenings.find((s) => s.representConsentAt)?.representConsentAt;
  if (own) return own;
  const records = [
    ...person.candidates.flatMap((candidate) => candidate.screenings.map((s) => ({ client: candidate.role.client, at: s.representConsentAt }))),
    ...person.shortlistItems.map((item) => ({ client: item.shortlist.client, at: item.consentAt })),
  ];
  if (!hasPriorConsent(records, client)) return null;
  const dates = records.filter((record) => record.at).map((record) => record.at!.getTime());
  return dates.length ? new Date(Math.min(...dates)) : null;
}

export const consentPersonSelect = {
  doNotContact: true,
  candidates: { select: { id: true, role: { select: { client: true } }, screenings: { where: { representConsentAt: { not: null } }, select: { representConsentAt: true } } } },
  shortlistItems: { select: { consentAt: true, shortlist: { select: { client: true } } } },
} as const;

// Puts one candidacy on its role's client link. The caller has checked the
// owner, the role, the stage and the consent; this writes the item and moves
// the candidate to Submitted from any earlier stage. Putting someone forward
// twice keeps their place and their first consent.
export async function putOnRoleShortlist(tx: Tx, args: {
  ownerId: string;
  role: { id: string; title: string; client: string | null };
  candidate: { id: string; stage: string; submittedAt: Date | null };
  personId: string;
  consentAt: Date;
  now: Date;
}) {
  const shortlist = await ensureRoleShortlist(tx, args.ownerId, args.role);
  const existing = await tx.shortlistItem.findUnique({ where: { shortlistId_personId: { shortlistId: shortlist.id, personId: args.personId } } });
  if (existing) {
    if (existing.candidateId !== args.candidate.id) await tx.shortlistItem.update({ where: { id: existing.id }, data: { candidateId: args.candidate.id } });
  } else {
    const position = await tx.shortlistItem.count({ where: { shortlistId: shortlist.id } });
    await tx.shortlistItem.create({ data: { shortlistId: shortlist.id, personId: args.personId, candidateId: args.candidate.id, consentAt: args.consentAt, position } });
  }
  await tx.candidate.update({
    where: { id: args.candidate.id },
    data: {
      lastActivityAt: args.now,
      submittedAt: args.candidate.submittedAt ?? args.now,
      ...(BEFORE_SUBMITTED.includes(args.candidate.stage) ? { stage: "submitted" } : {}),
    },
  });
  return { shortlistId: shortlist.id, added: !existing };
}

// --- The public page ---------------------------------------------------------

const personForClient = {
  id: true,
  fullName: true,
  headline: true,
  doNotContact: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  salaryNote: true,
  noticeWeeks: true,
  availableFrom: true,
  location: true,
  remotePreference: true,
  rightToWork: true,
  rightToWorkNote: true,
  skillsSummary: true,
  motivation: true,
  factsConfirmedAt: true,
} as const;

export type ClientShortlistEntry = { itemId: string; profile: ClientProfile; addedAt: Date };

export type ClientShortlistView = {
  title: string;
  client: string | null;
  roleTitle: string | null;
  recruiterName: string;
  entries: ClientShortlistEntry[];
};

// The entries a client sees, read live: whoever has since become do not
// contact, been rejected or moved off the role is left out.
async function visibleEntries(shortlist: { id: string; kind: string; roleId: string | null }, now: Date): Promise<ClientShortlistEntry[]> {
  const items = await db.shortlistItem.findMany({
    where: { shortlistId: shortlist.id },
    orderBy: [{ position: "asc" }, { addedAt: "asc" }],
    include: {
      person: { select: personForClient },
      candidate: { select: { id: true, roleId: true, personId: true, stage: true, fullName: true, headline: true } },
    },
  });
  return items
    .filter((item) => itemVisible({ shortlist, item, person: item.person, candidate: item.candidate }))
    .map((item) => ({ itemId: item.id, addedAt: item.addedAt, profile: clientProfile({ person: item.person, candidate: item.candidate, pitch: item.pitch, now }) }));
}

function recruiterName(settings: { recruiterName: string } | null, owner: { name: string }) {
  return settings?.recruiterName.trim() || owner.name;
}

export type ClientPage =
  | { state: "active"; accessId: string; ownerId: string; view: ClientShortlistView }
  | { state: "inactive"; recruiterName: string | null };

// Everything /s/<token> shows, from the link alone. Any doubt reads as an
// inactive link that names nobody but, where the link was genuine, the
// recruiter to ask.
export async function loadClientPage(token: string, now = new Date()): Promise<ClientPage> {
  const read = readShortlistToken(shortlistSecret(), token);
  if (!read) return { state: "inactive", recruiterName: null };
  const access = await db.shortlistAccess.findUnique({
    where: { id: read.accessId },
    include: {
      shortlist: {
        include: {
          role: { select: { id: true, title: true, status: true, userId: true } },
          user: { select: { id: true, name: true, active: true, settings: { select: { recruiterName: true } } } },
        },
      },
    },
  });
  if (!access) return { state: "inactive", recruiterName: null };
  const { shortlist } = access;
  const owner = shortlist.user;
  if (!owner.active) return { state: "inactive", recruiterName: null };
  // The signature proves this address was issued for this access, so whoever
  // holds a replaced one may be told whom to ask for the new one.
  const name = recruiterName(owner.settings, owner);
  if (!nonceMatches(access.nonce, read.nonce)) return { state: "inactive", recruiterName: name };
  if (shortlist.role && shortlist.role.userId !== shortlist.userId) return { state: "inactive", recruiterName: null };
  // Named people come with their own check, which is not built yet: until
  // then a named link does not open.
  if (!accessOpens(access, shortlist) || access.email) return { state: "inactive", recruiterName: name };
  if (shortlistStatus(shortlist, shortlist.role, now) !== "active") return { state: "inactive", recruiterName: name };
  return {
    state: "active",
    accessId: access.id,
    ownerId: shortlist.userId,
    view: {
      title: shortlist.title,
      client: shortlist.client,
      roleTitle: shortlist.role?.title ?? null,
      recruiterName: name,
      entries: await visibleEntries(shortlist, now),
    },
  };
}

// A view is counted at most once every ten minutes per link, so a client
// reading through the page is one visit, not one per reload.
export async function recordClientView(accessId: string, now = new Date()) {
  const quiet = new Date(now.getTime() - 10 * 60_000);
  const { count } = await db.shortlistAccess.updateMany({
    where: { id: accessId, OR: [{ lastViewedAt: null }, { lastViewedAt: { lt: quiet } }] },
    data: { lastViewedAt: now, viewCount: { increment: 1 } },
  });
  return count === 1;
}

// The same page for the recruiter, inside the app, without a token: what the
// client would see right now. Reading it never counts as a client's view.
export async function loadPreview(shortlistId: string, ownerId: string, now = new Date()): Promise<{ view: ClientShortlistView; status: string } | null> {
  const shortlist = await db.shortlist.findFirst({
    where: { id: shortlistId, userId: ownerId },
    include: {
      role: { select: { id: true, title: true, status: true, userId: true } },
      user: { select: { name: true, settings: { select: { recruiterName: true } } } },
    },
  });
  if (!shortlist) return null;
  return {
    status: shortlistStatus(shortlist, shortlist.role, now),
    view: {
      title: shortlist.title,
      client: shortlist.client,
      roleTitle: shortlist.role?.title ?? null,
      recruiterName: recruiterName(shortlist.user.settings, shortlist.user),
      entries: await visibleEntries(shortlist, now),
    },
  };
}
