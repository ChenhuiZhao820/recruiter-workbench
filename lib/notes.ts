import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import type { FormState } from "@/lib/formState";

// Notes the recruiter writes about a person, kept on their record until the
// recruiter deletes one or erases the person. Unlike a transcript, a note has
// no 30-day limit: it is the recruiter's own record of the conversation.
// Server only; callers have already checked who is asking.

export const MAX_NOTE_CHARS = 60_000;

// Tidy what was typed without touching its shape: one kind of line ending, no
// trailing spaces, nothing before the first word or after the last.
export function cleanNote(text: string) {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

export function noteTooLong(body: string): FormState | null {
  return body.length > MAX_NOTE_CHARS
    ? { error: `That note is ${body.length.toLocaleString("en-GB")} characters; the limit is ${MAX_NOTE_CHARS.toLocaleString("en-GB")}.` }
    : null;
}

// The same text saved to the same person within a minute is one save, so a
// double click does not leave two copies.
export async function saveNote(personId: string, candidateId: string | null, body: string) {
  const recent = await db.personNote.findFirst({
    where: { personId, body, createdAt: { gte: new Date(Date.now() - 60_000) } },
    select: { id: true },
  });
  if (!recent) await db.personNote.create({ data: { personId, candidateId, body } });
  revalidatePath(`/people/${personId}`);
}

// From a screening page: kept against the person, with the role it was
// written for. `ownerId` comes from the caller's own authorization.
export async function saveCandidateNote(ownerId: string, candidate: { id: string; personId: string | null }, text: string): Promise<FormState> {
  const body = cleanNote(text);
  if (!body) return { error: "Write the note first." };
  const tooLong = noteTooLong(body);
  if (tooLong) return tooLong;
  const person = candidate.personId
    ? await db.person.findFirst({ where: { id: candidate.personId, userId: ownerId }, select: { id: true, fullName: true } })
    : null;
  if (!person) return { error: "This candidate has no person record yet, so there is nowhere to keep the note." };
  await saveNote(person.id, candidate.id, body);
  return { notice: `Saved to ${person.fullName.split(/\s+/)[0]}'s record. It stays there until you delete it.` };
}
