import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { canUseFeature } from "@/lib/features";
import { parsePeopleFilters, rankSuggestions, searchWords } from "@/lib/talent.mjs";
import { peopleWhere } from "@/lib/people-search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Vary": "Cookie" };
// Enough rows that the ranking has something to choose between; the words
// already narrow them in the database.
const POOL = 60;

// Suggestions for the People search box, as the recruiter types. Read-only, and
// from the workspace on screen, so a read-only Admin view suggests what that
// workspace's own page would list. Only what a row shows is returned.
export async function GET(request: Request) {
  if (!(await getSession())) return Response.json({ error: "Sign in first." }, { status: 401, headers });
  const { user, owner } = await getWorkspace();
  const now = new Date();
  if (!canUseFeature(user, "people", now) || !canUseFeature(owner, "people", now)) return Response.json({ error: "Not found" }, { status: 404, headers });
  const deep = canUseFeature(user, "peopleSearch", now) && canUseFeature(owner, "peopleSearch", now);

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filters = parsePeopleFilters(params);
  const words: string[] = searchWords(filters.q);
  if (!words.length) return Response.json({ results: [] }, { headers });

  // Without people search the words narrow the rows here, and the ranking
  // then looks only at name and headline, as the page's own search does.
  const where = deep
    ? peopleWhere(owner.id, filters, true, now)
    : { userId: owner.id, AND: words.map((word) => ({ searchText: { contains: word } })) };
  const pool = await db.person.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: POOL,
    select: {
      id: true, fullName: true, headline: true, searchText: true, updatedAt: true, doNotContact: true,
      candidates: { orderBy: { lastActivityAt: "desc" }, take: 1, select: { stage: true, role: { select: { title: true } } } },
    },
  });

  const results = rankSuggestions(pool, filters.q, { deep }).map(({ person, where }: { person: (typeof pool)[number]; where: string }) => ({
    id: person.id,
    name: person.fullName,
    headline: person.headline,
    doNotContact: person.doNotContact,
    role: person.candidates[0] ? { title: person.candidates[0].role.title, stage: person.candidates[0].stage } : null,
    where,
  }));
  return Response.json({ results }, { headers });
}
