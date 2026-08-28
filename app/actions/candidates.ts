"use server";

import { db } from "@/lib/db";
import { isStage } from "@/lib/stages";
import { revalidatePath } from "next/cache";

function revalidateCandidate(roleId: string) {
  revalidatePath(`/roles/${roleId}`);
  revalidatePath("/followups");
  revalidatePath("/");
}

export async function addCandidate(formData: FormData) {
  const roleId = String(formData.get("roleId") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  if (!roleId || !fullName) return;
  await db.candidate.create({
    data: {
      roleId,
      fullName,
      profileUrl: String(formData.get("profileUrl") ?? "").trim() || null,
      headline: String(formData.get("headline") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });
  revalidateCandidate(roleId);
}

export async function updateCandidate(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  if (!id || !fullName) return;
  const candidate = await db.candidate.update({
    where: { id },
    data: {
      fullName,
      profileUrl: String(formData.get("profileUrl") ?? "").trim() || null,
      headline: String(formData.get("headline") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });
  revalidateCandidate(candidate.roleId);
}

export async function setCandidateStage(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const stage = String(formData.get("stage") ?? "");
  if (!id || !isStage(stage)) return;
  const candidate = await db.candidate.update({
    where: { id },
    data: { stage, lastActivityAt: new Date() },
  });
  revalidateCandidate(candidate.roleId);
}

export async function deleteCandidate(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const candidate = await db.candidate.delete({ where: { id } });
  revalidateCandidate(candidate.roleId);
}
