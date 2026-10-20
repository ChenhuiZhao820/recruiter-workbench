// What an account is entitled to, decided in one place and recomputed on every
// request. The paid plans are the homepage's: Lite, Basic, Pro and Pro Max.
// An account reaches one of them by paying (Stripe, kept on the user row by
// the billing webhook), by an administrator granting it (accountTier, which is
// how beta accounts made by hand keep what they had), or for seven days as a
// Pro trial. A self-serve account with none of those has no plan: it can still
// sign in, read, export and delete, but not work (see lib/workspace.ts).

export const PAID_PLANS = ["lite", "basic", "pro", "promax"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
// What an administrator can store in accountTier.
export type RecruiterTier = PaidPlan | "trial";
export type AccountTier = "admin" | PaidPlan | "trial" | "none";

export type TierAccount = {
  role: string;
  accountTier: string;
  trialExpiresAt: Date | null;
  signupSource?: string | null;
  billingPlan?: string | null;
  billingStatus?: string | null;
  billingPastDueSince?: Date | null;
};

export const accountTierLabels: Record<AccountTier, string> = {
  admin: "Admin", promax: "Pro Max", pro: "Pro", basic: "Basic", lite: "Lite", trial: "Pro trial", none: "No plan",
};

// A trial is the Pro feature set with its own, smaller AI allowances.
export const PLAN_RANK: Record<AccountTier, number> = { none: 0, lite: 1, basic: 2, pro: 3, trial: 3, promax: 4, admin: 5 };

export const TRIAL_DAYS = 7;
// A failed renewal keeps the plan this long while Stripe retries the card.
export const PAST_DUE_GRACE_DAYS = 7;

export function isPaidPlan(value: unknown): value is PaidPlan {
  return typeof value === "string" && (PAID_PLANS as readonly string[]).includes(value);
}

// The plan Stripe says is paid for, or null.
export function billedPlan(account: TierAccount, now = new Date()): PaidPlan | null {
  if (!isPaidPlan(account.billingPlan)) return null;
  if (account.billingStatus === "active" || account.billingStatus === "trialing") return account.billingPlan;
  if (account.billingStatus === "past_due" && account.billingPastDueSince &&
      now.getTime() - account.billingPastDueSince.getTime() < PAST_DUE_GRACE_DAYS * 86_400_000) return account.billingPlan;
  return null;
}

export function getAccountTier(account: TierAccount, now = new Date()): AccountTier {
  if (account.role === "admin") return "admin";
  if (account.role !== "recruiter") return "none";
  const billed = billedPlan(account, now);
  if (billed) return billed;
  if (account.accountTier === "trial" && account.trialExpiresAt && account.trialExpiresAt > now) return "trial";
  if (isPaidPlan(account.accountTier)) return account.accountTier;
  // Accounts an administrator made keep Basic when a trial they were given
  // ends, as they always have. A self-serve account has nothing to fall back to.
  return account.signupSource === "self" ? "none" : "basic";
}

export function hasPlan(account: TierAccount & { active: boolean }, now = new Date()): boolean {
  return account.active && getAccountTier(account, now) !== "none";
}

export function canUseProFeatures(account: TierAccount & { active: boolean }, now = new Date()): boolean {
  return account.active && PLAN_RANK[getAccountTier(account, now)] >= PLAN_RANK.pro;
}

export function trialEndsAt(now = new Date()): Date {
  return new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
}

export function parseAccountTier(accountTier: unknown, expiry: unknown, now = new Date()):
  { data: { accountTier: RecruiterTier; trialExpiresAt: Date | null }; error?: never } | { error: string; data?: never } {
  if (!isPaidPlan(accountTier) && accountTier !== "trial") return { error: "Choose Lite, Basic, Pro, Pro Max or Trial." };
  if (accountTier !== "trial") return { data: { accountTier, trialExpiresAt: null } };
  if (typeof expiry !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(expiry)) return { error: "Enter a valid trial expiry date and time in UTC." };
  const trialExpiresAt = new Date(`${expiry}:00.000Z`);
  if (!Number.isFinite(trialExpiresAt.getTime()) || trialExpiresAt.toISOString().slice(0, 16) !== expiry) return { error: "Enter a valid trial expiry date and time in UTC." };
  if (trialExpiresAt <= now) return { error: "Trial expiry must be in the future." };
  return { data: { accountTier, trialExpiresAt } };
}
