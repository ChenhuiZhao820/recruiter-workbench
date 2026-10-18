"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWritableFeature } from "@/lib/feature-access";
import type { FormState } from "@/lib/formState";
import { ensureCandidatePerson } from "@/lib/people";
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
