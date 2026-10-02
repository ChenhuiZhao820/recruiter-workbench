"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertSameOrigin, takeAuthAttempt } from "@/lib/auth";
import { normalizeEmail, validEmail } from "@/lib/auth-crypto";
import { requireWritableFeature } from "@/lib/feature-access";
import type { FormState } from "@/lib/formState";
import { ensureCandidatePerson } from "@/lib/people";
import { recordUsage } from "@/lib/usage";
import { BEFORE_BOOKED, bookingReadiness, candidateCanBook, freeSlots, loadBookingContext, privacyNoticeText } from "@/lib/booking";
import { DURATIONS, isTimeZone, noticeVersion, timeToMinutes, validMeetingLink, validPhone } from "@/lib/booking-core.mjs";

function whole(formData: FormData, name: string, min: number, max: number): number | null {
  const value = Number(String(formData.get(name) ?? "").trim());
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

// The recruiter's booking page: when they take calls, for how long, how far
// ahead, and how the call happens. Available on every plan.
export async function updateBookingSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("booking");
  const problems: string[] = [];

  const windows: { day: number; startMin: number; endMin: number }[] = [];
  for (let day = 0; day <= 6; day++) {
    if (formData.get(`day-${day}`) !== "on") continue;
    const startMin = timeToMinutes(formData.get(`start-${day}`));
    const endMin = timeToMinutes(formData.get(`end-${day}`));
    if (startMin === null || endMin === null || startMin >= endMin) problems.push("each ticked day needs a start time before its end time");
    else windows.push({ day, startMin, endMin });
  }
  const timeZone = String(formData.get("bookingTimezone") ?? "").trim();
  if (!isTimeZone(timeZone)) problems.push("choose a time zone from the list");
  const duration = whole(formData, "bookingDurationMins", 1, 240);
  if (duration === null || !DURATIONS.includes(duration)) problems.push("choose a call length");
  const notice = whole(formData, "bookingMinNoticeHours", 0, 336);
  if (notice === null) problems.push("minimum notice is a whole number of hours, 0 to 336");
  const horizon = whole(formData, "bookingHorizonDays", 1, 90);
  if (horizon === null) problems.push("how far ahead is a whole number of days, 1 to 90");
  const meetingLink = validMeetingLink(formData.get("meetingLink"));
  if (meetingLink === null) problems.push("the meeting link must be a full https:// address");
  const privacyContactEmail = normalizeEmail(String(formData.get("privacyContactEmail") ?? ""));
  if (privacyContactEmail && !validEmail(privacyContactEmail)) problems.push("the privacy contact must be an email address");
  if (problems.length) {
    const unique = Array.from(new Set(problems));
    return { error: `Nothing was saved: ${unique.join("; ")}.` };
  }

  const data = {
    bookingWindows: JSON.stringify(windows.sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7))),
    bookingTimezone: timeZone,
    bookingDurationMins: duration!,
    bookingMinNoticeHours: notice!,
    bookingHorizonDays: horizon!,
    meetingLink: meetingLink!,
    offerPhone: formData.get("offerPhone") === "on",
    privacyNotice: String(formData.get("privacyNotice") ?? "").trim().slice(0, 6000),
    privacyContactEmail,
  };
  await db.settings.upsert({ where: { userId: user.id }, update: data, create: { userId: user.id, ...data } });
  revalidatePath("/settings");
  revalidatePath("/settings/booking");
  const readiness = bookingReadiness(data);
  return readiness.ready
    ? { notice: "Booking page saved. {{booking_link}} in a template now becomes each candidate's own link." }
    : { notice: `Saved. Booking links start working once you add ${readiness.missing.join(" and ")}.` };
}

