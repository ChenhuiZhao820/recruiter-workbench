import { db } from "./db";
import type { TierAccount } from "./account-tiers";
import { canUseFeature, monthlyQuota, type Feature } from "./features";
import { emailAllowance } from "./email-finder";
import { enrowKey } from "./enrow-core.mjs";
import { PAID_KINDS, nextMonthStart } from "./match";
import { matchMonthlyCap } from "./match-core.mjs";
import { replyMonthlyCap } from "./reply-model.mjs";
import { monthKey, screeningMonthlyCap } from "./screening-core.mjs";

// This month's allowances, as the billing page shows them: the same counts the
// features themselves refuse by, read here and never written. Only what the
// plan includes is listed.

export type UsageLine = { key: string; label: string; used: number; quota: number; wholeTrial?: boolean };

export async function billingUsage(account: TierAccount & { id: string; active: boolean }, now = new Date()) {
  const has = (feature: Feature) => canUseFeature(account, feature, now);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lines: UsageLine[] = [];

  if (has("screening")) {
    const row = await db.aiUsage.findUnique({ where: { userId_month: { userId: account.id, month: monthKey(now) } }, select: { generations: true } });
    lines.push({ key: "screening", label: "Screening summaries", used: row?.generations ?? 0, quota: monthlyQuota(account, "screening", screeningMonthlyCap(), now) });
  }
  if (has("emailFinder") && enrowKey()) {
    const allowance = await emailAllowance(account, db, now);
    lines.push({ key: "emails", label: "Email finder searches", used: allowance.used, quota: allowance.quota, wholeTrial: allowance.trial });
  }
  if (has("instantMatch")) {
    const used = await db.usageEvent.count({ where: { userId: account.id, kind: { in: [...PAID_KINDS] }, at: { gte: monthStart } } });
    lines.push({ key: "matches", label: "Instant Match briefs", used, quota: monthlyQuota(account, "matches", matchMonthlyCap(), now) });
  }
  if (has("replySuggestions")) {
    const used = await db.usageEvent.count({ where: { userId: account.id, kind: "reply_suggested", at: { gte: monthStart } } });
    lines.push({ key: "replies", label: "Reply suggestions", used, quota: monthlyQuota(account, "replies", replyMonthlyCap(), now) });
  }
  return { lines, resets: nextMonthStart(now) };
}
