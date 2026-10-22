import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { corsHeaders } from "@/lib/capture";
import { hashToken } from "@/lib/auth-crypto";
import { canUseExtension } from "@/lib/extension-access";

// The extension's account: whoever owns the extension key it sends, while that
// account may use the extension at all. Website cookies play no part.
export async function authorizeCapture(request: Request) {
  const token = request.headers.get("x-capture-token");
  if (!token || !/^[A-Za-z0-9_-]{24,128}$/.test(token)) return null;
  const settings = await db.settings.findUnique({
    where: { captureTokenHash: hashToken(token) },
    select: { user: { select: { id: true, email: true, name: true, role: true, active: true, accountTier: true, trialExpiresAt: true, signupSource: true, billingPlan: true, billingStatus: true, billingPastDueSince: true } } },
  });
  return settings && canUseExtension(settings.user) ? settings.user : null;
}

export function captureDenied(request: Request) {
  return NextResponse.json(
    { error: "Extension key missing or revoked, account disabled, or no plan. Sign in, check your plan in Billing, and generate a new key in Settings." },
    { status: 401, headers: corsHeaders(request.headers.get("origin")) }
  );
}
