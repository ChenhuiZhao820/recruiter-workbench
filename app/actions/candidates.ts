"use server";

import { db } from "@/lib/db";
import type { FormState } from "@/lib/formState";
import { isStage } from "@/lib/stages";
import { normalizeProfileUrl } from "@/lib/urls";
import { revalidatePath } from "next/cache";

function revalidateCandidate(roleId: string) {
  revalidatePath(`/roles/${roleId}`);
  revalidatePath("/followups");
  revalidatePath("/");
}

export async function addCandidate(_prev: FormState, formData: FormData): Promise<FormState> {
  const roleId = String(formData.get("roleId") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  if (!roleId) return { error: "That role could not be found." };
  if (!fullName) return { error: "Enter the candidate's name before adding them." };

  const profileUrl = normalizeProfileUrl(String(formData.get("profileUrl") ?? ""));

  // The same profile link twice in one role is the same person twice, which
  // is exactly the double-outreach the follow-up guard exists to prevent.
  if (profileUrl) {
    const existing = await db.candidate.findFirst({
      where: { roleId, profileUrl },
      select: { fullName: true },
    });
    if (existing) {
      return {
        error: `${existing.fullName} is already on this role with that profile link. Nothing was added.`,
      };
    }
  }

  await db.candidate.create({
    data: {
      roleId,
      fullName,
      profileUrl,
      headline: String(formData.get("headline") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });
  revalidateCandidate(roleId);

  const sameName = await db.candidate.count({ where: { roleId, fullName } });
  if (sameName > 1) {
    return {
      notice: `Added. Note that this role already had someone called ${fullName} — check you have not added the same person twice.`,
    };
  }
  return { notice: `${fullName} added.` };
}

export async function updateCandidate(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  if (!id) return { error: "That candidate could not be found." };
  if (!fullName) return { error: "A candidate needs a name. Nothing was saved." };

  const profileUrl = normalizeProfileUrl(String(formData.get("profileUrl") ?? ""));
  const current = await db.candidate.findUnique({ where: { id }, select: { roleId: true } });
  if (!current) return { error: "That candidate could not be found." };

  if (profileUrl) {
    const clash = await db.candidate.findFirst({
      where: { roleId: current.roleId, profileUrl, NOT: { id } },
      select: { fullName: true },
    });
    if (clash) {
      return {
        error: `${clash.fullName} already has that profile link on this role. Nothing was saved.`,
      };
    }
  }

  const candidate = await db.candidate.update({
    where: { id },
    data: {
      fullName,
      profileUrl,
      headline: String(formData.get("headline") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });
  revalidateCandidate(candidate.roleId);
  return { notice: "Changes saved." };
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
