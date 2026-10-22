import { db } from "@/lib/db";
import { appOrigin, getSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { canUseFeature } from "@/lib/features";
import { AllowanceUsed, allowanceUsedText, claimLookup, emailAllowance, launchLookup } from "@/lib/email-finder";
import { enrowKey, lookupRequest } from "@/lib/enrow-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => Response.json({ error, ...extra }, { status, headers });

// Starts one email search for one of the signed-in account's own people, on a
// click on Find email. Only from this app's own pages, never from a read-only
// view (it spends), never for someone marked do not contact or who already
// has an email. Enrow is sent their LinkedIn address, or their name and the
// company the recruiter confirmed; nothing is sent to LinkedIn. The search
// holds a place in the plan's allowance while it runs and keeps it only if an
// email is found. A second click while one is running gets the same search.
export async function POST(request: Request) {
  if (request.headers.get("origin") !== appOrigin()) return fail(403, "This request did not come from the workbench.");
  if (!(await getSession())) return fail(401, "Sign in first.");
  const { user, owner, readOnly } = await getWorkspace();
  if (readOnly) return fail(403, "Return to your own workspace first.");
  if (!canUseFeature(user, "emailFinder") || !canUseFeature(owner, "emailFinder")) return fail(404, "Not found");
  if (!enrowKey()) return fail(503, "Email search is not set up on this server.");

  const body = (await request.json().catch(() => null)) as { personId?: unknown; company?: unknown } | null;
  const personId = typeof body?.personId === "string" ? body.personId : "";
  const company = typeof body?.company === "string" ? body.company : null;
  const person = await db.person.findFirst({ where: { id: personId, userId: user.id }, select: { id: true, fullName: true, profileUrl: true, email: true, doNotContact: true } });
  if (!person) return fail(404, "That person could not be found.");
  if (person.doNotContact) return fail(409, "This person is marked do not contact.");
  if (person.email) return fail(409, "This person already has an email.");
  const search = lookupRequest(person, company);
  if (!search) return fail(400, "Add the company they work for to search by name.", { needCompany: true });

  let lookup: { id: string; created: boolean };
  try {
    lookup = await claimLookup(user, person.id, search.method);
  } catch (error) {
    if (error instanceof AllowanceUsed) return fail(429, allowanceUsedText(error.trial));
    throw error;
  }
  if (!lookup.created) return Response.json({ id: lookup.id, status: "pending", remaining: (await emailAllowance(user)).remaining }, { headers });

  const launched = await launchLookup(lookup.id, user.id, search);
  if (!launched.ok) return fail(launched.status, launched.error, launched.needCompany ? { needCompany: true } : {});
  return Response.json({ id: lookup.id, status: "pending", remaining: (await emailAllowance(user)).remaining }, { headers });
}
