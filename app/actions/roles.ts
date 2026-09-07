"use server";

import { db } from "@/lib/db";
import type { FormState } from "@/lib/formState";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createRole(_prev: FormState, formData: FormData): Promise<FormState> {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Give the role a job title before creating it." };

  const client = String(formData.get("client") ?? "").trim() || null;
  const jobDesc = String(formData.get("jobDesc") ?? "").trim() || null;
  const role = await db.role.create({ data: { title, client, jobDesc } });
  revalidatePath("/");
  redirect(`/roles/${role.id}`);
}

export async function updateRole(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!id) return { error: "That role could not be found." };
  if (!title) return { error: "A role needs a job title. Nothing was saved." };

  await db.role.update({
    where: { id },
    data: {
      title,
      client: String(formData.get("client") ?? "").trim() || null,
      jobDesc: String(formData.get("jobDesc") ?? "").trim() || null,
      status: formData.get("status") === "closed" ? "closed" : "open",
    },
  });
  revalidatePath("/");
  revalidatePath(`/roles/${id}`);
  return { notice: "Role saved." };
}

export async function deleteRole(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.role.delete({ where: { id } });
  revalidatePath("/");
  revalidatePath("/searches");
  redirect("/");
}
