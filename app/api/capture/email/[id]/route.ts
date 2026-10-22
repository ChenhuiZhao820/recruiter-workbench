import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { corsHeaders } from "@/lib/capture";
import { authorizeCapture, captureDenied } from "@/lib/capture-auth";
import { canUseFeature } from "@/lib/features";
import { recordUsage } from "@/lib/usage";
import { emailAllowance, settleLookup } from "@/lib/email-finder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// How one of the extension's searches is going, asked every couple of seconds
// while it runs, the same as the workbench's own Find email. Another account's
// search is not found. Not found and failed cost nothing.
export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const cors = corsHeaders(request.headers.get("origin"));
  const account = await authorizeCapture(request);
  if (!account) return captureDenied(request);
  if (!canUseFeature(account, "emailFinder")) return NextResponse.json({ error: "Not found" }, { status: 404, headers: cors });

  const lookup = await db.emailLookup.findFirst({ where: { id: params.id, userId: account.id } });
  if (!lookup) return NextResponse.json({ error: "That search could not be found." }, { status: 404, headers: cors });

  const settled = lookup.status === "pending"
    ? await settleLookup(lookup)
    : { status: lookup.status, reason: lookup.reason, email: null };
  if (lookup.status === "pending" && settled.status !== "pending") {
    await recordUsage(db, account.id, settled.status === "found" ? "email_found" : "email_not_found");
  }
  // A kept person's record holds the address once found; one typed there meanwhile wins.
  const kept = settled.status === "found" && lookup.personId
    ? (await db.person.findFirst({ where: { id: lookup.personId, userId: account.id }, select: { email: true } }))?.email
    : null;
  const email = settled.status === "found" ? kept ?? settled.email : null;
  const remaining = (await emailAllowance(account)).remaining;
  return NextResponse.json({ status: settled.status, ...(email ? { email } : {}), remaining }, { headers: cors });
}
