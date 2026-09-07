"use server";

import { db } from "@/lib/db";
import { newCaptureToken } from "@/lib/capture";
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

  await db.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await db.settings.update({
    where: { id: 1 },
    data: {
      recruiterName: String(formData.get("recruiterName") ?? "").trim(),
      calendarLink: String(formData.get("calendarLink") ?? "").trim(),
      bookingChaseDays: bookingChaseDays!,
      quietNudgeDays: quietNudgeDays!,
    },
  });
  revalidatePath("/settings");
  revalidatePath("/followups");
  return { notice: "Settings saved." };
}

// Generates (or replaces) the secret the browser extension uses. Replacing it
// immediately stops the old one working, which is the point.
export async function regenerateCaptureToken(): Promise<FormState> {
  await db.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await db.settings.update({ where: { id: 1 }, data: { captureToken: newCaptureToken() } });
  revalidatePath("/settings");
  return { notice: "New capture key generated. Paste it into the extension; the old key has stopped working." };
}

export async function clearCaptureToken(): Promise<FormState> {
  await db.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await db.settings.update({ where: { id: 1 }, data: { captureToken: "" } });
  revalidatePath("/settings");
  return { notice: "Capture switched off. The extension can no longer save to this workbench." };
}
