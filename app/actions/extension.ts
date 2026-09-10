"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { takeAuthAttempt } from "@/lib/auth";
import { requireWritableWorkspace } from "@/lib/workspace";
import { hashExtensionCode, newExtensionCode } from "@/lib/extension-access";
import type { FormState } from "@/lib/formState";

export type ExtensionActionState = FormState & { code?: string };

function refreshExtensionAccess() {
  revalidatePath("/account");
  revalidatePath("/admin");
  revalidatePath("/settings");
}

export async function issueExtensionCode(_state: ExtensionActionState, form: FormData): Promise<ExtensionActionState> {
  const admin = await requireWritableWorkspace();
  if (admin.role !== "admin") return { error: "Administrator access is required to issue extension activation codes." };
  const userId = String(form.get("userId") ?? "").trim();
  if (!userId) return { error: "Choose an active recruiter account." };
  const code = newExtensionCode();
  try {
    const issued = await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { active: true, role: true, extensionAccess: { select: { activatedAt: true } } },
      });
      if (!user?.active || user.role !== "recruiter" || user.extensionAccess?.activatedAt) return false;
      const now = new Date();
      const data = { codeHash: hashExtensionCode(code), expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) };
      if (user.extensionAccess) {
        const updated = await tx.extensionAccess.updateMany({
          where: { userId, activatedAt: null, user: { active: true, role: "recruiter" } },
          data,
        });
        if (!updated.count) return false;
      } else {
        await tx.extensionAccess.create({ data: { userId, ...data } });
      }
      await tx.auditEvent.create({ data: { actorId: admin.id, targetUserId: userId, action: "extension_code_issued" } });
      return true;
    }, { isolationLevel: "Serializable" });
    if (!issued) return { error: "Codes can only be issued to active recruiter accounts that have not activated the extension." };
  } catch {
    return { error: "The extension code could not be issued. Refresh the page and try again." };
  }
  refreshExtensionAccess();
  return { code, notice: "Share this code privately with this recruiter. It expires in 7 days, replaces any earlier code, and is only shown here once." };
}

export async function redeemExtensionCode(_state: ExtensionActionState, form: FormData): Promise<ExtensionActionState> {
  const user = await requireWritableWorkspace();
  if (user.role === "admin") return { notice: "Administrators already have extension access; no activation code is needed." };
  const invalid = { error: "This extension activation code is invalid, expired, already used, or belongs to another account. Ask your administrator for a new code." };
  try {
    if (!await takeAuthAttempt(`extension:${user.id}`, 10, 900)) {
      return { error: "Too many extension activation attempts. Wait a few minutes before trying again." };
    }
    const code = String(form.get("code") ?? "").trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) return invalid;
    const redeemed = await db.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.extensionAccess.updateMany({
        where: {
          userId: user.id,
          codeHash: hashExtensionCode(code),
          expiresAt: { gt: now },
          activatedAt: null,
          user: { active: true, role: "recruiter" },
        },
        data: { activatedAt: now, codeHash: null, expiresAt: null },
      });
      if (!updated.count) return false;
      await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "extension_activated" } });
      return true;
    });
    if (!redeemed) return invalid;
  } catch {
    return { error: "Extension activation could not be completed. Refresh the page and try again." };
  }
  refreshExtensionAccess();
  return { notice: "Extension activated for your account. You can now generate a capture key in Settings." };
}
