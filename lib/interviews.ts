import { db } from "./db";
import { appOrigin } from "./auth";
import { availableSlots, bookingSecret, bookingToken, parseWindows } from "./booking-core.mjs";
import { clientKey, hasInterviewHours, interviewLinkState } from "./shortlist-core.mjs";
import { currentOffer } from "./arrange";

// Client interviews: the hours a client interviews in, kept on the role; the
// signed link a candidate books one from; and the free times, which are the
// client's hours less every interview already booked with that client, across
// all of its roles. The recruiter's own diary plays no part: they are not in
// the room.

export const INTERVIEW_DURATIONS = [30, 45, 60, 90];
export const INTERVIEW_NOTICE_HOURS = 24;
export const INTERVIEW_HORIZON_DAYS = 21;

export type InterviewHours = { windows: string; timeZone: string; durationMins: number; location: string };

type RoleHours = { id: string; client: string | null; interviewWindows: string; interviewTimezone: string | null; interviewDurationMins: number | null; interviewLocation: string | null };

function fromRole(role: RoleHours): InterviewHours {
  return { windows: role.interviewWindows, timeZone: role.interviewTimezone!, durationMins: role.interviewDurationMins!, location: role.interviewLocation ?? "" };
}

// What the hours form starts with: this role's own hours, or the most recent
// role for the same client that has some, or the recruiter's booking hours at
// 45 minutes, so a recruiter usually confirms rather than types.
export async function interviewHoursPrefill(ownerId: string, role: RoleHours, settings: { bookingWindows: string; bookingTimezone: string }): Promise<InterviewHours & { from: "role" | "client" | "settings" }> {
  if (hasInterviewHours(role)) return { ...fromRole(role), from: "role" };
  const key = clientKey(role.client, role.id);
  if (!key.startsWith("role:")) {
    const others = await db.role.findMany({
      where: { userId: ownerId, id: { not: role.id }, client: { not: null }, interviewTimezone: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, client: true, interviewWindows: true, interviewTimezone: true, interviewDurationMins: true, interviewLocation: true },
    });
    const same = others.find((other) => clientKey(other.client, other.id) === key && hasInterviewHours(other));
    if (same) return { ...fromRole(same), from: "client" };
  }
  return { windows: settings.bookingWindows, timeZone: settings.bookingTimezone, durationMins: 45, location: "", from: "settings" };
}

export function interviewLink(candidateId: string, now = new Date()): string | null {
  const secret = bookingSecret();
  if (!secret) return null;
  return `${appOrigin()}/book/${bookingToken(secret, candidateId, now, "interview")}`;
}

// The link {{interview_link}} becomes for one candidate, or "" with the reason
// when there is none to give, so a message shows a gap instead of a dead link.
export async function interviewLinkFor(candidateId: string, ownerId: string, now = new Date()): Promise<{ link: string; reason: string | null }> {
  const candidate = await db.candidate.findFirst({
    where: { id: candidateId, role: { userId: ownerId } },
    select: {
      id: true, roleId: true, stage: true,
      role: { select: { id: true, status: true, client: true, clientReviewFirst: true, interviewWindows: true, interviewTimezone: true, interviewDurationMins: true } },
      person: { select: { doNotContact: true } },
      shortlistItems: { where: { shortlist: { kind: "role" } }, select: { candidateId: true, consentAt: true, decision: true }, take: 1 },
    },
  });
  if (!candidate) return { link: "", reason: "candidate_closed" };
  const offer = await currentOffer(candidate.id, ownerId, clientKey(candidate.role.client, candidate.role.id), now);
  const state = interviewLinkState({ role: candidate.role, candidate, person: candidate.person, item: candidate.shortlistItems[0] ?? null, offered: Boolean(offer?.open.length) });
  if (!state.ok) return { link: "", reason: state.reason };
  return { link: interviewLink(candidate.id, now) ?? "", reason: null };
}

// Free start times for a client interview: the role's hours, from a day's
// notice to three weeks ahead, less anything booked with the same client.
export async function interviewSlots(ownerId: string, role: RoleHours, now = new Date()) {
  if (!hasInterviewHours(role)) return [];
  const key = clientKey(role.client, role.id);
  const horizonEnd = new Date(now.getTime() + (INTERVIEW_HORIZON_DAYS + 1) * 86_400_000);
  const booked = await db.booking.findMany({
    where: { userId: ownerId, kind: "interview", status: "booked", endsAt: { gt: now }, startsAt: { lt: horizonEnd } },
    select: { startsAt: true, endsAt: true, candidate: { select: { role: { select: { id: true, client: true } } } } },
  });
  return availableSlots({
    windows: parseWindows(role.interviewWindows),
    timeZone: role.interviewTimezone!,
    durationMins: role.interviewDurationMins!,
    minNoticeHours: INTERVIEW_NOTICE_HOURS,
    horizonDays: INTERVIEW_HORIZON_DAYS,
    now,
    busy: booked
      .filter((booking) => clientKey(booking.candidate.role.client, booking.candidate.role.id) === key)
      .map((booking) => ({ start: booking.startsAt.getTime(), end: booking.endsAt.getTime() })),
  });
}

// Where the interview happens: a meeting link, or an address in words.
export function interviewPlace(location: string | null): { url: string | null; text: string | null } {
  const value = (location ?? "").trim();
  if (!value) return { url: null, text: null };
  return /^https:\/\//i.test(value) ? { url: value, text: null } : { url: null, text: value };
}
