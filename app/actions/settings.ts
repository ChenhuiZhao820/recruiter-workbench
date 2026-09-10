"use server";

import { db } from "@/lib/db";
import { requireWritableWorkspace } from "@/lib/workspace";
import { hashToken } from "@/lib/auth-crypto";
import { newCaptureToken } from "@/lib/capture";
import { canUseExtension } from "@/lib/extension-access";
import type { FormState } from "@/lib/formState";
import { revalidatePath } from "next/cache";

// Reads a day threshold. Returns null when the field is blank or not a
// positive whole number, so the caller can refuse the save rather than
// quietly substituting a default over the recruiter's own value.
function readDays(formData: FormData, field: string): number | null {
  const raw = String(formData.get(field) ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function updateSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableWorkspace();
  const bookingChaseDays = readDays(formData, "bookingChaseDays");
  const quietNudgeDays = readDays(formData, "quietNudgeDays");

  const bad: string[] = [];
  if (bookingChaseDays === null) bad.push("Chase a booking after");
  if (quietNudgeDays === null) bad.push("Nudge quiet candidates after");
  if (bad.length > 0) {
    return {
      error: `${bad.join(" and ")} needs a whole number of days, 1 or more. Nothing was saved, so your existing settings are unchanged.`,
    };
  }

  const data = {
    recruiterName: String(formData.get("recruiterName") ?? "").trim(),
    calendarLink: String(formData.get("calendarLink") ?? "").trim(),
    bookingChaseDays: bookingChaseDays!,
    quietNudgeDays: quietNudgeDays!,
  };
  await db.settings.upsert({
    where: { userId: user.id },
    update: data,
    create: { userId: user.id, ...data },
  });
  revalidatePath("/settings");
  revalidatePath("/followups");
  return { notice: "Settings saved." };
}

// Generates (or replaces) the secret the browser extension uses. Replacing it
// immediately stops the old one working, which is the point.
export async function regenerateCaptureToken(): Promise<FormState & { token?: string }> {
  const user = await requireWritableWorkspace();
  let token: string;
  try {
    const generated = await db.$transaction(async (tx) => {
      const account = await tx.user.findUnique({
        where: { id: user.id },
        select: { role: true, active: true, extensionAccess: { select: { activatedAt: true } } },
      });
      if (!account || !canUseExtension(account)) return null;
      const secret = newCaptureToken();
      const captureTokenHash = hashToken(secret);
      await tx.user.update({
        where: {
          id: user.id,
          active: true,
          OR: [{ role: "admin" }, { extensionAccess: { activatedAt: { not: null } } }],
        },
        data: { settings: { upsert: { update: { captureTokenHash }, create: { captureTokenHash } } } },
        select: { id: true },
      });
      return secret;
    }, { isolationLevel: "Serializable" });
    if (!generated) return { error: "Extension activation is required before generating a capture key. Activate the extension on your Account page, or ask your administrator for a code." };
    token = generated;
  } catch {
    return { error: "A capture key could not be generated. Refresh the page and try again." };
  }
  revalidatePath("/settings");
  return { token, notice: "New capture key generated. Copy it now: it will only be shown once. Paste it into the extension; the old key has stopped working." };
}

export async function clearCaptureToken(): Promise<FormState> {
  const user = await requireWritableWorkspace();
  await db.settings.upsert({
    where: { userId: user.id },
    update: { captureTokenHash: null },
    create: { userId: user.id, captureTokenHash: null },
  });
  revalidatePath("/settings");
  return { notice: "Capture switched off. The extension can no longer save to this workbench." };
}
