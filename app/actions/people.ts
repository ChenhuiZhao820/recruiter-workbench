"use server";

import { db } from "@/lib/db";
import { requireWritableFeature } from "@/lib/feature-access";
import { suppressionHashes } from "@/lib/person-keys.mjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function revalidatePeople(personId?: string) {
  revalidatePath("/people");
  if (personId) revalidatePath(`/people/${personId}`);
  revalidatePath("/followups");
  revalidatePath("/");
}

export async function setDoNotContact(formData: FormData) {
  const user = await requireWritableFeature("privacy");
  const id = String(formData.get("id") ?? "");
  const value = formData.get("value") === "true";
  if (!id) return;
  const updated = await db.person.updateMany({ where: { id, userId: user.id }, data: { doNotContact: value } });
  if (updated.count === 0) return;
  await db.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: value ? "person.do_not_contact" : "person.contact_allowed" } });
  revalidatePeople(id);
  const roles = await db.candidate.findMany({ where: { personId: id, role: { userId: user.id } }, select: { roleId: true } });
  for (const { roleId } of roles) revalidatePath(`/roles/${roleId}`);
}

// Erasure. The person, every candidacy, screening, booking and message log
// goes; what stays is a hash of each identifier, so the same profile saved
// again is recognised as someone who was removed. The audit event records
// that an erasure happened, not who it was.
export async function deletePerson(formData: FormData) {
  const user = await requireWritableFeature("privacy");
  const id = String(formData.get("id") ?? "");
  if (String(formData.get("confirm") ?? "") !== "DELETE") return;
  const person = await db.person.findFirst({
    where: { id, userId: user.id },
    select: { id: true, profileUrl: true, memberId: true, email: true, candidates: { select: { roleId: true, profileUrl: true, memberId: true } } },
  });
  if (!person) return;

  const hashes = Array.from(new Set<string>([
    ...suppressionHashes(person),
    ...person.candidates.flatMap((candidate) => suppressionHashes(candidate)),
  ]));
  await db.$transaction(async (tx) => {
    for (const keyHash of hashes) {
      await tx.suppression.upsert({
        where: { userId_keyHash: { userId: user.id, keyHash } },
        update: {},
        create: { userId: user.id, keyHash },
      });
    }
    await tx.person.delete({ where: { id: person.id } });
    await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "person.erased" } });
  });

  for (const { roleId } of person.candidates) revalidatePath(`/roles/${roleId}`);
  revalidatePeople();
  redirect("/people?deleted=1");
}
