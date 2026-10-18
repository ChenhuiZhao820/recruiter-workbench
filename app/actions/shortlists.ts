"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWritableFeature } from "@/lib/feature-access";
import type { FormState } from "@/lib/formState";
import { ensureCandidatePerson } from "@/lib/people";
import { clientKey } from "@/lib/shortlist-core.mjs";
import { CLOSED_STAGES, consentPersonSelect, ensureRoleShortlist, knownConsentAt, putOnRoleShortlist, replaceLinks } from "@/lib/shortlists";

// A role's client link: putting someone on it, taking them off, and closing
// or replacing the link. Every id is looked up under the signed-in owner; the
// page is trusted for nothing but which button was pressed.

function revalidateRole(roleId: string, personId: string | null) {
  revalidatePath(`/roles/${roleId}`);
  if (personId) revalidatePath(`/people/${personId}`);
  revalidatePath("/followups");
  revalidatePath("/");
}

export async function putForward(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("clientShortlists");
  const candidateId = String(formData.get("candidateId") ?? "");
  const found = await db.candidate.findFirst({
    where: { id: candidateId, role: { userId: user.id } },
    select: { id: true, stage: true, submittedAt: true, personId: true, role: { select: { id: true, title: true, client: true, status: true } } },
  });
  if (!found) return { error: "That candidate could not be found." };
  if (found.role.status !== "open") return { error: "This role is closed. Reopen it to put anyone forward." };
  if (CLOSED_STAGES.includes(found.stage)) return { error: "Rejected and placed candidates are not put forward." };
  const personId = await ensureCandidatePerson(found.id, user.id);
  if (!personId) return { error: "That candidate could not be found." };
  const person = await db.person.findFirst({ where: { id: personId, userId: user.id }, select: consentPersonSelect });
  if (!person) return { error: "That candidate could not be found." };
  if (person.doNotContact) return { error: "This person is marked do not contact, so they are not put forward." };

  // Consent Capture already knows is used as it is; otherwise the recruiter
  // states it here, and that statement is what is recorded.
  const now = new Date();
  const known = knownConsentAt(person, found.id, found.role.client);
  if (!known && formData.get("agreed") !== "on") {
    return { error: `Tick the box to confirm they agreed to be put forward${found.role.client ? ` to ${found.role.client}` : ""}.` };
  }
  await db.$transaction(async (tx) => {
    const { added } = await putOnRoleShortlist(tx, { ownerId: user.id, role: found.role, candidate: found, personId, consentAt: known ?? now, now });
    if (added) await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "shortlist.put_forward" } });
  });
  revalidateRole(found.role.id, personId);
  return {};
}

// A client answered about someone on a custom shortlist, and that person is
// also a candidate on a role for the same client. The recruiter brings the
// answer onto the role: the person goes on the role's client link with the
// consent the shortlist recorded, and the answer comes with them, so the row,
// Follow-ups and {{interview_link}} all see it. Nothing happens on its own.
export async function adoptShortlistAnswer(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("clientShortlists");
  const candidate = await db.candidate.findFirst({
    where: { id: String(formData.get("candidateId") ?? ""), role: { userId: user.id } },
    select: { id: true, stage: true, submittedAt: true, personId: true, role: { select: { id: true, title: true, client: true, status: true } } },
  });
  if (!candidate?.personId) return { error: "That candidate could not be found." };
  const item = await db.shortlistItem.findFirst({
    where: { id: String(formData.get("itemId") ?? ""), personId: candidate.personId, decision: { not: null }, shortlist: { userId: user.id, kind: "custom" } },
    select: { decision: true, decisionReason: true, decisionNote: true, decisionAt: true, decisionAccessId: true, consentAt: true, shortlist: { select: { client: true } } },
  });
  if (!item) return { error: "That answer could not be found." };
  if (clientKey(item.shortlist.client, "") !== clientKey(candidate.role.client, candidate.role.id)) return { error: "That answer was for another client." };
  if (candidate.role.status !== "open") return { error: "This role is closed. Reopen it to put anyone forward." };
  if (CLOSED_STAGES.includes(candidate.stage)) return { error: "Rejected and placed candidates are not put forward." };
  const person = await db.person.findFirst({ where: { id: candidate.personId, userId: user.id }, select: { doNotContact: true } });
  if (!person || person.doNotContact) return { error: "This person is marked do not contact, so they are not put forward." };

  const now = new Date();
  await db.$transaction(async (tx) => {
    const { shortlistId } = await putOnRoleShortlist(tx, { ownerId: user.id, role: candidate.role, candidate, personId: candidate.personId!, consentAt: item.consentAt ?? now, now });
    // A later answer already on the role's own link is the one that stands.
    await tx.shortlistItem.updateMany({
      where: { shortlistId, personId: candidate.personId!, OR: [{ decisionAt: null }, { decisionAt: { lt: item.decisionAt ?? now } }] },
      data: { decision: item.decision, decisionReason: item.decisionReason, decisionNote: item.decisionNote, decisionAt: item.decisionAt ?? now, decisionAccessId: item.decisionAccessId },
    });
    await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "shortlist.answer_adopted" } });
  });
  revalidateRole(candidate.role.id, candidate.personId);
  revalidatePath("/activity");
  return {};
}

export async function takeOffClientLink(formData: FormData) {
  const user = await requireWritableFeature("clientShortlists");
  const item = await db.shortlistItem.findFirst({
    where: { id: String(formData.get("itemId") ?? ""), shortlist: { userId: user.id, kind: "role" } },
    select: { id: true, personId: true, shortlist: { select: { roleId: true } } },
  });
  if (!item) return;
  await db.$transaction(async (tx) => {
    await tx.shortlistItem.delete({ where: { id: item.id } });
    await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "shortlist.taken_off" } });
  });
  revalidateRole(item.shortlist.roleId!, item.personId);
}

async function ownedRole(roleId: string, ownerId: string) {
  return db.role.findFirst({ where: { id: roleId, userId: ownerId }, select: { id: true, title: true, client: true } });
}

// Closes the role's link for good: the address stops working at once.
export async function revokeClientLink(formData: FormData) {
  const user = await requireWritableFeature("clientShortlists");
  const role = await ownedRole(String(formData.get("roleId") ?? ""), user.id);
  if (!role) return;
  const now = new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.shortlist.updateMany({ where: { roleId: role.id, userId: user.id, revokedAt: null }, data: { revokedAt: now } });
    if (count) await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "shortlist.revoked" } });
  });
  revalidateRole(role.id, null);
}

// A new address for the same page. The old one stops working, and a closed
// link opens again under the new address with the same people on it.
export async function newClientLink(formData: FormData) {
  const user = await requireWritableFeature("clientShortlists");
  const role = await ownedRole(String(formData.get("roleId") ?? ""), user.id);
  if (!role) return;
  await db.$transaction(async (tx) => {
    const shortlist = await ensureRoleShortlist(tx, user.id, role);
    await tx.shortlist.update({ where: { id: shortlist.id }, data: { revokedAt: null } });
    await replaceLinks(tx, shortlist);
    await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "shortlist.new_link" } });
  });
  revalidateRole(role.id, null);
}
