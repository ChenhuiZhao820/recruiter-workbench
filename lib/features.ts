import { PLAN_RANK, getAccountTier, type AccountTier, type TierAccount } from "./account-tiers";

// The one place that says which plan a feature belongs to, matching the
// homepage's pricing table. Nothing else in the app compares plans: pages,
// actions, routes and navigation ask canUseFeature (or the guards in
// feature-access.ts) about a named feature, and the tier tests are generated
// from this table. Moving a feature between plans is a change to one line here.
export const FEATURE_TIERS = {
  people: "lite",           // person records and the people list by name
  peopleImport: "basic",    // bringing people in from an Excel or CSV file
  privacy: "lite",          // delete, do not contact, suppression
  export: "lite",           // full data export
  booking: "lite",          // booking page and its settings
  calendarFreeBusy: "lite",
  followUpRuns: "lite",     // walking through everyone due a follow-up; Lite has a limit below
  replySuggestions: "pro",  // a suggested answer to someone who replied
  emailFinder: "pro",       // a person's work email found through Enrow; the allowance is per plan
  screening: "basic",       // screening assistant; the monthly allowance is per plan
  clientEmail: "pro",       // "one-click sign-off to clients"
  peopleSearch: "basic",    // filters and keyword search across people
  talentMatches: "basic",   // filing a matched person against a role
  revisitReminders: "basic",
  instantMatch: "basic",    // a brief in, people from your own database out
  clientShortlists: "lite", // client links and shortlists; a limit below Pro
} as const satisfies Record<string, "lite" | "basic" | "pro">;

export type Feature = keyof typeof FEATURE_TIERS;

export const FEATURES = Object.keys(FEATURE_TIERS) as Feature[];

export function isFeature(value: string): value is Feature {
  return Object.prototype.hasOwnProperty.call(FEATURE_TIERS, value);
}

// An account with no plan still reads what every plan has, so its work stays
// in view; lib/workspace.ts makes that view read-only.
function effectiveRank(tier: AccountTier): number {
  return tier === "none" ? PLAN_RANK.lite : PLAN_RANK[tier];
}

export function canUseFeature(account: TierAccount & { active: boolean }, feature: Feature, now = new Date()): boolean {
  if (!account.active) return false;
  return effectiveRank(getAccountTier(account, now)) >= PLAN_RANK[FEATURE_TIERS[feature]];
}

// How many custom shortlists an account may have active at once; null means no
// limit. A role's own client link never counts, and reaching the limit only
// refuses a new one: links already sent keep working after a downgrade or the
// end of a trial.
export const SHORTLIST_LIMITS = { belowPro: 3, pro: null } as const;

export function activeShortlistLimit(account: TierAccount & { active: boolean }, now = new Date()): number | null {
  return account.active && effectiveRank(getAccountTier(account, now)) >= PLAN_RANK.pro ? SHORTLIST_LIMITS.pro : SHORTLIST_LIMITS.belowPro;
}

// Lite has "batch follow-up"; Basic and above have it unlimited. A Lite run
// takes this many people at a time.
export const LITE_FOLLOWUP_RUN_LIMIT = 10;

export function followUpRunLimit(account: TierAccount & { active: boolean }, now = new Date()): number | null {
  return account.active && effectiveRank(getAccountTier(account, now)) >= PLAN_RANK.basic ? null : LITE_FOLLOWUP_RUN_LIMIT;
}

// Monthly allowances per plan, for the AI features and the email finder. A
// deployment may lower them all with the CAPTURE_*_MONTHLY_CAP variables (see
// the *MonthlyCap functions), never raise them. The trial's email searches
// last the whole trial rather than a month (lib/enrow-core.mjs).
export const MONTHLY_QUOTAS: Record<"screening" | "replies" | "matches" | "emails", Record<AccountTier, number>> = {
  screening: { none: 0, lite: 0, basic: 30, trial: 10, pro: 120, promax: 300, admin: 120 },
  replies: { none: 0, lite: 0, basic: 0, trial: 30, pro: 300, promax: 300, admin: 300 },
  matches: { none: 0, lite: 0, basic: 300, trial: 30, pro: 300, promax: 300, admin: 300 },
  emails: { none: 0, lite: 0, basic: 0, trial: 50, pro: 250, promax: 1000, admin: 1000 },
};

export function monthlyQuota(account: TierAccount, kind: keyof typeof MONTHLY_QUOTAS, ceiling: number | null, now = new Date()): number {
  const quota = MONTHLY_QUOTAS[kind][getAccountTier(account, now)];
  return ceiling === null ? quota : Math.min(quota, ceiling);
}
