"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWritableFeature } from "@/lib/feature-access";
import type { FormState } from "@/lib/formState";
import { recordUsage } from "@/lib/usage";
import { ensureCandidatePerson } from "@/lib/people";
import { putOnRoleShortlist } from "@/lib/shortlists";

async function ownedConfirmedScreening(screeningId: string, ownerId: string) {
  return db.screening.findFirst({
    where: { id: screeningId, status: "confirmed", candidate: { role: { userId: ownerId } } },
    include: { candidate: { select: { id: true, roleId: true, personId: true, stage: true, submittedAt: true, role: { select: { id: true, title: true, client: true } } } } },
  });
}

function revalidate(candidateId: string, roleId: string, personId: string | null) {
  revalidatePath(`/candidates/${candidateId}/screening`);
  revalidatePath(`/roles/${roleId}`);
  if (personId) revalidatePath(`/people/${personId}`);
  revalidatePath("/followups");
  revalidatePath("/");
}

// Agreement often comes after the call, by message. Recording it here is the
// recruiter's statement that the candidate said yes to this client.
export async function recordRepresentConsent(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("clientEmail");
  const screening = await ownedConfirmedScreening(String(formData.get("screeningId") ?? ""), user.id);
  if (!screening) return { error: "That screening could not be found." };
  if (formData.get("agreed") !== "on") return { error: "Tick the box to confirm they agreed to be put forward." };
  await db.screening.updateMany({
    where: { id: screening.id, representConsentAt: null },
    data: { representConsentAt: new Date() },
  });
  revalidate(screening.candidate.id, screening.candidate.roleId, screening.candidate.personId);
  return {};
}

// The recruiter sent it from their own email. Capture records when, never to
// whom or what it said, and moves the candidate to Submitted - which also puts
// them on the role's client link, so the two can never disagree.
export async function markClientEmailSent(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("clientEmail");
  const screening = await ownedConfirmedScreening(String(formData.get("screeningId") ?? ""), user.id);
  if (!screening) return { error: "That screening could not be found." };
  if (!screening.representConsentAt) return { error: "Record that they agreed to be put forward before sending their details." };
  const now = new Date();
  const personId = await ensureCandidatePerson(screening.candidate.id, user.id);
  const marked = await db.$transaction(async (tx) => {
    const { count } = await tx.screening.updateMany({
      where: { id: screening.id, clientEmailSentAt: null },
      data: { clientEmailSentAt: now },
    });
    if (count !== 1) return false;
    if (personId) {
      await putOnRoleShortlist(tx, {
        ownerId: user.id,
        role: screening.candidate.role,
        candidate: screening.candidate,
        personId,
        consentAt: screening.representConsentAt!,
        now,
      });
    }
    await recordUsage(tx, user.id, "client_email_sent");
    return true;
  });
  revalidate(screening.candidate.id, screening.candidate.roleId, screening.candidate.personId);
  if (!marked) return { notice: "Already marked as sent." };
  return {};
}
