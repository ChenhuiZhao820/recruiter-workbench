"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWritableFeature } from "@/lib/feature-access";
import { disconnectNotionFor } from "@/lib/notion";

// Disconnecting deletes the stored token. Notion has no way for an app to
// give its access back, so Settings also says where to remove Capture in
// Notion itself.
export async function disconnectNotion() {
  const user = await requireWritableFeature("screening");
  await disconnectNotionFor(user.id);
  await db.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "notion.disconnected" } });
  revalidatePath("/settings");
}
