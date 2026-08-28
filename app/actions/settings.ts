"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function updateSettings(formData: FormData) {
  const bookingChaseDays = parseInt(String(formData.get("bookingChaseDays") ?? ""), 10);
  const quietNudgeDays = parseInt(String(formData.get("quietNudgeDays") ?? ""), 10);
  await db.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  await db.settings.update({
    where: { id: 1 },
    data: {
      recruiterName: String(formData.get("recruiterName") ?? "").trim(),
      calendarLink: String(formData.get("calendarLink") ?? "").trim(),
      bookingChaseDays: Number.isFinite(bookingChaseDays) && bookingChaseDays > 0 ? bookingChaseDays : 2,
      quietNudgeDays: Number.isFinite(quietNudgeDays) && quietNudgeDays > 0 ? quietNudgeDays : 5,
    },
  });
  revalidatePath("/settings");
  revalidatePath("/followups");
}
