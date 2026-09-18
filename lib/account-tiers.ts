export type RecruiterTier = "basic" | "pro" | "trial";
export type AccountTier = "admin" | RecruiterTier;

export type TierAccount = {
  role: string;
  accountTier: string;
  trialExpiresAt: Date | null;
};

export const accountTierLabels: Record<AccountTier, string> = { admin: "Admin", pro: "Pro", trial: "Trial", basic: "Basic" };

export function getAccountTier(account: TierAccount, now = new Date()): AccountTier {
  if (account.role === "admin") return "admin";
  if (account.role !== "recruiter") return "basic";
  if (account.accountTier === "pro") return "pro";
  if (account.accountTier === "trial" && account.trialExpiresAt && account.trialExpiresAt > now) return "trial";
  return "basic";
}

export function canUseProFeatures(account: TierAccount & { active: boolean }, now = new Date()): boolean {
  return account.active && getAccountTier(account, now) !== "basic";
}

export function parseAccountTier(accountTier: unknown, expiry: unknown, now = new Date()):
  { data: { accountTier: RecruiterTier; trialExpiresAt: Date | null }; error?: never } | { error: string; data?: never } {
  if (accountTier !== "basic" && accountTier !== "pro" && accountTier !== "trial") return { error: "Choose Basic, Pro or Trial." };
  if (accountTier !== "trial") return { data: { accountTier, trialExpiresAt: null } };
  if (typeof expiry !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(expiry)) return { error: "Enter a valid trial expiry date and time in UTC." };
  const trialExpiresAt = new Date(`${expiry}:00.000Z`);
  if (!Number.isFinite(trialExpiresAt.getTime()) || trialExpiresAt.toISOString().slice(0, 16) !== expiry) return { error: "Enter a valid trial expiry date and time in UTC." };
  if (trialExpiresAt <= now) return { error: "Trial expiry must be in the future." };
  return { data: { accountTier, trialExpiresAt } };
}
