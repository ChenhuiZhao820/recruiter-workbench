import { db } from "./db";
import { getWorkspace } from "./workspace";

// Single-row settings. Created on first read so the app works with no seed step.
export async function getSettings() {
  const { owner, readOnly } = await getWorkspace();
  if (readOnly) {
    return await db.settings.findUnique({ where: { userId: owner.id } }) ?? {
      id: 0,
      userId: owner.id,
      recruiterName: "",
      calendarLink: "",
      bookingChaseDays: 2,
      quietNudgeDays: 5,
      captureTokenHash: null,
    };
  }
  return db.settings.upsert({
    where: { userId: owner.id },
    update: {},
    create: { userId: owner.id },
  });
}
