"use server";

import { requireWritableWorkspace } from "@/lib/workspace";
import { markCurrentReleaseSeen } from "@/lib/release";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// Recorded when the recruiter says they have read it, never when the page
// merely renders: a notice that marks itself read on the way past is a notice
// nobody read. A read-only view cannot mark anybody's release as seen.
export async function dismissRelease() {
  const user = await requireWritableWorkspace();
  await markCurrentReleaseSeen(user.id);
  revalidatePath("/", "layout");
  redirect("/");
}
