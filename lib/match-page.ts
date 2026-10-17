import { db } from "@/lib/db";
import { matchReadsLeft } from "@/lib/match";
import { parseObjectArray, parseStringArray } from "@/lib/json";
import { locationText, noticeText, rightToWorkText, salaryText } from "@/lib/fact-labels";
import { factsAreStale } from "@/lib/talent.mjs";
import { MATCH_PAGE, booleanQuery, decodeCriteria, encodeCriteria, notFitOptions, requirementLabels, runMatch } from "@/lib/match-core.mjs";
import type { MatchPageData, MatchRowData } from "@/components/match/InstantMatch";

// What the People page needs for Instant Match: the open roles to match from
// or save to, how many briefs are left, and - when the address carries
// criteria (c) - the match itself, with anyone set aside (x) left out. The
// address is the whole state, so Back undoes a change and a reload shows the
// same match. The brief itself stays in the browser that typed it.

export type MatchParams = { c?: string; x?: string; role?: string; all?: string };

const ID = /^[A-Za-z0-9_-]{1,40}$/;

function hiddenIds(value: string | undefined) {
  return Array.from(new Set(String(value ?? "").split(",").filter((id) => ID.test(id)))).slice(0, 200);
}

function href(encoded: string, hidden: string[]) {
  const params = new URLSearchParams({ c: encoded });
  if (hidden.length) params.set("x", hidden.join(","));
  return `/people?${params.toString()}`;
}


export async function loadMatchPage(owner: { id: string }, readOnly: boolean, searchParams: MatchParams): Promise<MatchPageData> {
  const now = new Date();
  const criteria = decodeCriteria(searchParams.c);
  const hidden = criteria ? hiddenIds(searchParams.x) : [];

  const [roles, readsLeft] = await Promise.all([
    db.role.findMany({
      where: { userId: owner.id, status: "open" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, client: true, jobDesc: true, budgetMin: true, budgetMax: true, budgetCurrency: true, briefing: { select: { keySkills: true, searchTitles: true } } },
    }),
    readOnly ? 0 : matchReadsLeft(owner.id, now),
  ]);
  const startRole = roles.find((role) => role.id === searchParams.role) ?? null;

  let results: MatchPageData["results"] = null;
  if (criteria) {
    const people = await db.person.findMany({
      where: { userId: owner.id, doNotContact: false },
      orderBy: { updatedAt: "desc" },
      take: 5000,
      select: {
        id: true, fullName: true, headline: true, searchText: true, doNotContact: true,
        salaryMin: true, salaryMax: true, salaryCurrency: true, noticeWeeks: true, location: true, remotePreference: true, rightToWork: true, factsConfirmedAt: true,
        candidates: { where: { role: { status: "open" } }, select: { role: { select: { id: true, title: true } } } },
      },
    });
    const outcome = runMatch(people, criteria, new Set(hidden));
    const row = (entry: (typeof outcome.matches)[number]): MatchRowData => {
      const { person } = entry;
      const miss = entry.misses[0] ?? null;
      return {
        id: person.id,
        fullName: person.fullName,
        headline: person.headline,
        facts: [
          salaryText(person.salaryMin, person.salaryMax, person.salaryCurrency),
          noticeText(person.noticeWeeks) && `${noticeText(person.noticeWeeks)} notice`,
          locationText(person.location, person.remotePreference),
          rightToWorkText(person.rightToWork),
        ].filter((fact): fact is string => Boolean(fact)),
        stale: factsAreStale(person.factsConfirmedAt, now),
        hits: entry.hits,
        roles: person.candidates.map((candidate: { role: { id: string; title: string } }) => candidate.role),
        miss: miss ? { why: miss.why, status: miss.status } : null,
        notFit: notFitOptions(person, criteria).map((option) => ({
          reason: option.reason,
          label: option.label,
          href: href(encodeCriteria(option.criteria), [...hidden, person.id]),
        })),
      };
    };
    const showAll = searchParams.all === "1";
    results = {
      total: outcome.matches.length,
      matches: (showAll ? outcome.matches : outcome.matches.slice(0, MATCH_PAGE)).map(row),
      near: outcome.near.map(row),
      nearTotal: outcome.nearTotal,
      loosen: outcome.loosen.slice(0, 5).map((option) => ({ id: option.id, label: option.label, gain: option.gain, href: href(encodeCriteria(option.criteria), hidden) })),
      loosenDepth: outcome.loosenDepth,
      hiddenCount: hidden.length,
      showAllHref: !showAll && outcome.matches.length > MATCH_PAGE ? `${href(encodeCriteria(criteria), hidden)}&all=1` : null,
      unhideHref: hidden.length ? href(encodeCriteria(criteria), []) : null,
      databaseSize: people.length,
    };
  }

  const data: MatchPageData = {
    readOnly,
    readsLeft,
    criteria,
    encoded: criteria ? encodeCriteria(criteria) : null,
    hidden,
    requirements: criteria ? requirementLabels(criteria) : [],
    query: criteria ? booleanQuery(criteria) : "",
    results,
    roles: roles.map((role) => ({
      id: role.id,
      title: role.title,
      client: role.client,
      hasJobDesc: Boolean(role.jobDesc?.trim()),
      budgetText: salaryText(role.budgetMin, role.budgetMax, role.budgetCurrency),
      skills: parseObjectArray<{ skill: string }>(role.briefing?.keySkills).map((item) => item.skill).filter((skill) => typeof skill === "string"),
      titles: parseStringArray(role.briefing?.searchTitles),
    })),
    startRole: startRole ? { id: startRole.id, title: startRole.title, jobDesc: startRole.jobDesc ?? "" } : null,
  };

  return data;
}
