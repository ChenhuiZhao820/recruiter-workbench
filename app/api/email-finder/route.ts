import { db } from "@/lib/db";
import { appOrigin, getSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { canUseFeature } from "@/lib/features";
import { recordUsage } from "@/lib/usage";
import { emailAllowance, startEnrowSearch } from "@/lib/email-finder";
import { PENDING_COUNTS_MS, enrowKey, lookupRequest } from "@/lib/enrow-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => Response.json({ error, ...extra }, { status, headers });

class AllowanceUsed extends Error {
  constructor(readonly trial: boolean) { super("allowance used"); }
}

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

  const now = new Date();
  let lookup: { id: string; created: boolean };
  try {
    lookup = await db.$transaction(async (tx) => {
      const running = await tx.emailLookup.findFirst({
        where: { userId: user.id, personId: person.id, status: "pending", createdAt: { gte: new Date(now.getTime() - PENDING_COUNTS_MS) } },
        select: { id: true },
      });
      if (running) return { id: running.id, created: false };
      const allowance = await emailAllowance(user, tx, now);
      if (allowance.remaining <= 0) throw new AllowanceUsed(allowance.trial);
      const row = await tx.emailLookup.create({ data: { userId: user.id, personId: person.id, method: search.method }, select: { id: true } });
      return { id: row.id, created: true };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof AllowanceUsed) {
      return fail(429, error.trial
        ? "Your trial's email searches are used up. Choose a plan in Billing for more, or add this one by hand."
        : "This month's email searches are used up. Add this one by hand.");
    }
    throw error;
  }
  if (!lookup.created) return Response.json({ id: lookup.id, status: "pending", remaining: (await emailAllowance(user)).remaining }, { headers });

  const started = await startEnrowSearch(search.body);
  if (started.state !== "started") {
    await db.emailLookup.update({ where: { id: lookup.id }, data: { status: "failed", finishedAt: new Date() } });
    if (started.state === "linkedin_refused") return fail(422, "Enrow could not search that LinkedIn address. Search by name and company instead.", { needCompany: true });
    if (started.state === "no_credits") return fail(503, "Email search is unavailable right now. Try again later or add the email by hand.");
    return fail(502, "The email search service could not be reached. Try again in a moment.");
  }
  await db.emailLookup.update({ where: { id: lookup.id }, data: { enrowId: started.id } });
  await recordUsage(db, user.id, "email_search_started", search.method === "linkedin" ? 1 : 0);
  return Response.json({ id: lookup.id, status: "pending", remaining: (await emailAllowance(user)).remaining }, { headers });
}
