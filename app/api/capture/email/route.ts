import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { corsHeaders } from "@/lib/capture";
import { authorizeCapture, captureDenied } from "@/lib/capture-auth";
import { canUseFeature } from "@/lib/features";
import { normalizeProfileUrl } from "@/lib/urls";
import { canonicalProfileUrl } from "@/lib/person-keys.mjs";
import { AllowanceUsed, allowanceUsedText, claimLookup, emailAllowance, launchLookup } from "@/lib/email-finder";
import { enrowKey, lookupRequest } from "@/lib/enrow-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Find email from the extension's panel, on a click, for the profile it read.
// The panel sends the LinkedIn address to this app, and this app to Enrow;
// nothing goes to LinkedIn. The rules are the workbench's own: the plan's
// allowance, do not contact refused, only a found search spending. Someone
// this account already keeps is searched as that person, and the found email
// goes on their record; anyone else is searched by address alone, and the
// panel keeps what was found for the save.
export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: cors });
  const account = await authorizeCapture(request);
  if (!account) return captureDenied(request);
  if (!canUseFeature(account, "emailFinder")) return fail(404, "Not found");
  if (!enrowKey()) return fail(503, "Email search is not set up on this server.");

  const body = (await request.json().catch(() => null)) as { profileUrl?: unknown } | null;
  const profileUrl = normalizeProfileUrl(typeof body?.profileUrl === "string" ? body.profileUrl : "");
  const search = lookupRequest({ fullName: "", profileUrl });
  if (!search) return fail(400, "Open a LinkedIn profile to search for its email.");

  const canonical = canonicalProfileUrl(profileUrl);
  const person = canonical
    ? await db.person.findUnique({ where: { userId_profileUrl: { userId: account.id, profileUrl: canonical } }, select: { id: true, email: true, doNotContact: true } })
    : null;
  if (person?.doNotContact) return fail(409, "This person is marked do not contact.");
  // Already kept: nothing to search for, and nothing spent.
  if (person?.email) return NextResponse.json({ status: "found", email: person.email, remaining: (await emailAllowance(account)).remaining }, { headers: cors });

  let lookup: { id: string; created: boolean };
  try {
    lookup = await claimLookup(account, person?.id ?? null, search.method);
  } catch (error) {
    if (error instanceof AllowanceUsed) return fail(429, allowanceUsedText(error.trial));
    throw error;
  }
  if (lookup.created) {
    const launched = await launchLookup(lookup.id, account.id, search);
    // The panel has no name-and-company search to offer instead.
    if (!launched.ok) return fail(launched.status, launched.status === 422 ? "Enrow could not search this LinkedIn address." : launched.error);
  }
  return NextResponse.json({ id: lookup.id, status: "pending", remaining: (await emailAllowance(account)).remaining }, { headers: cors });
}
