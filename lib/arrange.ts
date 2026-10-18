import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { clientKey } from "./shortlist-core.mjs";
import { openOfferTimes } from "./arrange-core.mjs";
import { CLOSED_STAGES, consentPersonSelect, knownConsentAt } from "./shortlists";

// What arranging one candidate's client interview needs to know, read under
// the owner: the role and its client, whether the client asked to meet them
// (on the role's own link or on a custom shortlist for the same client), the
// consent Capture has for that client, an interview already booked, and an
// open offer of times. Shared by the page and the actions, which read it again
// rather than trusting the page.

type Tx = Prisma.TransactionClient;

// Interviews already booked with this client, on any of its roles: an offered
// or set time may not overlap one.
export async function clientBusy(client: Tx | typeof db, ownerId: string, key: string, now: Date, exceptBookingId?: string) {
  const booked = await client.booking.findMany({
    where: { userId: ownerId, kind: "interview", status: "booked", endsAt: { gt: now }, ...(exceptBookingId ? { id: { not: exceptBookingId } } : {}) },
    select: { startsAt: true, endsAt: true, candidate: { select: { role: { select: { id: true, client: true } } } } },
  });
  return booked
    .filter((booking) => clientKey(booking.candidate.role.client, booking.candidate.role.id) === key)
    .map((booking) => ({ start: booking.startsAt.getTime(), end: booking.endsAt.getTime() }));
}

// The newest offer for a candidate that is neither withdrawn nor booked, with
// the times still open on it (none, when every time has passed or clashes).
export async function currentOffer(candidateId: string, ownerId: string, key: string, now = new Date()) {
  const offer = await db.interviewOffer.findFirst({
    where: { candidateId, userId: ownerId, withdrawnAt: null, bookingId: null },
    orderBy: { createdAt: "desc" },
  });
  if (!offer) return null;
  const busy = await clientBusy(db, ownerId, key, now);
  return { offer, open: openOfferTimes(offer, now, busy) };
}

export async function loadArrangement(candidateId: string, ownerId: string, now = new Date()) {
  const candidate = await db.candidate.findFirst({
    where: { id: candidateId, role: { userId: ownerId } },
    select: {
      id: true, fullName: true, stage: true, personId: true, profileUrl: true, memberId: true, submittedAt: true,
      role: { select: { id: true, title: true, client: true, status: true, clientReviewFirst: true, interviewLocation: true, interviewTimezone: true, interviewDurationMins: true } },
      person: { select: { id: true, email: true, ...consentPersonSelect } },
      bookings: { where: { kind: "interview", status: "booked", endsAt: { gt: now } }, orderBy: { startsAt: "asc" }, take: 1 },
      outreach: { orderBy: { sentAt: "desc" }, take: 1, select: { sentAt: true } },
    },
  });
  if (!candidate) return null;
  const key = clientKey(candidate.role.client, candidate.role.id);
  const personId = candidate.personId;
  const [roleItem, customAnswers, offer] = await Promise.all([
    personId
      ? db.shortlistItem.findFirst({ where: { personId, shortlist: { kind: "role", roleId: candidate.role.id, userId: ownerId } }, select: { id: true, candidateId: true, consentAt: true, decision: true, decisionAt: true } })
      : null,
    personId
      ? db.shortlistItem.findMany({
          where: { personId, decision: "interview", shortlist: { userId: ownerId, kind: "custom" } },
          orderBy: { decisionAt: "desc" },
          select: { id: true, consentAt: true, decisionAt: true, decisionReason: true, decisionNote: true, decisionAccessId: true, shortlist: { select: { title: true, client: true } } },
        })
      : [],
    currentOffer(candidate.id, ownerId, key, now),
  ]);
  const customAnswer = customAnswers.find((answer) => clientKey(answer.shortlist.client, "") === key) ?? null;
  // When and where the client said so: the role's link, or a shortlist.
  const asked = roleItem?.decision === "interview"
    ? { at: roleItem.decisionAt, on: null as string | null }
    : customAnswer ? { at: customAnswer.decisionAt, on: customAnswer.shortlist.title } : null;
  const consentAt = roleItem?.consentAt ?? knownConsentAt(candidate.person, candidate.id, candidate.role.client);
  const blocked = candidate.role.status !== "open"
    ? "This role is closed. Reopen it to arrange an interview."
    : CLOSED_STAGES.includes(candidate.stage)
      ? "Rejected and placed candidates are not interviewed."
      : candidate.person?.doNotContact
        ? "This person is marked do not contact."
        : !personId
          ? "This candidate has no person record yet."
          : null;
  return { candidate, key, roleItem, customAnswer, asked, consentAt, offer, booking: candidate.bookings[0] ?? null, blocked };
}

export type Arrangement = NonNullable<Awaited<ReturnType<typeof loadArrangement>>>;
