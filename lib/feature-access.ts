import { notFound } from "next/navigation";
import { assertSameOrigin } from "@/lib/auth";
import { canUseProFeatures } from "@/lib/account-tiers";
import { getWorkspace } from "@/lib/workspace";

export async function requireProWorkspace() {
  const workspace = await getWorkspace();
  const now = new Date();
  if (!canUseProFeatures(workspace.user, now) || !canUseProFeatures(workspace.owner, now)) notFound();
  return workspace;
}

export async function requireWritableProWorkspace() {
  assertSameOrigin();
  const workspace = await requireProWorkspace();
  if (workspace.readOnly) throw new Error("This workspace is read-only. Return to your own workspace before making changes.");
  return workspace.user;
}
