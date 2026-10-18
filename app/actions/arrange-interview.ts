"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWritableFeature } from "@/lib/feature-access";
import type { FormState } from "@/lib/formState";
import { putOnRoleShortlist } from "@/lib/shortlists";
import { clientBusy, loadArrangement, type Arrangement } from "@/lib/arrange";
import { MAX_OFFER_TIMES, readArrangement, readOfferTimes, readSetTime } from "@/lib/arrange-core.mjs";
import { recordUsage } from "@/lib/usage";

// Arranging a client interview by hand, from /candidates/[id]/interview: the
// recruiter sets the time they agreed with both sides, or offers the candidate
// a few times to choose from. Neither needs the role's weekly interview hours.
// Both put the candidate on the role's client link first if they are not on it
// yet - with the consent Capture already has for this client, or the tick on
// the form - and carry over the client's answer from a custom shortlist, so the
// client's page and Follow-ups agree with what was arranged.

class Clash extends Error {}

const BEFORE_INTERVIEW = ["sourced", "contacted", "replied", "booking_pending", "booked", "screened", "submitted"];

function revalidate(arrangement: Arrangement) {
  revalidatePath(`/candidates/${arrangement.candidate.id}/interview`);
  revalidatePath(`/roles/${arrangement.candidate.role.id}`);
  revalidatePath("/followups");
  revalidatePath("/notifications");
  if (arrangement.candidate.personId) revalidatePath(`/people/${arrangement.candidate.personId}`);
}

// Checks shared by both ways of arranging. Returns the consent to record, or
// the reason nothing can be arranged.
function ready(arrangement: Arrangement | null, formData: FormData, now: Date): { error: string } | { consentAt: Date } {
  if (!arrangement) return { error: "That candidate could not be found." };
  if (arrangement.blocked) return { error: arrangement.blocked };
  if (arrangement.booking) return { error: "An interview is already booked. Cancel it first to arrange another." };
  const consentAt = arrangement.consentAt ?? (formData.get("agreed") === "on" ? now : null);
  if (!consentAt) {
    const client = arrangement.candidate.role.client;
    return { error: `Tick that ${arrangement.candidate.fullName} agreed to be put forward${client ? ` to ${client}` : ""}.` };
  }
  return { consentAt };
}

// Puts them on the role's link (if they are not there) and brings a custom
// shortlist's Interview answer across, inside the caller's transaction.
async function onRoleLink(tx: Prisma.TransactionClient, ownerId: string, arrangement: Arrangement, consentAt: Date, now: Date) {
  const { candidate, customAnswer } = arrangement;
  const { shortlistId } = await putOnRoleShortlist(tx, { ownerId, role: candidate.role, candidate, personId: candidate.personId!, consentAt, now });
  if (customAnswer) {
    await tx.shortlistItem.updateMany({
      where: { shortlistId, personId: candidate.personId!, OR: [{ decisionAt: null }, { decisionAt: { lt: customAnswer.decisionAt ?? now } }] },
      data: { decision: "interview", decisionReason: null, decisionNote: null, decisionAt: customAnswer.decisionAt ?? now, decisionAccessId: customAnswer.decisionAccessId },
    });
  }
}

