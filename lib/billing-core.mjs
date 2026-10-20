// Billing rules shared by the server and the unit tests (tests/billing.test.mjs):
// which Stripe price is which plan, and what a Stripe subscription means for
// the account. No network, no database.

// Plans sold through Stripe Checkout. Pro Max is "Contact us": an
// administrator grants it, or it is a subscription made in Stripe by hand
// with its own price (STRIPE_PRICE_PROMAX_*), which the webhook still reads.
export const CHECKOUT_PLANS = ["lite", "basic", "pro"];
export const ALL_PRICED_PLANS = ["lite", "basic", "pro", "promax"];
export const INTERVALS = ["monthly", "yearly"];

export function priceEnvName(plan, interval) {
  return `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;
}

export function priceTable(env = process.env) {
  const table = {};
  for (const plan of ALL_PRICED_PLANS) {
    for (const interval of INTERVALS) {
      const id = env[priceEnvName(plan, interval)]?.trim();
      if (id && /^price_[A-Za-z0-9]+$/.test(id)) table[id] = { plan, interval };
    }
  }
  return table;
}

export function priceFor(plan, interval, env = process.env) {
  if (!ALL_PRICED_PLANS.includes(plan) || !INTERVALS.includes(interval)) return null;
  return Object.entries(priceTable(env)).find(([, value]) => value.plan === plan && value.interval === interval)?.[0] ?? null;
}

export const LIVE_STATUSES = ["active", "trialing", "past_due"];

// What the user row should say after reading this subscription. A price this
// deployment does not know leaves the plan empty, so it grants nothing.
export function subscriptionFields(subscription, previous, env = process.env, now = new Date()) {
  const item = subscription.items?.data?.[0];
  const known = item?.price?.id ? priceTable(env)[item.price.id] : undefined;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end ?? null;
  const pastDue = subscription.status === "past_due";
  return {
    stripeSubscriptionId: subscription.id,
    billingPlan: known?.plan ?? null,
    billingInterval: known?.interval ?? null,
    billingStatus: subscription.status,
    billingPeriodEnd: typeof periodEnd === "number" ? new Date(periodEnd * 1000) : null,
    billingCancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
    billingPastDueSince: pastDue ? previous?.billingPastDueSince ?? now : null,
    billingSyncedAt: now,
  };
}

// An old subscription finishing must not wipe out a newer one that is live.
export function shouldApply(subscription, previous) {
  if (!previous?.stripeSubscriptionId || previous.stripeSubscriptionId === subscription.id) return true;
  if (LIVE_STATUSES.includes(subscription.status)) return true;
  return !LIVE_STATUSES.includes(previous.billingStatus ?? "");
}

export function customerId(value) {
  return typeof value === "string" ? value : typeof value?.id === "string" ? value.id : null;
}
