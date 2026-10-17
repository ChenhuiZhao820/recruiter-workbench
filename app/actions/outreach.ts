"use server";

import { db } from "@/lib/db";
import { requireWritableWorkspace } from "@/lib/workspace";
import { requireWritableFeature } from "@/lib/feature-access";
import { normalizeMessage } from "@/lib/render";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { utcDayStart } from "@/lib/outreach-log";

// Stages that already say more than "I have messaged this person". Sending
// another message chases them; it does not undo what they told us, so these
// are left alone. Anything earlier becomes "contacted".
const STAGES_SENDING_DOES_NOT_CHANGE = new Set([
  "booking_pending",
  "booked",
  "screened",
  "submitted",
  "rejected",
  "placed",
]);

// Stages where a message is a follow-up to one we already sent, so it counts
// towards the nudge history the follow-up guard reads.
const STAGES_WHERE_SENDING_IS_A_NUDGE = new Set(["contacted", "booking_pending"]);

// Recording one send, for whichever screen the recruiter did it from. The
// single-candidate page and the guided queue share this so that "contacted"
// cannot come to mean two different things depending on the route taken.
// Returns the role the candidate belongs to, or null when there is nothing to
// record: an unknown candidate, somebody else's, or an empty message.
async function recordSend(
  userId: string,
  candidateId: string,
  templateId: string | null,
  body: string
): Promise<string | null> {
  // The body arrives from the page rather than from the template, so it is
  // tidied here too: the record of what was sent should read like what was sent.
  const renderedBody = normalizeMessage(body);
  if (!candidateId || !renderedBody) return null;

  const roleId = await db.$transaction(async (tx) => {
    const candidate = await tx.candidate.findUnique({ where: { id: candidateId, role: { userId } } });
    if (!candidate) return null;

    // Copy the kind off the template now: the log has to stay meaningful even
    // if the template is later edited or deleted.
    const template = templateId
      ? await tx.messageTemplate.findUnique({ where: { id: templateId, userId }, select: { kind: true } })
      : null;
    if (templateId && !template) return null;
    const kind = template?.kind ?? "message";

    // The same text already recorded for them today is the same message: a
    // second click records nothing more and does not count as another nudge.
    const already = await tx.outreachLog.findFirst({
      where: { candidateId, renderedBody, sentAt: { gte: utcDayStart(new Date()) } },
      select: { id: true },
    });
    if (already) return candidate.roleId;

    await tx.outreachLog.create({
      data: {
        candidate: { connect: { id: candidateId, role: { userId } } },
        ...(templateId ? { template: { connect: { id: templateId, userId } } } : {}),
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
      where: { id: candidateId, role: { userId } },
      data: {
        stage,
        lastActivityAt: now,
        ...(isNudge ? { lastNudgeAt: now, nudgeCount: { increment: 1 } } : {}),
      },
    });
    return candidate.roleId;
  });
  if (!roleId) return null;

  revalidatePath(`/roles/${roleId}`);
  revalidatePath("/followups");
  revalidatePath("/");
  return roleId;
}

// The recruiter clicks this after pasting and sending the message themselves
// on LinkedIn. It only updates our own records. Nothing is sent from here.
export async function markAsSent(formData: FormData) {
  const user = await requireWritableWorkspace();
  await recordSend(
    user.id,
    String(formData.get("candidateId") ?? ""),
    String(formData.get("templateId") ?? "").trim() || null,
    String(formData.get("renderedBody") ?? "")
  );
}

// The same click, from the guided queue, which then moves to the next person.
// Advancing is all this adds: the message was still sent by the recruiter, by
// hand, in LinkedIn, before they pressed it.
export async function markSentAndAdvance(formData: FormData) {
  const user = await requireWritableWorkspace();
  const next = String(formData.get("next") ?? "");
  await recordSend(
    user.id,
    String(formData.get("candidateId") ?? ""),
    String(formData.get("templateId") ?? "").trim() || null,
    String(formData.get("renderedBody") ?? "")
  );
  if (isQueuePath(next)) redirect(next);
}

// Only ever a path to one of this app's own queues - a role's outreach run or
// the follow-up run - never something the form could point anywhere it liked.
function isQueuePath(path: string) {
  return /^\/roles\/[A-Za-z0-9_-]+\/outreach\?[^\s"'<>]*$/.test(path) || /^\/followups\/run\?[^\s"'<>]*$/.test(path);
}

// What a follow-up run can settle without a message: they replied, said yes,
// booked, or are not going ahead. The stage changes and the run moves on.
const RUN_OUTCOMES = new Set(["replied", "booking_pending", "booked", "rejected"]);

export async function setStageAndAdvance(formData: FormData) {
  const user = await requireWritableFeature("followUpRuns");
  const candidateId = String(formData.get("candidateId") ?? "");
  const stage = String(formData.get("stage") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!candidateId || !RUN_OUTCOMES.has(stage)) return;
  const updated = await db.candidate.updateMany({
    where: { id: candidateId, role: { userId: user.id } },
    data: { stage, lastActivityAt: new Date() },
  });
  if (updated.count !== 1) return;
  const candidate = await db.candidate.findUnique({ where: { id: candidateId }, select: { roleId: true } });
  if (candidate) revalidatePath(`/roles/${candidate.roleId}`);
  revalidatePath("/followups");
  revalidatePath("/");
  if (isQueuePath(next)) redirect(next);
}
