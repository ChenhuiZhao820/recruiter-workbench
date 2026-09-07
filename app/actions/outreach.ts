"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

// Stages that already say more than "I have messaged this person". Sending
// another message chases them; it does not undo what they told us, so these
// are left alone. Anything earlier becomes "contacted".
const STAGES_SENDING_DOES_NOT_CHANGE = new Set([
  "booking_pending",
  "booked",
  "rejected",
  "placed",
]);

// Stages where a message is a follow-up to one we already sent, so it counts
// towards the nudge history the follow-up guard reads.
const STAGES_WHERE_SENDING_IS_A_NUDGE = new Set(["contacted", "booking_pending"]);

// The recruiter clicks this after pasting and sending the message themselves
// on LinkedIn. It only updates our own records. Nothing is sent from here.
export async function markAsSent(formData: FormData) {
  const candidateId = String(formData.get("candidateId") ?? "");
  const templateId = String(formData.get("templateId") ?? "").trim() || null;
  const renderedBody = String(formData.get("renderedBody") ?? "");
  if (!candidateId || !renderedBody) return;

  const candidate = await db.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate) return;

  await db.outreachLog.create({
    data: { candidateId, templateId, renderedBody },
  });

  const now = new Date();
  const stage = STAGES_SENDING_DOES_NOT_CHANGE.has(candidate.stage)
    ? candidate.stage
    : "contacted";
  const isNudge = STAGES_WHERE_SENDING_IS_A_NUDGE.has(candidate.stage);

  await db.candidate.update({
    where: { id: candidateId },
    data: {
      stage,
      lastActivityAt: now,
      ...(isNudge ? { lastNudgeAt: now, nudgeCount: { increment: 1 } } : {}),
    },
  });

  revalidatePath(`/roles/${candidate.roleId}`);
  revalidatePath("/followups");
  revalidatePath("/");
}
