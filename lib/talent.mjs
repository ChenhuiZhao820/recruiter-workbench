// The talent database's rules, shared by the app and the unit tests: reading
// money, scoring people against a role, the role budget, the people-search
// filters, revisit dates and stale facts. No database, no network, no model:
// matching is plain word matching over each person's own lower-cased text.

const DAY_MS = 86_400_000;
export const STALE_FACT_DAYS = 183;
export const REVIEW_MONTHS = 12;
export const REVISIT_SOON_DAYS = 7;
export const MATCH_LIMIT = 10;

// "85k", "£85,000", "85000" -> 85000. Null for blank or unreadable.
export function parseMoney(text) {
  const value = String(text ?? "").trim().replace(/[,\s£$€]/g, "").toLowerCase();
  if (!value) return null;
  const match = value.match(/^(\d+(?:\.\d+)?)(k)?$/);
  if (!match) return null;
  const number = Math.round(Number(match[1]) * (match[2] ? 1000 : 1));
  return Number.isFinite(number) && number >= 0 && number <= 100_000_000 ? number : null;
}

// A role's optional annual budget. Given the wrong way round, it is turned
// round; a currency is only kept alongside a figure.
export function readBudget(get) {
  const minText = String(get("budgetMin") ?? "").trim();
  const maxText = String(get("budgetMax") ?? "").trim();
  let budgetMin = parseMoney(minText);
  let budgetMax = parseMoney(maxText);
  if ((minText && budgetMin === null) || (maxText && budgetMax === null)) {
    return { error: "Budget figures are whole amounts a year, such as 85000 or 85k." };
  }
  if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) [budgetMin, budgetMax] = [budgetMax, budgetMin];
  const currency = String(get("budgetCurrency") ?? "").trim().toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) return { error: "The budget currency is a three-letter code, such as GBP." };
  const any = budgetMin !== null || budgetMax !== null;
  return { budgetMin, budgetMax, budgetCurrency: any ? currency || "GBP" : null };
}

// --- Matching ---------------------------------------------------------------

const STOPWORDS = new Set(["and", "the", "for", "with", "from", "into", "that", "this", "senior", "junior", "lead", "head", "manager", "engineer", "developer", "experience", "knowledge", "skills"]);

