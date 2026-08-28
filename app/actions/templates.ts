"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function createTemplate(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!name || !body) return;
  await db.messageTemplate.create({ data: { name, body } });
  revalidatePath("/templates");
}

export async function updateTemplate(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!id || !name || !body) return;
  await db.messageTemplate.update({ where: { id }, data: { name, body } });
  revalidatePath("/templates");
}

export async function deleteTemplate(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.messageTemplate.delete({ where: { id } });
  revalidatePath("/templates");
}
