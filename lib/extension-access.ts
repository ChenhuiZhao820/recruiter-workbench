import { hasPlan, type TierAccount } from "@/lib/account-tiers";

// The extension is part of every plan and of the trial; there is no separate
// activation. What makes a copy useful is an extension key, which only an account
// with a plan can generate (Settings) and which stops working the moment the
// plan does (app/api/capture). A forwarded ZIP holds no key and no account, so
// it saves nothing for whoever installs it until they have a plan of their own.
export function canUseExtension(user: TierAccount & { active: boolean }, now = new Date()): boolean {
  return user.active && (user.role === "admin" || hasPlan(user, now));
}
