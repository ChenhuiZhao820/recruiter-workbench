"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createRole(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const client = String(formData.get("client") ?? "").trim() || null;
  const jobDesc = String(formData.get("jobDesc") ?? "").trim() || null;
  const role = await db.role.create({ data: { title, client, jobDesc } });
  revalidatePath("/");
  redirect(`/roles/${role.id}`);
}

export async function updateRole(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!id || !title) return;
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
}

export async function deleteRole(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.role.delete({ where: { id } });
  revalidatePath("/");
  redirect("/");
}
