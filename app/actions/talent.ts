"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWritableFeature } from "@/lib/feature-access";
import type { FormState } from "@/lib/formState";
import { readDate } from "@/lib/talent.mjs";

// Someone already in the database, filed against another role. The candidacy
// is new; the person, their facts and their history are the same record.
export async function addPersonToRole(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("talentMatches");
  const [person, role] = await Promise.all([
    db.person.findFirst({ where: { id: String(formData.get("personId") ?? ""), userId: user.id } }),
    db.role.findFirst({ where: { id: String(formData.get("roleId") ?? ""), userId: user.id, status: "open" }, select: { id: true } }),
  ]);
  if (!person || !role) return { error: "That person or role could not be found." };
  if (person.doNotContact) return { error: `${person.fullName} is marked do not contact.` };
  const already = await db.candidate.findFirst({ where: { roleId: role.id, personId: person.id, role: { userId: user.id } }, select: { id: true } });
  if (already) return { notice: `${person.fullName} is already on this role.` };
  await db.candidate.create({
    data: {
      role: { connect: { id: role.id, userId: user.id } },
      person: { connect: { id: person.id } },
      fullName: person.fullName,
      profileUrl: person.profileUrl,
      memberId: person.memberId,
      headline: person.headline,
    },
  });
  revalidatePath(`/roles/${role.id}`);
  revalidatePath(`/people/${person.id}`);
  revalidatePath("/people");
  return { notice: `${person.fullName} added to this role as sourced.` };
}

// When to get back in touch, and why. Clearing it is the same action.
export async function setRevisit(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("revisitReminders");
  const id = String(formData.get("personId") ?? "");
  const clear = formData.get("intent") === "clear";
  const revisitOn = clear ? null : readDate(formData.get("revisitOn"));
  if (!clear && !revisitOn) return { error: "Choose the date to get back in touch." };
  const revisitNote = clear ? null : String(formData.get("revisitNote") ?? "").trim().slice(0, 500) || null;
  const { count } = await db.person.updateMany({ where: { id, userId: user.id }, data: { revisitOn, revisitNote } });
  if (!count) return { error: "That person could not be found." };
  revalidatePath(`/people/${id}`);
  revalidatePath("/followups");
  return { notice: clear ? "Reminder cleared." : "Reminder saved. It shows in Follow-ups the week it is due." };
}

// From the review list: the recruiter has a reason to keep this record for
// another year. Recorded in the audit log without the person's name.
export async function keepPerson(formData: FormData) {
  const user = await requireWritableFeature("privacy");
  const id = String(formData.get("personId") ?? "");
  const { count } = await db.person.updateMany({ where: { id, userId: user.id }, data: { updatedAt: new Date() } });
  if (!count) return;
  await db.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "person.kept" } });
  revalidatePath("/people/review");
  revalidatePath("/people");
}
