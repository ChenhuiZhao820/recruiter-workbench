"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWritableFeature } from "@/lib/feature-access";
import type { FormState } from "@/lib/formState";
import { ensureCandidatePerson } from "@/lib/people";
import { checkCvUpload } from "@/lib/cv-core.mjs";

// A person's CV: the PDF a client sees in place of the confirmed facts, on
// every client page they are on, from the moment it is saved. One per person;
// a new upload replaces it. An upload must carry the contact-details check,
// whatever the page sent: the client gets the file exactly as it is.

// The person the form names, under the owner: directly, or through a
// candidacy (the dialog on a role page names the candidate).
async function ownedPerson(ownerId: string, formData: FormData) {
  const personId = String(formData.get("personId") ?? "");
  if (personId) return db.person.findFirst({ where: { id: personId, userId: ownerId }, select: { id: true } });
  const candidateId = String(formData.get("candidateId") ?? "");
  if (!candidateId) return null;
  const id = await ensureCandidatePerson(candidateId, ownerId);
  return id ? { id } : null;
}

async function revalidateFor(personId: string) {
  revalidatePath(`/people/${personId}`);
  const roles = await db.candidate.findMany({ where: { personId }, select: { roleId: true } });
  for (const { roleId } of roles) revalidatePath(`/roles/${roleId}`);
  revalidatePath("/shortlists");
}

export async function uploadCv(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("people");
  const person = await ownedPerson(user.id, formData);
  if (!person) return { error: "That person could not be found." };
  const file = formData.get("cv");
  const bytes = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null;
  const checked = checkCvUpload({
    name: file instanceof File ? file.name : "",
    size: file instanceof File ? file.size : 0,
    bytes,
    contactsChecked: formData.get("contactsChecked") === "on",
  });
  if (checked.error) return { error: checked.error };
  const now = new Date();
  const data = {
    fileName: checked.fileName!,
    sizeBytes: bytes!.length,
    sha256: createHash("sha256").update(bytes!).digest("hex"),
    data: Buffer.from(bytes!),
    contactsCheckedAt: now,
    uploadedAt: now,
  };
  await db.$transaction(async (tx) => {
    await tx.personCv.upsert({ where: { personId: person.id }, create: { personId: person.id, ...data }, update: data });
    await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "person.cv_uploaded" } });
  });
  await revalidateFor(person.id);
  return { notice: "CV saved. Every client page they are on shows it now." };
}

export async function deleteCv(formData: FormData) {
  const user = await requireWritableFeature("people");
  const personId = String(formData.get("personId") ?? "");
  const { count } = await db.personCv.deleteMany({ where: { personId, person: { userId: user.id } } });
  if (!count) return;
  await db.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "person.cv_deleted" } });
  await revalidateFor(personId);
}
