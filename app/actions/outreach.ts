"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

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
  // A message to someone already contacted (and not yet replied) is a nudge.
  const isNudge = candidate.stage === "contacted";
  await db.candidate.update({
    where: { id: candidateId },
    data: {
      stage: "contacted",
      lastActivityAt: now,
      ...(isNudge ? { lastNudgeAt: now, nudgeCount: { increment: 1 } } : {}),
    },
  });

  revalidatePath(`/roles/${candidate.roleId}`);
  revalidatePath("/followups");
  revalidatePath("/");
}
