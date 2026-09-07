"use server";

import { db } from "@/lib/db";
import type { FormState } from "@/lib/formState";
import { unknownPlaceholders } from "@/lib/render";
import { CONNECTION_NOTE_LIMIT, isTemplateKind } from "@/lib/templates";
import { revalidatePath } from "next/cache";

// Warns about {{gaps}} this app cannot fill, so a typo is caught while
// writing the template rather than in a message to a candidate.
function placeholderNotice(body: string, prefix: string): string {
  const unknown = unknownPlaceholders(body);
  if (unknown.length === 0) return prefix;
  const list = unknown.map((name) => `{{${name}}}`).join(", ");
  return `${prefix} Heads up: ${list} ${
    unknown.length === 1 ? "is not a gap" : "are not gaps"
  } this app can fill, so it will show as [UNKNOWN] in the message.`;
}

// A connection note that is over the cap cannot be sent as written, so it is
// refused here rather than discovered when pasting into LinkedIn.
function lengthProblem(kind: string, body: string): string | null {
  if (kind !== "connection_note" || body.length <= CONNECTION_NOTE_LIMIT) return null;
  return `That is ${body.length} characters, ${body.length - CONNECTION_NOTE_LIMIT} over the ${CONNECTION_NOTE_LIMIT}-character limit for a connection note. Trim it, or set "Sent as" to Message.`;
}

function readKind(formData: FormData): string {
  const kind = String(formData.get("kind") ?? "message");
  return isTemplateKind(kind) ? kind : "message";
}

export async function createTemplate(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!name) return { error: "Give the template a name." };
  if (!body) return { error: "Write the message before saving the template." };
  const kind = readKind(formData);
  const tooLong = lengthProblem(kind, body);
  if (tooLong) return { error: tooLong };

  await db.messageTemplate.create({ data: { name, body, kind } });
  revalidatePath("/templates");
  return { notice: placeholderNotice(body, `Template "${name}" created.`) };
}

export async function updateTemplate(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!id) return { error: "That template could not be found." };
  if (!name) return { error: "A template needs a name. Nothing was saved." };
  if (!body) return { error: "A template needs a message. Nothing was saved." };
  const kind = readKind(formData);
  const tooLong = lengthProblem(kind, body);
  if (tooLong) return { error: tooLong };

  await db.messageTemplate.update({ where: { id }, data: { name, body, kind } });
  revalidatePath("/templates");
  return { notice: placeholderNotice(body, "Template saved.") };
}

export async function deleteTemplate(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.messageTemplate.delete({ where: { id } });
  revalidatePath("/templates");
}
