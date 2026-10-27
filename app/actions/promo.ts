"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { takeAuthAttempt } from "@/lib/auth";
import { requireOwnAccount } from "@/lib/workspace";
import { getAccountTier } from "@/lib/account-tiers";
import { formatDay } from "@/lib/billing-core.mjs";
import { PROMO, decidePromo, promoDeadlineText, promoEndsAt } from "@/lib/promo-core.mjs";
import { trialKeyForEmail } from "@/lib/signup-core.mjs";
import { recordUsage } from "@/lib/usage";

export type PromoState = { error?: string };

// Redeeming the promo code, from the billing page. The account's own, plan or
// not (an account with no plan is who it is most for), never an
// administrator's read-only view. Everything is decided again here from the
// database; the page only sends what was typed. Nothing is sent to Stripe.
// A refusal is answered beside the field; success goes to the overview, which
// says what changed (the form itself is gone once the code is redeemed).
export async function redeemPromoCode(_previous: PromoState, form: FormData): Promise<PromoState> {
  const user = await requireOwnAccount();
  if (!await takeAuthAttempt(`promo:${user.id}`, 10, 60 * 60)) return { error: "Too many tries. Try again in an hour." };
  const code = String(form.get("code") ?? "").slice(0, 100);
  const now = new Date();
  const keyHash = trialKeyForEmail(user.email);

  let decision: ReturnType<typeof decidePromo>;
  let until: Date | null = null;
  try {
    ({ decision, until } = await db.$transaction(async (tx) => {
      const account = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          role: true, accountTier: true, trialExpiresAt: true, signupSource: true, billingPlan: true, billingStatus: true, billingPastDueSince: true,
          promoProFrom: true, promoProUntil: true, createdAt: true,
        },
      });
      const claimed = await tx.promoRedemption.findUnique({ where: { promoId_keyHash: { promoId: PROMO.id, keyHash } }, select: { id: true } });
      const decision = decidePromo({
        code, tier: getAccountTier(account, now), createdAt: account.createdAt, trialExpiresAt: account.trialExpiresAt,
        used: Boolean(claimed || account.promoProUntil), now, endsAt: promoEndsAt(),
      });
      if (decision.outcome !== "granted") return { decision, until: account.promoProUntil };
      await tx.promoRedemption.create({ data: { promoId: PROMO.id, keyHash } });
      await tx.user.update({ where: { id: user.id }, data: { promoProFrom: decision.from, promoProUntil: decision.until } });
      await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "promo.redeemed" } });
      await recordUsage(tx, user.id, "promo_redeemed");
      return { decision, until: decision.until };
    }, { isolationLevel: "Serializable" }));
  } catch (error) {
    // Two presses at once: the other one redeemed it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return { error: "You've already used this code." };
    }
    throw error;
  }

  switch (decision.outcome) {
    case "invalid": return { error: "That code isn't valid. Check it and try again." };
    case "expired": return { error: `This code expired on ${promoDeadlineText(promoEndsAt())} (UK time).` };
    case "used": return { error: until
      ? `You've already used this code. Your free Pro ${until > now ? "runs" : "ran"} until ${formatDay(until)}.`
      : "You've already used this code." };
    case "has_pro": return { error: "Your plan already includes Pro, so there is nothing to add. The code has not been used." };
    case "trial_long": return { error: "Your trial already runs for 30 days or more, so there is nothing to add. The code has not been used." };
  }
  revalidatePath("/", "layout");
  redirect(`/billing?tab=overview&promo=${decision.extendedTrial ? "trial" : "done"}`);
}
