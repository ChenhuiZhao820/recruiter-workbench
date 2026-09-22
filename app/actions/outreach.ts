"use server";

import { db } from "@/lib/db";
import { requireWritableWorkspace } from "@/lib/workspace";
import { normalizeMessage } from "@/lib/render";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
  // Only ever a path inside this app, never something the form could point
  // anywhere it liked.
  if (/^\/roles\/[A-Za-z0-9_-]+\/outreach\?[^\s"'<>]*$/.test(next)) redirect(next);
}
