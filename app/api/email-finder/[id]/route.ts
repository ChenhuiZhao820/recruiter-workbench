import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { canUseFeature } from "@/lib/features";
import { recordUsage } from "@/lib/usage";
import { emailAllowance, settleLookup } from "@/lib/email-finder";
import { notFoundText } from "@/lib/enrow-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

// How one of the account's own searches is going. The page asks every few
// seconds while it runs; each ask reads Enrow once, which costs nothing, and
// the first answer that ends the search is recorded. Another account's id is
// not found. A read-only view never reads, because reading can write the
// found email onto the person.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!(await getSession())) return fail(401, "Sign in first.");
  const { user, owner, readOnly } = await getWorkspace();
  if (readOnly) return fail(403, "Return to your own workspace first.");
  if (!canUseFeature(user, "emailFinder") || !canUseFeature(owner, "emailFinder")) return fail(404, "Not found");

  const lookup = await db.emailLookup.findFirst({ where: { id: params.id, userId: user.id } });
  if (!lookup) return fail(404, "That search could not be found.");

  const settled = lookup.status === "pending"
    ? await settleLookup(lookup)
    : { status: lookup.status, reason: lookup.reason, email: null };
  if (lookup.status === "pending" && settled.status !== "pending") {
    await recordUsage(db, user.id, settled.status === "found" ? "email_found" : "email_not_found");
  }
  // Whatever the person now holds: the found email, or one typed meanwhile.
  const email = settled.status === "found" && lookup.personId
    ? (await db.person.findFirst({ where: { id: lookup.personId, userId: user.id }, select: { email: true } }))?.email ?? settled.email
    : null;
  const remaining = (await emailAllowance(user)).remaining;
  if (settled.status === "pending") return Response.json({ status: "pending", remaining }, { headers });
  if (settled.status === "found") return Response.json({ status: "found", email, remaining }, { headers });
  if (settled.status === "not_found") return Response.json({ status: "not_found", ...notFoundText(settled.reason, lookup.method), remaining }, { headers });
  return Response.json({ status: "failed", text: "The search did not finish. Try again in a moment.", remaining }, { headers });
}
