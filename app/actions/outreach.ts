"use server";

import { db } from "@/lib/db";
import { requireWritableWorkspace } from "@/lib/workspace";
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
  const user = await requireWritableWorkspace();
  const candidateId = String(formData.get("candidateId") ?? "");
  const templateId = String(formData.get("templateId") ?? "").trim() || null;
  const renderedBody = String(formData.get("renderedBody") ?? "");
  if (!candidateId || !renderedBody) return;

  const roleId = await db.$transaction(async (tx) => {
    const candidate = await tx.candidate.findUnique({ where: { id: candidateId, role: { userId: user.id } } });
    if (!candidate) return null;

    // Copy the kind off the template now: the log has to stay meaningful even
    // if the template is later edited or deleted.
    const template = templateId
      ? await tx.messageTemplate.findUnique({ where: { id: templateId, userId: user.id }, select: { kind: true } })
      : null;
    if (templateId && !template) return null;
    const kind = template?.kind ?? "message";

    await tx.outreachLog.create({
      data: {
        candidate: { connect: { id: candidateId, role: { userId: user.id } } },
        ...(templateId ? { template: { connect: { id: templateId, userId: user.id } } } : {}),
        renderedBody,
        kind,
      },
    });

    const now = new Date();
    const stage = STAGES_SENDING_DOES_NOT_CHANGE.has(candidate.stage)
      ? candidate.stage
      : "contacted";
    const isNudge = STAGES_WHERE_SENDING_IS_A_NUDGE.has(candidate.stage);

    await tx.candidate.update({
      where: { id: candidateId, role: { userId: user.id } },
      data: {
        stage,
        lastActivityAt: now,
        ...(isNudge ? { lastNudgeAt: now, nudgeCount: { increment: 1 } } : {}),
      },
    });
    return candidate.roleId;
  });
  if (!roleId) return;

  revalidatePath(`/roles/${roleId}`);
  revalidatePath("/followups");
  revalidatePath("/");
}
