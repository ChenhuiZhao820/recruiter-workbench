"use server";

import { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertSameOrigin, takeAuthAttempt } from "@/lib/auth";
import { normalizeEmail, validEmail } from "@/lib/auth-crypto";
import type { FormState } from "@/lib/formState";
import { ensureCandidatePerson } from "@/lib/people";
import { loadBookingContext, privacyNoticeText } from "@/lib/booking";
import { interviewPlace, interviewSlots } from "@/lib/interviews";
import { GATE_COOKIE, loadClientPage } from "@/lib/shortlists";
import { noticeVersion } from "@/lib/booking-core.mjs";
import { clientKey, interviewLinkState } from "@/lib/shortlist-core.mjs";
import { recordUsage } from "@/lib/usage";

// Booking and cancelling client interviews. Both are public, with no session:
// the candidate's signed interview link, or the client's signed page, is the
// only authority, and everything else is read again rather than trusted.

class SlotTakenError extends Error {}

// Stages an interview moves on from; rejected and placed are never booked.
const BEFORE_INTERVIEW = ["sourced", "contacted", "replied", "booking_pending", "booked", "screened", "submitted"];

export async function bookInterview(_prev: FormState, formData: FormData): Promise<FormState> {
  assertSameOrigin();
  const token = String(formData.get("token") ?? "");
  const now = new Date();
  const context = await loadBookingContext(token, now);
  if (!context || context.read.kind !== "interview") return { error: "This interview link has expired or is not valid. Ask for a new one." };
  const { candidate, owner, settings } = context;
  const who = settings.recruiterName || owner.name;
  const state = interviewLinkState({ role: candidate.role, candidate: { ...candidate, roleId: candidate.role.id }, person: candidate.person, item: candidate.shortlistItems[0] ?? null });
  if (!state.ok) return { error: `This interview link is no longer active. Reply to ${who} to arrange a time.` };
  if (context.booking) return { error: "You already have an interview booked." };
  if (!(await takeAuthAttempt(`interview:${candidate.id}`, 10, 3600)) || !(await takeAuthAttempt(`interview-owner:${owner.id}`, 120, 3600))) {
    return { error: "Too many attempts. Wait a while and try again." };
  }
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!validEmail(email)) return { error: "Enter your email address, so the interview can be confirmed." };
  if (formData.get("consent") !== "on") return { error: "Tick the box to confirm you have read how your details are used." };

  const startsAt = Number(formData.get("slot"));
  const free = await interviewSlots(owner.id, candidate.role, now);
  if (!Number.isInteger(startsAt) || !free.includes(startsAt)) return { error: "That time is no longer free. Choose another." };
  const start = new Date(startsAt);
  const end = new Date(startsAt + candidate.role.interviewDurationMins! * 60_000);
  const personId = await ensureCandidatePerson(candidate.id, owner.id);
  if (!personId) return { error: "This interview link is no longer active." };
  const key = clientKey(candidate.role.client, candidate.role.id);
  const place = interviewPlace(candidate.role.interviewLocation);
  const notice = privacyNoticeText(settings, owner.email);

  try {
    await db.$transaction(async (tx) => {
      // Anything already booked with this client that overlaps, on any of its roles.
      const overlapping = await tx.booking.findMany({
        where: { userId: owner.id, kind: "interview", status: "booked", startsAt: { lt: end }, endsAt: { gt: start } },
        select: { candidate: { select: { role: { select: { id: true, client: true } } } } },
      });
      if (overlapping.some((booking) => clientKey(booking.candidate.role.client, booking.candidate.role.id) === key)) throw new SlotTakenError();
      const booking = await tx.booking.create({
        data: {
          candidateId: candidate.id,
          userId: owner.id,
          kind: "interview",
          startsAt: start,
          endsAt: end,
          mode: place.url ? "video" : "in_person",
          meetingUrl: place.url,
          phone: null,
          email,
          consentAt: now,
          noticeVersion: noticeVersion(notice),
        },
      });
      // The key on (owner, client, start) refuses a second interview with
      // this client at the same time even if two requests pass the check above.
      await tx.interviewSlot.create({ data: { userId: owner.id, clientKey: key, startsAt: start, bookingId: booking.id } });
      await tx.person.update({ where: { id: personId }, data: { email, emailSource: "booking", lastContactAt: now } });
      await tx.candidate.update({
        where: { id: candidate.id },
        data: { lastActivityAt: now, ...(BEFORE_INTERVIEW.includes(candidate.stage) ? { stage: "interview" } : {}) },
      });
      await tx.auditEvent.create({ data: { actorId: owner.id, targetUserId: owner.id, action: "booking.created" } });
      await recordUsage(tx, owner.id, "interview_booked");
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

// The client cannot make an interview booked from their page. It is
// cancelled, the time is free again, the candidate goes back to Submitted,
// and they come back to the recruiter's "Client wants to meet" to rebook.
export async function clientCannotMakeIt(_prev: FormState, formData: FormData): Promise<FormState> {
  assertSameOrigin();
  const token = String(formData.get("token") ?? "");
  const now = new Date();
  const page = await loadClientPage(token, now, cookies().get(GATE_COOKIE)?.value);
  if (page.state !== "active") return { error: "This link is no longer active. Ask the recruiter who sent it for a new one." };
  const bookingId = String(formData.get("bookingId") ?? "");
  const interview = page.view.interviews.find((entry) => entry.bookingId === bookingId);
  if (!interview) return { error: "That interview is no longer booked." };
  if (!(await takeAuthAttempt(`shortlist-decide:${page.accessId}`, 60, 3600))) return { error: "Too many changes in a short time. Wait a while and try again." };
  await db.$transaction(async (tx) => {
    const { count } = await tx.booking.updateMany({ where: { id: bookingId, userId: page.ownerId, kind: "interview", status: "booked" }, data: { status: "cancelled" } });
    if (count !== 1) return;
    await tx.interviewSlot.deleteMany({ where: { bookingId } });
    await tx.candidate.updateMany({ where: { id: interview.candidateId, stage: "interview" }, data: { stage: "submitted", lastActivityAt: now } });
    // A fresh date on their "interview" answer puts them back in front of
    // the recruiter under "Client wants to meet".
    await tx.shortlistItem.updateMany({ where: { id: interview.itemId, decision: "interview" }, data: { decisionAt: now } });
    await tx.auditEvent.create({ data: { actorId: page.ownerId, targetUserId: page.ownerId, action: "booking.cancelled" } });
  });
  if (page.roleId) revalidatePath(`/roles/${page.roleId}`);
  revalidatePath("/followups");
  redirect(`/s/${token}`);
}