function normalise(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

// The phrases a role is looked for by: its briefing's key skills and the job
// titles those people also go by. Lower-cased, de-duplicated.
export function matchTerms(keySkills = [], searchTitles = []) {
  const seen = new Set();
  const terms = [];
  for (const raw of [...keySkills, ...searchTitles]) {
    const term = normalise(raw).replace(/[^\p{L}\p{N}+#.\- ]/gu, "").trim();
    if (term.length < 2 || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms.slice(0, 30);
}

function wordIn(text, word) {
  // Whole words, so "go" does not match "google" and "java" not "javascript".
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(text);
}

// Three points for a whole phrase; otherwise one for each significant word of
// it. The phrases hit are returned so the page can say why someone matched.
export function scorePerson(searchText, terms) {
  const text = normalise(searchText);
  let score = 0;
  const hits = [];
  for (const term of terms) {
    if (wordIn(text, term)) {
      score += 3;
      hits.push(term);
      continue;
    }
    const words = term.split(" ").filter((word) => word.length >= 4 && !STOPWORDS.has(word));
    if (words.length < 2) continue;
    const found = words.filter((word) => wordIn(text, word));
    if (found.length) {
      score += found.length;
      hits.push(term);
    }
  }
  return { score, hits };
}

// Whether a person's confirmed salary sits inside a role's budget. Without a
// budget nothing is filtered; without a confirmed salary, or in another
// currency, the answer is unknown rather than a guess.
export function budgetFit(person, role) {
  if (role.budgetMax === null || role.budgetMax === undefined) return "no_budget";
  const floor = person.salaryMin ?? person.salaryMax;
  if (floor === null || floor === undefined) return "unknown";
  const theirs = person.salaryCurrency || "GBP";
  const ours = role.budgetCurrency || "GBP";
  if (theirs !== ours) return "unknown";
  return floor > role.budgetMax ? "over" : "fits";
}

// Best first, at most `limit`. People above the budget are left out; ties go
// to whoever was confirmed most recently, then by name, so the order is stable.
/**
 * @template {{ fullName: string, searchText: string, salaryMin?: number | null, salaryMax?: number | null, salaryCurrency?: string | null, factsConfirmedAt?: Date | null }} T
 * @param {T[]} people
 * @param {string[]} terms
 * @param {{ budgetMax?: number | null, budgetCurrency?: string | null }} role
 * @param {number} [limit]
 * @returns {{ person: T, score: number, hits: string[], budget: string }[]}
 */
export function rankMatches(people, terms, role, limit = MATCH_LIMIT) {
  if (!terms.length) return [];
  return people
    .map((person) => ({ person, ...scorePerson(person.searchText, terms), budget: budgetFit(person, role) }))
    .filter((match) => match.score > 0 && match.budget !== "over")
    .sort((a, b) =>
      b.score - a.score ||
      (b.person.factsConfirmedAt?.getTime?.() ?? 0) - (a.person.factsConfirmedAt?.getTime?.() ?? 0) ||
      String(a.person.fullName).localeCompare(String(b.person.fullName)))
    .slice(0, limit);
}

// --- People search ----------------------------------------------------------

export const REMOTE_FILTERS = ["onsite", "hybrid", "remote", "flexible"];
export const RTW_FILTERS = ["has_right", "needs_sponsorship", "unknown"];
export const FRESH_MONTHS = [3, 6, 12];

// The filters in the address of /people. Anything unreadable is dropped.
export function parsePeopleFilters(params) {
  const one = (name) => {
    const value = params[name];
    return String(Array.isArray(value) ? value[0] : value ?? "").trim();
  };
  const notice = Number(one("notice"));
  const fresh = Number(one("fresh"));
  return {
    q: one("q").slice(0, 120),
    maxSalary: parseMoney(one("salary")),
    maxNotice: one("notice") && Number.isInteger(notice) && notice >= 0 && notice <= 104 ? notice : null,
    remote: REMOTE_FILTERS.includes(one("remote")) ? one("remote") : null,
    rightToWork: RTW_FILTERS.includes(one("rtw")) ? one("rtw") : null,
    freshMonths: FRESH_MONTHS.includes(fresh) ? fresh : null,
  };
}

export function hasFactFilters(filters) {
  return filters.maxSalary !== null || filters.maxNotice !== null || filters.remote !== null || filters.rightToWork !== null || filters.freshMonths !== null;
}

// Search words: each must appear somewhere in the person's text.
export function searchWords(q) {
  return normalise(q).split(" ").filter((word) => word.length >= 2).slice(0, 8);
}

// --- Revisits and age -------------------------------------------------------

const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, few: 3 };

function addMonths(now, months) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate()));
  return date.toISOString().slice(0, 10);
}

// The date a candidate's own words point at ("in about six months", "next
// year", "after Christmas"), for the recruiter to confirm or change. Null when
// the words do not name a time.
export function suggestRevisitDate(hint, now = new Date()) {
  const text = normalise(hint);
  if (!text) return null;
  const counted = text.match(/\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few)\s+(?:of\s+)?(week|month|year)s?\b/);
  if (counted) {
    const n = /\d/.test(counted[1]) ? Number(counted[1]) : NUMBER_WORDS[counted[1]];
    if (counted[2] === "week") return new Date(now.getTime() + n * 7 * DAY_MS).toISOString().slice(0, 10);
    return addMonths(now, counted[2] === "year" ? n * 12 : n);
  }
  if (/\bnext year\b|\bnew year\b|\bafter christmas\b/.test(text)) {
    return `${now.getUTCFullYear() + 1}-01-15`;
  }
  if (/\bnext month\b/.test(text)) return addMonths(now, 1);
  if (/\bnext quarter\b/.test(text)) return addMonths(now, 3);
  return null;
}

export function factsAreStale(factsConfirmedAt, now = new Date()) {
  return Boolean(factsConfirmedAt) && now.getTime() - new Date(factsConfirmedAt).getTime() > STALE_FACT_DAYS * DAY_MS;
}

export function reviewCutoff(now = new Date()) {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - REVIEW_MONTHS);
  return date;
}

// A date typed as YYYY-MM-DD, as a UTC midnight, or null.
export function readDate(text) {
  const value = String(text ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}
