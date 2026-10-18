"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWritableFeature } from "@/lib/feature-access";
import type { FormState } from "@/lib/formState";
import { INTERVIEW_DURATIONS } from "@/lib/interviews";
import { isTimeZone, timeToMinutes } from "@/lib/booking-core.mjs";

// The client's interview hours on a role: when the client interviews, in
// their time zone, for how long, and where. Candidates book from these.
export async function updateInterviewHours(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("clientShortlists");
  const role = await db.role.findFirst({ where: { id: String(formData.get("roleId") ?? ""), userId: user.id }, select: { id: true } });
  if (!role) return { error: "That role could not be found." };
  const problems: string[] = [];
  const windows: { day: number; startMin: number; endMin: number }[] = [];
  for (let day = 0; day <= 6; day++) {
    if (formData.get(`iv-day-${day}`) !== "on") continue;
    const startMin = timeToMinutes(formData.get(`iv-start-${day}`));
    const endMin = timeToMinutes(formData.get(`iv-end-${day}`));
    if (startMin === null || endMin === null || startMin >= endMin) problems.push("each ticked day needs a start time before its end time");
    else windows.push({ day, startMin, endMin });
  }
  if (windows.length === 0) problems.push("tick at least one day");
  const timeZone = String(formData.get("interviewTimezone") ?? "").trim();
  if (!isTimeZone(timeZone)) problems.push("choose a time zone from the list");
  const duration = Number(formData.get("interviewDurationMins"));
  if (!INTERVIEW_DURATIONS.includes(duration)) problems.push("choose an interview length");
  const location = String(formData.get("interviewLocation") ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (/^[a-z]+:\/\//i.test(location) && !/^https:\/\/[^\s]+$/i.test(location)) problems.push("a meeting link must be a full https:// address");
  if (problems.length) return { error: `Nothing was saved: ${Array.from(new Set(problems)).join("; ")}.` };

  await db.role.update({
    where: { id: role.id },
    data: {
      interviewWindows: JSON.stringify(windows.sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7))),
      interviewTimezone: timeZone,
      interviewDurationMins: duration,
      interviewLocation: location || null,
    },
  });
  revalidatePath(`/roles/${role.id}`);
  return { notice: "Saved. Candidates the client wants to meet can now book a time with {{interview_link}}." };
}

// Whether the client reviews candidates before interviews. Off, anyone put
// forward can book the client's interview at once, and the client's page shows
// who is invited instead of asking for an answer.
export async function setClientReviewFirst(formData: FormData) {
  const user = await requireWritableFeature("clientShortlists");
  const role = await db.role.findFirst({ where: { id: String(formData.get("roleId") ?? ""), userId: user.id }, select: { id: true } });
  if (!role) return;
  await db.$transaction(async (tx) => {
    await tx.role.update({ where: { id: role.id }, data: { clientReviewFirst: formData.get("reviewFirst") === "on" } });
    await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "role.client_review_changed" } });
  });
  revalidatePath(`/roles/${role.id}`);
  revalidatePath("/followups");
}
