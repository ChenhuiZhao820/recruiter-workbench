"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWritableFeature } from "@/lib/feature-access";
import { revokeConnection } from "@/lib/calendar";

// Disconnecting gives the provider's access back where it can be (Google) and
// deletes the stored token either way; the booking page goes back to the
// weekly hours alone.
export async function disconnectCalendar() {
  const user = await requireWritableFeature("calendarFreeBusy");
  await revokeConnection(user.id);
  await db.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "calendar.disconnected" } });
  revalidatePath("/settings/booking");
}
