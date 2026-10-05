"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWritableFeature } from "@/lib/feature-access";
import type { FormState } from "@/lib/formState";
import { cleanNote, noteTooLong, saveNote } from "@/lib/notes";

// Writing and deleting a person's notes from their page. Both act only on the
// signed-in account's own people, never from a read-only view.

export async function addPersonNote(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("people");
  const body = cleanNote(String(formData.get("body") ?? ""));
  if (!body) return { error: "Write the note first." };
  const tooLong = noteTooLong(body);
  if (tooLong) return tooLong;
  const person = await db.person.findFirst({ where: { id: String(formData.get("personId") ?? ""), userId: user.id }, select: { id: true } });
  if (!person) return { error: "That person could not be found." };
  await saveNote(person.id, null, body);
  return { notice: "Note saved." };
}

export async function deletePersonNote(formData: FormData) {
  const user = await requireWritableFeature("people");
  const note = await db.personNote.findFirst({
    where: { id: String(formData.get("noteId") ?? ""), person: { userId: user.id } },
    select: { id: true, personId: true },
  });
  if (!note) return;
  await db.personNote.delete({ where: { id: note.id } });
  revalidatePath(`/people/${note.personId}`);
}