// The time the recruiter agreed with the client and the candidate.
export async function setInterviewTime(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("clientShortlists");
  const now = new Date();
  const arrangement = await loadArrangement(String(formData.get("candidateId") ?? ""), user.id, now);
  const check = ready(arrangement, formData, now);
  if ("error" in check) return check;
  const a = arrangement!;
  const common = readArrangement({ timeZone: formData.get("timeZone"), durationMins: formData.get("durationMins"), location: formData.get("location") });
  if (common.error) return { error: common.error };
  const { timeZone, durationMins, url, place } = common.data!;
  const when = readSetTime({ date: formData.get("date"), time: formData.get("time"), timeZone }, now);
  if (when.error) return { error: when.error };
  const start = new Date(when.at!);
  const end = new Date(when.at! + durationMins * 60_000);

  try {
    await db.$transaction(async (tx) => {
      const busy = await clientBusy(tx, user.id, a.key, now);
      if (busy.some((b) => start.getTime() < b.end && end.getTime() > b.start)) throw new Clash();
      await onRoleLink(tx, user.id, a, check.consentAt, now);
      const booking = await tx.booking.create({
        data: {
          candidateId: a.candidate.id, userId: user.id, kind: "interview", startsAt: start, endsAt: end,
          mode: url ? "video" : "in_person", meetingUrl: url, place, timeZone, phone: null,
          // Arranged by the recruiter: there is no form the candidate filled in.
          email: a.candidate.person?.email ?? "", consentAt: check.consentAt, noticeVersion: "arranged",
        },
      });
      await tx.interviewSlot.create({ data: { userId: user.id, clientKey: a.key, startsAt: start, bookingId: booking.id } });
      // A time is set, so any times offered before are no longer on offer.
      await tx.interviewOffer.updateMany({ where: { candidateId: a.candidate.id, withdrawnAt: null, bookingId: null }, data: { withdrawnAt: now } });
      await tx.candidate.update({ where: { id: a.candidate.id }, data: { lastActivityAt: now, ...(BEFORE_INTERVIEW.includes(a.candidate.stage) ? { stage: "interview" } : {}) } });
      await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "interview.arranged" } });
      await recordUsage(tx, user.id, "interview_arranged");
    });
  } catch (error) {
    if (error instanceof Clash || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      return { error: `Another interview with ${a.candidate.role.client || "this client"} overlaps that time.` };
    }
    throw error;
  }
  revalidate(a);
  redirect(`/candidates/${a.candidate.id}/interview`);
}

// Two or three times for the candidate to choose from, through their
// interview link. A new offer replaces an open one.
export async function offerInterviewTimes(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("clientShortlists");
  const now = new Date();
  const arrangement = await loadArrangement(String(formData.get("candidateId") ?? ""), user.id, now);
  const check = ready(arrangement, formData, now);
  if ("error" in check) return check;
  const a = arrangement!;
  const common = readArrangement({ timeZone: formData.get("timeZone"), durationMins: formData.get("durationMins"), location: formData.get("location") });
  if (common.error) return { error: common.error };
  const { timeZone, durationMins, url, place } = common.data!;
  const rows = Array.from({ length: MAX_OFFER_TIMES }, (_, index) => ({ date: formData.get(`date-${index}`), time: formData.get(`time-${index}`) }));
  const read = readOfferTimes(rows, timeZone, now);
  if (read.error) return { error: read.error };
  const busy = await clientBusy(db, user.id, a.key, now);
  const clashing = read.times!.filter((start) => busy.some((b) => start < b.end && start + durationMins * 60_000 > b.start));
  if (clashing.length) return { error: `${clashing.length === 1 ? "One of those times overlaps" : "Some of those times overlap"} another interview with ${a.candidate.role.client || "this client"}.` };

  await db.$transaction(async (tx) => {
    await onRoleLink(tx, user.id, a, check.consentAt, now);
    await tx.interviewOffer.updateMany({ where: { candidateId: a.candidate.id, withdrawnAt: null, bookingId: null }, data: { withdrawnAt: now } });
    await tx.interviewOffer.create({
      data: { userId: user.id, candidateId: a.candidate.id, times: JSON.stringify(read.times), durationMins, timeZone, location: url ?? place },
    });
    await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "interview.offered" } });
    await recordUsage(tx, user.id, "interview_offered");
  });
  revalidate(a);
  redirect(`/candidates/${a.candidate.id}/interview`);
}

// Takes the offered times back: the candidate's link stops offering them.
export async function withdrawInterviewOffer(formData: FormData) {
  const user = await requireWritableFeature("clientShortlists");
  const candidateId = String(formData.get("candidateId") ?? "");
  const { count } = await db.interviewOffer.updateMany({
    where: { candidateId, userId: user.id, withdrawnAt: null, bookingId: null, candidate: { role: { userId: user.id } } },
    data: { withdrawnAt: new Date() },
  });
  if (count) revalidatePath(`/candidates/${candidateId}/interview`);
}
