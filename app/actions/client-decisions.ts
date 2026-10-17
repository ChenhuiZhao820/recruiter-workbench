"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertSameOrigin, takeAuthAttempt } from "@/lib/auth";
import type { FormState } from "@/lib/formState";
import { loadClientPage } from "@/lib/shortlists";
import { parseDecision } from "@/lib/shortlist-core.mjs";
import { recordUsage } from "@/lib/usage";

// The client's answer about one person on their page: interview, or not for
// us with a reason. No session: the signed link is the only authority, and
// everything is read again from it rather than trusted from the page - the
// link, that the person is still on it and visible, that it can still change.
export async function decideShortlistItem(_prev: FormState, formData: FormData): Promise<FormState> {
  assertSameOrigin();
  const token = String(formData.get("token") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const now = new Date();
  const page = await loadClientPage(token, now);
  if (page.state !== "active") return { error: "This link is no longer active. Ask the recruiter who sent it for a new one." };
  const entry = page.view.entries.find((candidate) => candidate.itemId === itemId);
  if (!entry) return { error: "That person is no longer on this page." };
  if (!entry.canDecide) return { error: "An interview is already booked with them. Ask the recruiter to change it." };
  if (!(await takeAuthAttempt(`shortlist-decide:${page.accessId}`, 60, 3600))) return { error: "Too many changes in a short time. Wait a while and try again." };

  const parsed = parseDecision({
    decision: String(formData.get("decision") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (parsed.error) return { error: parsed.error };

  await db.$transaction(async (tx) => {
    const { count } = await tx.shortlistItem.updateMany({
      where: { id: itemId, shortlistId: page.shortlistId },
      data: { ...parsed.data, decisionAt: now, decisionAccessId: page.accessId },
    });
    if (count !== 1) return;
    await tx.auditEvent.create({ data: { actorId: page.ownerId, targetUserId: page.ownerId, action: "shortlist.decision" } });
    await recordUsage(tx, page.ownerId, "client_decision");
  });
  if (page.roleId) revalidatePath(`/roles/${page.roleId}`);
  revalidatePath("/followups");
  redirect(`/s/${token}#entry-${itemId}`);
}
