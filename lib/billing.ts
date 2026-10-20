import Stripe from "stripe";
import { db } from "@/lib/db";
import { CHECKOUT_PLANS, LIVE_STATUSES, customerId, priceFor, shouldApply, subscriptionFields } from "@/lib/billing-core.mjs";

// Stripe holds the card and the subscription; Retrivr keeps a copy of what it
// means on the user row, written only here, from Stripe's own answer: every
// webhook re-reads the subscription from Stripe rather than trusting the
// event's body, so events arriving twice or out of order end in the same
// state. getAccountTier (lib/account-tiers.ts) reads that copy.
//
// STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and the STRIPE_PRICE_<PLAN>_<INTERVAL>
// price ids configure it; STRIPE_TAX=1 turns on Stripe Tax at checkout. Outside
// production CAPTURE_TEST_STRIPE_BASE_URL sends every call to the local stub.

export function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) &&
    CHECKOUT_PLANS.some((plan) => priceFor(plan, "monthly") || priceFor(plan, "yearly"));
}

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Billing is not set up on this server.");
  if (!client) {
    const testBase = process.env.NODE_ENV !== "production" ? process.env.CAPTURE_TEST_STRIPE_BASE_URL : undefined;
    const base = testBase ? new URL(testBase) : null;
    client = new Stripe(process.env.STRIPE_SECRET_KEY, {
      maxNetworkRetries: 1,
      timeout: 10_000,
      ...(base ? { host: base.hostname, port: Number(base.port), protocol: base.protocol.replace(":", "") as "http" | "https" } : {}),
    });
  }
  return client;
}

// Applies the subscription as Stripe has it now to the account it belongs to.
export async function syncSubscription(subscriptionId: string, fallbackUserId?: string | null) {
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  const customer = customerId(subscription.customer);
  const metadataUser = typeof subscription.metadata?.userId === "string" ? subscription.metadata.userId : null;
  // The Stripe customer decides whose subscription it is. Only a customer
  // Retrivr has never seen may be linked, and only to an account that has no
  // customer yet: the one Checkout named.
  const select = { id: true, stripeCustomerId: true, stripeSubscriptionId: true, billingStatus: true, billingPastDueSince: true } as const;
  const known = customer ? await db.user.findUnique({ where: { stripeCustomerId: customer }, select }) : null;
  const linked = known ?? await db.user.findUnique({ where: { stripeSubscriptionId: subscription.id }, select });
  const candidateId = metadataUser ?? fallbackUserId;
  const user = linked ?? (candidateId && (!fallbackUserId || !metadataUser || fallbackUserId === metadataUser)
    ? await db.user.findFirst({ where: { id: candidateId, stripeCustomerId: null }, select })
    : null);
  if (!user) return null;
  if (!shouldApply(subscription, user)) return user.id;
  await db.user.update({
    where: { id: user.id },
    data: { ...(user.stripeCustomerId ? {} : { stripeCustomerId: customer }), ...subscriptionFields(subscription, user) },
  });
  return user.id;
}

export function hasLiveSubscription(user: { stripeSubscriptionId: string | null; billingStatus: string | null }) {
  return Boolean(user.stripeSubscriptionId && LIVE_STATUSES.includes(user.billingStatus ?? ""));
}
