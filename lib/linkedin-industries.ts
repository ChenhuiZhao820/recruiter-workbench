// LinkedIn's own industry taxonomy (industries-v2), vendored from LinkedIn's
// published reference table. 487 entries, each with the id LinkedIn's filters
// use and the exact label they show. Nothing here is fetched at runtime: the
// table ships with the app and only changes when someone updates the file.
//
// This exists so the recruiter never has to translate their own vocabulary
// into LinkedIn's. They type what they mean, pick from LinkedIn's real list,
// and what gets stored is what LinkedIn will recognise.

import table from "@/lib/linkedin-industries.json";

export type Industry = { id: string; label: string; path: string };

export const INDUSTRIES = table as Industry[];

const BY_ID = new Map(INDUSTRIES.map((i) => [i.id, i]));

export function industryById(id: string): Industry | undefined {
  return BY_ID.get(id);
}

// How a recruiter writes it, on the left. LinkedIn does not accept any of
// these, so a plain substring search would return nothing and the picker would
// look broken for the most ordinary words in the trade.
const ALIASES: Record<string, string> = {
  pharma: "pharmaceutical",
  biotech: "biotechnology",
  auto: "automotive",
  automotive: "motor vehicle",
  fintech: "financial services",
  it: "information technology",
  tech: "technology",
  ai: "software development",
  logistics: "transportation logistics supply chain",
  freight: "freight logistics",
  fmcg: "consumer goods",
  cpg: "consumer goods",
  telco: "telecommunications",
  telecoms: "telecommunications",
  oil: "oil gas",
  "oil and gas": "oil gas",
  energy: "utilities oil gas renewable",
  renewables: "renewable energy",
  mining: "mining metals",
  construction: "construction building",
  property: "real estate",
  legal: "law legal",
  accounting: "accounting",
  insurance: "insurance",
  banking: "banking",
  healthcare: "hospitals health care",
  health: "hospitals health care",
  medtech: "medical equipment",
  education: "education",
  charity: "non-profit",
  nonprofit: "non-profit",
  ngo: "non-profit",
  gaming: "computer games",
  games: "computer games",
  media: "media",
  ecommerce: "retail internet",
  retail: "retail",
  aerospace: "aviation aerospace",
  defence: "defense space",
  defense: "defense space",
  marine: "maritime",
  agri: "farming agriculture",
  agriculture: "farming agriculture",
  food: "food beverage",
  drinks: "beverage",
  hospitality: "hospitality",
  travel: "travel",
  recruitment: "staffing recruiting",
  hr: "human resources",
  consulting: "consulting",
  manufacturing: "manufacturing",
  engineering: "engineering",
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function expand(query: string): string[] {
  const norm = normalize(query);
  const terms = [norm];
  const alias = ALIASES[norm];
  if (alias) terms.push(normalize(alias));
  // Also expand a single word inside a longer phrase ("pharma sales" -> pharmaceutical).
  for (const word of norm.split(" ")) {
    const wordAlias = ALIASES[word];
    if (wordAlias) terms.push(normalize(wordAlias));
  }
  return terms;
}

function scoreOne(industry: Industry, term: string): number {
  if (!term) return 0;
  const label = normalize(industry.label);
  const path = normalize(industry.path);
  if (label === term) return 1000;
  if (label.startsWith(term)) return 800 - label.length;
  if (label.includes(term)) return 600 - label.length;

  // Every word of the query somewhere in the label beats a partial hit, so
  // "machinery manufacturing" finds Industrial Machinery Manufacturing.
  const words = term.split(" ").filter(Boolean);
  if (words.length > 1 && words.every((w) => label.includes(w))) return 500 - label.length;
  // The hierarchy path is how a broad word reaches its children: "manufacturing"
  // has a top-level group of that name and 80-odd industries beneath it.
  if (words.every((w) => path.includes(w))) return 300 - path.length / 10;
  if (words.some((w) => w.length > 3 && path.includes(w))) return 150 - path.length / 10;
  return 0;
}

// Best matches for what the recruiter typed, LinkedIn's own entries only.
export function matchIndustries(query: string, limit = 8): Industry[] {
  const terms = expand(query);
  if (!terms[0]) return [];
  return INDUSTRIES.map((industry) => ({
    industry,
    score: Math.max(...terms.map((term) => scoreOne(industry, term))),
  }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.industry.label.localeCompare(b.industry.label))
    .slice(0, limit)
    .map((hit) => hit.industry);
}

// --- storage -----------------------------------------------------------------
//
// Saved searches keep their industries in one JSON column. Records written
// before the picker existed hold plain strings - the recruiter's own words,
// with no id behind them. Those stay readable, and keep working as a chip,
// until someone edits the search and picks the real entries.

export type SavedIndustry = { id?: string; label: string };

export function parseIndustries(json: string | null | undefined): SavedIndustry[] {
  if (!json) return [];
  try {
    const value = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value
      .map((entry): SavedIndustry | null => {
        if (typeof entry === "string") return entry.trim() ? { label: entry.trim() } : null;
        if (entry && typeof entry === "object" && typeof entry.label === "string") {
          const id = typeof entry.id === "string" ? entry.id : undefined;
          return { ...(id ? { id } : {}), label: entry.label };
        }
        return null;
      })
      .filter((entry): entry is SavedIndustry => entry !== null);
  } catch {
    return [];
  }
}

export function serializeIndustries(entries: SavedIndustry[]): string {
  return JSON.stringify(entries);
}

export function industryIds(entries: SavedIndustry[]): string[] {
  return entries.map((entry) => entry.id).filter((id): id is string => Boolean(id));
}
