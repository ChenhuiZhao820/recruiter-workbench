import { canUseProFeatures, type TierAccount } from "./account-tiers";

// The one place that says which tier a feature belongs to. The Basic/Pro split
// is not final, so nothing else in the app compares tiers: pages, actions,
// routes and navigation ask canUseFeature (or the guards in feature-access.ts)
// about a named feature, and the tier tests are generated from this table.
// Moving a feature between tiers is a change to one line here.
export const FEATURE_TIERS = {
  people: "basic",          // person records and the people list by name
  peopleImport: "basic",    // bringing people in from an Excel or CSV file
  privacy: "basic",         // delete, do not contact, suppression
  export: "basic",          // full data export
  booking: "basic",         // booking page and its settings
  calendarFreeBusy: "basic",
  followUpRuns: "basic",    // walking through everyone due a follow-up
  replySuggestions: "basic", // a suggested answer to someone who replied
  screening: "pro",         // screening assistant
  clientEmail: "pro",
  peopleSearch: "pro",      // filters and keyword search across people
  talentMatches: "pro",     // "From your database" on a role
  revisitReminders: "pro",
  instantMatch: "pro",      // a brief in, people from your own database out
  clientShortlists: "basic", // client links and shortlists; Basic has a limit below
} as const satisfies Record<string, "basic" | "pro">;

export type Feature = keyof typeof FEATURE_TIERS;

export const FEATURES = Object.keys(FEATURE_TIERS) as Feature[];

export function isFeature(value: string): value is Feature {
  return Object.prototype.hasOwnProperty.call(FEATURE_TIERS, value);
}

export function canUseFeature(account: TierAccount & { active: boolean }, feature: Feature, now = new Date()): boolean {
  if (!account.active) return false;
  return FEATURE_TIERS[feature] === "basic" || canUseProFeatures(account, now);
}

// How many custom shortlists an account may have active at once, by whether it
// has Pro features; null means no limit. A role's own client link never
// counts, and reaching the limit only refuses a new one: links already sent
// keep working after a downgrade or the end of a trial.
export const SHORTLIST_LIMITS = { basic: 3, pro: null } as const;

export function activeShortlistLimit(account: TierAccount & { active: boolean }, now = new Date()): number | null {
  return canUseProFeatures(account, now) ? SHORTLIST_LIMITS.pro : SHORTLIST_LIMITS.basic;
}
