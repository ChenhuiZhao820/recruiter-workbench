import type { Prisma } from "@prisma/client";
import { parsePeopleFilters, searchWords } from "@/lib/talent.mjs";

const DAY_MS = 86_400_000;

export type PeopleFilters = ReturnType<typeof parsePeopleFilters>;

// The one reading of a people search, shared by the page and the live
// suggestions, so what is suggested is what Search would list. With people
// search every word must be in searchText and the confirmed-fact filters
// apply; without it the words are looked for here and the caller keeps only
// name and headline matches, because searchText also carries confirmed facts.
export function peopleWhere(ownerId: string, filters: PeopleFilters, deep: boolean, now = new Date()): Prisma.PersonWhereInput {
  const and: Prisma.PersonWhereInput[] = [];
  if (deep) {
    for (const word of searchWords(filters.q)) and.push({ searchText: { contains: word } });
    if (filters.maxSalary !== null) {
      and.push({ OR: [{ salaryMin: { lte: filters.maxSalary } }, { salaryMin: null, salaryMax: { lte: filters.maxSalary } }] });
    }
    if (filters.maxNotice !== null) and.push({ noticeWeeks: { lte: filters.maxNotice } });
    if (filters.remote) and.push({ remotePreference: filters.remote });
    if (filters.rightToWork) and.push({ rightToWork: filters.rightToWork });
    if (filters.freshMonths) and.push({ factsConfirmedAt: { gte: new Date(now.getTime() - filters.freshMonths * 30 * DAY_MS) } });
  } else if (filters.q) {
    and.push({ searchText: { contains: filters.q.toLowerCase() } });
  }
  return { userId: ownerId, AND: and };
}
