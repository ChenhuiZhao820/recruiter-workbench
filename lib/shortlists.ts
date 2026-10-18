import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { appOrigin } from "./auth";
import { clientProfile, type ClientProfile } from "./client-profile";
import {
  accessOpens,
  canDecide,
  hasInterviewHours,
  readGateCookie,
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

// The cookie that keeps a named person's browser in, scoped to their link's
// own path so it is sent for that page and its actions and nothing else.
export const GATE_COOKIE = "capture_shortlist_gate";

// A role's client link, made the first time it is needed, with its one
// "anyone with the link" access. The unique roleId makes a race harmless. A
// link already shared with named people is left as it is: making it public
// again is the recruiter's choice, never a side effect.
export async function ensureRoleShortlist(tx: Tx, ownerId: string, role: { id: string; title: string; client: string | null }) {
  const existing = await tx.shortlist.findUnique({ where: { roleId: role.id }, include: { accesses: true } });
  if (existing) {
    if (existing.userId !== ownerId) throw new Error("That role belongs to another account.");
    if (existing.access === "link" && !existing.accesses.some((access) => access.email === null && !access.revokedAt)) {
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

// New addresses for whoever the shortlist is shared with now: the one public
// link, or each named person's. Every old address stops working at once.
export async function replaceLinks(tx: Tx, shortlist: { id: string; access: string }) {
  if (shortlist.access === "people") {
    const named = await tx.shortlistAccess.findMany({ where: { shortlistId: shortlist.id, email: { not: null }, revokedAt: null }, select: { id: true } });
    for (const access of named) await tx.shortlistAccess.update({ where: { id: access.id }, data: { nonce: newNonce(), lastViewedAt: null, viewCount: 0 } });
    return;
  }
  const { count } = await tx.shortlistAccess.updateMany({ where: { shortlistId: shortlist.id, email: null, revokedAt: null }, data: { nonce: newNonce(), lastViewedAt: null, viewCount: 0 } });
  if (!count) await tx.shortlistAccess.create({ data: { shortlistId: shortlist.id, nonce: newNonce() } });
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

// What the client said about one person, shown back to them so they can see
// and change it. It is theirs: the recruiter's notes never come this way.
export type ClientDecision = { decision: "interview" | "declined"; reason: string | null; note: string | null; at: Date } | null;

export type ClientShortlistEntry = { itemId: string; profile: ClientProfile; addedAt: Date; decision: ClientDecision; canDecide: boolean };

// An interview booked with someone on the page, still to come. Where it is
// comes from the role's interview hours: a meeting link or an address.
export type ClientInterview = {
  bookingId: string;
  itemId: string;
  candidateId: string;
  fullName: string;
  startsAt: Date;
  endsAt: Date;
  meetingUrl: string | null;
  place: string | null;
  // The client's own zone, from the role's interview hours.
  timeZone: string;
  roleTitle: string;
};

export type ClientShortlistView = {
  title: string;
  client: string | null;
  roleTitle: string | null;
  recruiterName: string;
  entries: ClientShortlistEntry[];
  interviews: ClientInterview[];
  // Whether the client answers before interviews. A custom shortlist always
  // asks; a role's link stops asking when the recruiter turns review off.
  reviewFirst: boolean;
  // A role link whose client wants to meet someone, on a role with no
  // interview hours yet: the client is offered to set their own.
  needsHours: boolean;
};

// The entries a client sees, read live: whoever has since become do not
// contact, been rejected or moved off the role is left out.
async function visibleEntries(shortlist: { id: string; kind: string; roleId: string | null }, now: Date): Promise<{ entries: ClientShortlistEntry[]; interviews: ClientInterview[] }> {
  const items = await db.shortlistItem.findMany({
    where: { shortlistId: shortlist.id },
    orderBy: [{ position: "asc" }, { addedAt: "asc" }],
    include: {
      person: { select: personForClient },
      candidate: {
        select: {
          id: true, roleId: true, personId: true, stage: true, fullName: true, headline: true,
          role: { select: { title: true, interviewLocation: true, interviewTimezone: true } },
          bookings: { where: { kind: "interview", status: "booked" }, orderBy: { startsAt: "desc" }, select: { id: true, startsAt: true, endsAt: true, meetingUrl: true, place: true, timeZone: true }, take: 1 },
        },
      },
    },
  });
  const visible = items.filter((item) => itemVisible({ shortlist, item, person: item.person, candidate: item.candidate }));
  const interviews: ClientInterview[] = visible.flatMap((item) => {
    const booking = item.candidate?.bookings[0];
    if (!booking || booking.endsAt <= now) return [];
    const where = (booking.place ?? item.candidate!.role.interviewLocation ?? "").trim();
    return [{
      bookingId: booking.id, itemId: item.id, candidateId: item.candidate!.id, fullName: item.person.fullName,
      startsAt: booking.startsAt, endsAt: booking.endsAt, meetingUrl: booking.meetingUrl, place: booking.meetingUrl ? null : where || null,
      timeZone: booking.timeZone ?? item.candidate!.role.interviewTimezone ?? "Europe/London", roleTitle: item.candidate!.role.title,
    }];
  }).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const entries: ClientShortlistEntry[] = visible
    .map((item) => ({
      itemId: item.id,
      addedAt: item.addedAt,
      profile: clientProfile({ person: item.person, candidate: item.candidate, pitch: item.pitch, now }),
      decision: item.decision === "interview" || item.decision === "declined"
        ? { decision: item.decision as "interview" | "declined", reason: item.decisionReason, note: item.decisionNote, at: item.decisionAt ?? item.addedAt }
        : null,
      canDecide: canDecide({ interviewBooked: Boolean(item.candidate?.bookings.length) }),
    }));
  return { entries, interviews };
}

function recruiterName(settings: { recruiterName: string } | null, owner: { name: string }) {
  return settings?.recruiterName.trim() || owner.name;
}

type RoleChoices = { clientReviewFirst: boolean; interviewWindows: string; interviewTimezone: string | null; interviewDurationMins: number | null } | null;

function clientChoices(role: RoleChoices, entries: ClientShortlistEntry[]) {
  const reviewFirst = role ? role.clientReviewFirst : true;
  const wanted = reviewFirst ? entries.some((entry) => entry.decision?.decision === "interview") : entries.length > 0;
  return { reviewFirst, needsHours: Boolean(role) && wanted && !hasInterviewHours(role!) };
}

export type ClientPage =
  | { state: "active"; accessId: string; ownerId: string; shortlistId: string; roleId: string | null; view: ClientShortlistView }
  // A named link whose browser has not confirmed the email yet.
  | { state: "gate"; accessId: string; recruiterName: string }
  | { state: "inactive"; recruiterName: string | null };

// Everything /s/<token> shows, from the link alone. Any doubt reads as an
// inactive link that names nobody but, where the link was genuine, the
// recruiter to ask.
export async function loadClientPage(token: string, now = new Date(), gateCookie?: string): Promise<ClientPage> {
  const read = readShortlistToken(shortlistSecret(), token);
  if (!read) return { state: "inactive", recruiterName: null };
  const access = await db.shortlistAccess.findUnique({
    where: { id: read.accessId },
    include: {
      shortlist: {
        include: {
          role: { select: { id: true, title: true, status: true, userId: true, clientReviewFirst: true, interviewWindows: true, interviewTimezone: true, interviewDurationMins: true } },
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
  if (!accessOpens(access, shortlist)) return { state: "inactive", recruiterName: name };
  if (shortlistStatus(shortlist, shortlist.role, now) !== "active") return { state: "inactive", recruiterName: name };
  // A named link opens once the browser has confirmed the email it was sent
  // to; the cookie is signed over this access and its nonce.
  if (access.email && !readGateCookie(shortlistSecret(), access.id, access.nonce, gateCookie, now)) {
    return { state: "gate", accessId: access.id, recruiterName: name };
  }
  const visible = await visibleEntries(shortlist, now);
  return {
    state: "active",
    accessId: access.id,
    ownerId: shortlist.userId,
    shortlistId: shortlist.id,
    roleId: shortlist.roleId,
    view: {
      title: shortlist.title,
      client: shortlist.client,
      roleTitle: shortlist.role?.title ?? null,
      ...clientChoices(shortlist.role, visible.entries),
      recruiterName: name,
      ...visible,
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
  if (count !== 1) return { counted: false, first: false };
  const access = await db.shortlistAccess.findUnique({ where: { id: accessId }, select: { viewCount: true } });
  return { counted: true, first: access?.viewCount === 1 };
}

// The same page for the recruiter, inside the app, without a token: what the
// client would see right now. Reading it never counts as a client's view.
export async function loadPreview(shortlistId: string, ownerId: string, now = new Date()): Promise<{ view: ClientShortlistView; status: string } | null> {
  const shortlist = await db.shortlist.findFirst({
    where: { id: shortlistId, userId: ownerId },
    include: {
      role: { select: { id: true, title: true, status: true, userId: true, clientReviewFirst: true, interviewWindows: true, interviewTimezone: true, interviewDurationMins: true } },
      user: { select: { name: true, settings: { select: { recruiterName: true } } } },
    },
  });
  if (!shortlist) return null;
  const visible = await visibleEntries(shortlist, now);
  return {
    status: shortlistStatus(shortlist, shortlist.role, now),
    view: {
      title: shortlist.title,
      client: shortlist.client,
      roleTitle: shortlist.role?.title ?? null,
      ...clientChoices(shortlist.role, visible.entries),
      recruiterName: recruiterName(shortlist.user.settings, shortlist.user),
      ...visible,
    },
  };
}
