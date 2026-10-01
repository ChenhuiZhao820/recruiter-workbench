import { notFound } from "next/navigation";
import { assertSameOrigin } from "@/lib/auth";
import { canUseProFeatures } from "@/lib/account-tiers";
import { getWorkspace } from "@/lib/workspace";
import { FEATURES, canUseFeature, type Feature } from "@/lib/features";

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

// Feature-named guards. Which tier a feature needs is decided only in
// FEATURE_TIERS; like the Pro guards, both the signed-in account and the
// workspace owner must qualify, so a read-only Admin view of a Basic
// workspace shows the Basic workspace.
export async function requireFeature(feature: Feature) {
  const workspace = await getWorkspace();
  const now = new Date();
  if (!canUseFeature(workspace.user, feature, now) || !canUseFeature(workspace.owner, feature, now)) notFound();
  return workspace;
}

export async function requireWritableFeature(feature: Feature) {
  assertSameOrigin();
  const workspace = await requireFeature(feature);
  if (workspace.readOnly) throw new Error("This workspace is read-only. Return to your own workspace before making changes.");
  return workspace.user;
}

// For deciding whether to render a control at all. Pro-only UI is omitted for
// Basic, not shown disabled.
export async function featureAvailability(): Promise<Record<Feature, boolean>> {
  const { user, owner } = await getWorkspace();
  const now = new Date();
  return Object.fromEntries(
    FEATURES.map((feature) => [feature, canUseFeature(user, feature, now) && canUseFeature(owner, feature, now)])
  ) as Record<Feature, boolean>;
}