// The public action behind a booking link. No session: the signed link is the
// only authority, and everything else is re-checked here rather than trusted
// from the page: the link, the candidate, the slot still being free.
export async function bookSlot(_prev: FormState, formData: FormData): Promise<FormState> {
  assertSameOrigin();
  const token = String(formData.get("token") ?? "");
  const now = new Date();
  const context = await loadBookingContext(token, now);
  if (!context) return { error: "This booking link has expired or is not valid. Ask for a new one." };
  const { candidate, owner, settings } = context;
  const who = settings.recruiterName || owner.name;
  if (!bookingReadiness(settings).ready || !candidateCanBook(candidate)) return { error: `This booking link is no longer active. Reply to ${who} to arrange a time.` };
  if (context.booking) return { error: "You already have a call booked." };
  if (!await takeAuthAttempt(`book:${candidate.id}`, 10, 3600) || !await takeAuthAttempt(`book-owner:${owner.id}`, 120, 3600)) {
    return { error: "Too many attempts. Wait a while and try again." };
  }

  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!validEmail(email)) return { error: "Enter your email address, so the call can be confirmed." };
  const mode = String(formData.get("mode") ?? (settings.meetingLink ? "video" : "phone"));
  if (mode !== "video" && mode !== "phone") return { error: "Choose how you would like to talk." };
  if (mode === "video" && !settings.meetingLink) return { error: "Choose how you would like to talk." };
  if (mode === "phone" && !settings.offerPhone) return { error: "Choose how you would like to talk." };
  const phone = mode === "phone" ? validPhone(formData.get("phone")) : null;
  if (mode === "phone" && !phone) return { error: "Enter the phone number to call you on, with the country code if you are outside the UK." };
  if (formData.get("consent") !== "on") return { error: "Tick the box to confirm you have read how your details are used." };

  const startsAt = Number(formData.get("slot"));
  const free = await freeSlots(owner.id, settings, now);
  if (!Number.isInteger(startsAt) || !free.includes(startsAt)) return { error: "That time is no longer free. Choose another." };
  const start = new Date(startsAt);
  const end = new Date(startsAt + settings.bookingDurationMins * 60_000);
  const personId = await ensureCandidatePerson(candidate.id, owner.id);
  if (!personId) return { error: "This booking link is no longer active." };
  const keep = formData.get("keep") === "on";
  const notice = privacyNoticeText(settings, owner.email);

  try {
    await db.$transaction(async (tx) => {
      const clash = await tx.booking.count({
        where: { userId: owner.id, status: "booked", startsAt: { lt: end }, endsAt: { gt: start } },
      });
      if (clash > 0) throw new SlotTakenError();
      const booking = await tx.booking.create({
        data: {
          candidateId: candidate.id,
          userId: owner.id,
          startsAt: start,
          endsAt: end,
          mode,
          meetingUrl: mode === "video" ? settings.meetingLink : null,
          phone,
          email,
          consentAt: now,
          noticeVersion: noticeVersion(notice),
        },
      });
      // The primary key on (owner, start) refuses a second booking of the
      // same time even if two requests pass the check above together.
      await tx.bookedSlot.create({ data: { userId: owner.id, startsAt: start, bookingId: booking.id } });
      await tx.person.update({
        where: { id: personId },
        data: { email, emailSource: "booking", ...(keep ? { emailConsentAt: now } : {}), lastContactAt: now },
      });
      await tx.candidate.update({
        where: { id: candidate.id },
        data: { lastActivityAt: now, ...(BEFORE_BOOKED.includes(candidate.stage) ? { stage: "booked" } : {}) },
      });
      await tx.auditEvent.create({ data: { actorId: owner.id, targetUserId: owner.id, action: "booking.created" } });
      await recordUsage(tx, owner.id, "booking_link_used");
    });
  } catch (error) {
    if (error instanceof SlotTakenError || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      return { error: "Someone has just booked that time. Choose another." };
    }
    throw error;
  }
  revalidatePath(`/roles/${candidate.role.id}`);
  revalidatePath("/followups");
  if (candidate.personId) revalidatePath(`/people/${candidate.personId}`);
  redirect(`/book/${token}`);
}

class SlotTakenError extends Error {}

// The recruiter cancels a call. The time is free again and the candidate goes
// back to "booking pending" if the call was what moved them on.
export async function cancelBooking(formData: FormData) {
  const user = await requireWritableFeature("booking");
  const booking = await db.booking.findFirst({
    where: { id: String(formData.get("bookingId") ?? ""), userId: user.id, status: "booked", candidate: { role: { userId: user.id } } },
    include: { candidate: { select: { id: true, roleId: true, personId: true, stage: true } } },
  });
  if (!booking) return;
  await db.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: booking.id }, data: { status: "cancelled" } });
    await tx.bookedSlot.deleteMany({ where: { bookingId: booking.id } });
    if (booking.candidate.stage === "booked") {
      await tx.candidate.update({ where: { id: booking.candidate.id }, data: { stage: "booking_pending", lastActivityAt: new Date() } });
    }
    await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "booking.cancelled" } });
  });
  revalidatePath(`/roles/${booking.candidate.roleId}`);
  revalidatePath("/followups");
  if (booking.candidate.personId) revalidatePath(`/people/${booking.candidate.personId}`);
}
