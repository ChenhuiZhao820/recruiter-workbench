import { db } from "./db";
import { appOrigin } from "./auth";
import {
  availableSlots,
  bookingSecret,
  bookingToken,
  parseWindows,
  readBookingToken,
} from "./booking-core.mjs";

// The booking page: one link per candidate, a public page with the
// recruiter's free times, and one transaction that books a slot. Capture
// sends nothing; the link travels in the recruiter's own message.

export type BookingSettings = {
  bookingWindows: string;
  bookingTimezone: string;
  bookingDurationMins: number;
  bookingMinNoticeHours: number;
  bookingHorizonDays: number;
  meetingLink: string;
  offerPhone: boolean;
  privacyNotice: string;
  privacyContactEmail: string;
  recruiterName: string;
};

// Stages a confirmed booking moves forward from; later stages stay put.
export const BEFORE_BOOKED = ["sourced", "contacted", "replied", "booking_pending"];
// A link stops working for these.
const CLOSED_STAGES = ["rejected", "placed"];

export type Readiness = { ready: boolean; missing: string[] };

// What still stands between the recruiter and a working booking link.
export function bookingReadiness(settings: Pick<BookingSettings, "bookingWindows" | "meetingLink" | "offerPhone">, env = process.env): Readiness {
  const missing: string[] = [];
  if (!bookingSecret(env)) missing.push("the server's booking link secret (ask your administrator)");
  if (parseWindows(settings.bookingWindows).length === 0) missing.push("the hours you take calls");
  if (!settings.meetingLink && !settings.offerPhone) missing.push("a meeting link or the phone option");
  return { ready: missing.length === 0, missing };
}

export function bookingLink(candidateId: string, now = new Date()): string | null {
  const secret = bookingSecret();
  if (!secret) return null;
  return `${appOrigin()}/book/${bookingToken(secret, candidateId, now)}`;
}

export function candidateCanBook(candidate: { stage: string; role: { status: string }; person: { doNotContact: boolean } | null }) {
  return candidate.role.status === "open" && !CLOSED_STAGES.includes(candidate.stage) && !candidate.person?.doNotContact;
}

// The link a template's {{booking_link}} becomes for one candidate, or "" when
// there is none to give: the message then shows the gap instead of a dead link.
export function bookingLinkFor(
  candidate: { id: string; stage: string; role: { status: string }; person: { doNotContact: boolean } | null },
  settings: Pick<BookingSettings, "bookingWindows" | "meetingLink" | "offerPhone">,
  now = new Date(),
): string {
  if (!bookingReadiness(settings).ready || !candidateCanBook(candidate)) return "";
  return bookingLink(candidate.id, now) ?? "";
}

export function defaultPrivacyNotice(recruiterName: string, contactEmail: string) {
  const who = recruiterName || "The recruiter";
  return [
    `${who} uses Capture to keep track of the people they talk to about roles.`,
    "When you book a call, your name, your email address, the time you chose and any phone number you give are kept so the call can happen. Notes or a transcript of the call may be kept for up to 30 days, and what you said about salary, notice period, location and right to work is kept on your record afterwards.",
    "If you tick the box to be kept in mind for future roles, your details are kept until you ask for them to be removed. Otherwise they are kept only for this role.",
    `You can ask to see, correct or delete what is kept about you at any time${contactEmail ? ` by emailing ${contactEmail}` : " by replying to the message that sent you this link"}. You can also complain to the Information Commissioner's Office (ico.org.uk).`,
  ].join("\n\n");
}

export function privacyNoticeText(settings: Pick<BookingSettings, "privacyNotice" | "privacyContactEmail" | "recruiterName">, accountEmail: string) {
  return settings.privacyNotice.trim() || defaultPrivacyNotice(settings.recruiterName, settings.privacyContactEmail || accountEmail);
}

// Everything the public page and its action need, from the link alone.
export async function loadBookingContext(token: string, now = new Date()) {
  const read = readBookingToken(bookingSecret(), token, now);
  if (!read) return null;
  const candidate = await db.candidate.findUnique({
    where: { id: read.candidateId },
    select: {
      id: true,
      fullName: true,
      stage: true,
      personId: true,
      role: { select: { id: true, title: true, status: true, userId: true, user: { select: { id: true, email: true, name: true, active: true } } } },
      person: { select: { id: true, doNotContact: true } },
      bookings: { where: { status: "booked", endsAt: { gt: now } }, orderBy: { startsAt: "asc" }, take: 1 },
    },
  });
  if (!candidate || !candidate.role.user.active) return null;
  const owner = candidate.role.user;
  const settings = await db.settings.findUnique({ where: { userId: owner.id } });
  if (!settings) return null;
  return { read, candidate, owner, settings, booking: candidate.bookings[0] ?? null };
}

export async function freeSlots(ownerId: string, settings: BookingSettings, now = new Date()) {
  const horizonEnd = new Date(now.getTime() + (settings.bookingHorizonDays + 1) * 86_400_000);
  const booked = await db.booking.findMany({
    where: { userId: ownerId, status: "booked", endsAt: { gt: now }, startsAt: { lt: horizonEnd } },
    select: { startsAt: true, endsAt: true },
  });
  return availableSlots({
    windows: parseWindows(settings.bookingWindows),
    timeZone: settings.bookingTimezone,
    durationMins: settings.bookingDurationMins,
    minNoticeHours: settings.bookingMinNoticeHours,
    horizonDays: settings.bookingHorizonDays,
    now,
    busy: booked.map((b) => ({ start: b.startsAt.getTime(), end: b.endsAt.getTime() })),
  });
}
