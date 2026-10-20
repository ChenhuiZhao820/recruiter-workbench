import test from "node:test";
import assert from "node:assert/strict";
import { CHECKOUT_PLANS, priceFor, priceTable, shouldApply, subscriptionFields } from "../lib/billing-core.mjs";

const env = {
  STRIPE_PRICE_LITE_MONTHLY: "price_LiteM", STRIPE_PRICE_LITE_YEARLY: "price_LiteY",
  STRIPE_PRICE_BASIC_MONTHLY: "price_BasicM", STRIPE_PRICE_PRO_MONTHLY: "price_ProM", STRIPE_PRICE_PRO_YEARLY: "price_ProY",
  STRIPE_PRICE_PROMAX_MONTHLY: "price_MaxM", STRIPE_PRICE_BASIC_YEARLY: "not a price id",
};
const now = new Date("2026-10-24T12:00:00.000Z");
const subscription = (overrides = {}) => ({
  id: "sub_1", status: "active", customer: "cus_1", cancel_at_period_end: false, cancel_at: null,
  items: { data: [{ price: { id: "price_ProM" }, current_period_end: 1_800_000_000 }] }, ...overrides,
});

test("prices map to plans and back; malformed ids are ignored", () => {
  assert.deepEqual(priceTable(env).price_ProY, { plan: "pro", interval: "yearly" });
  assert.equal(priceTable(env)["not a price id"], undefined);
  assert.equal(priceFor("basic", "monthly", env), "price_BasicM");
  assert.equal(priceFor("basic", "yearly", env), null);
  assert.equal(priceFor("enterprise", "monthly", env), null);
  assert.equal(priceFor("pro", "weekly", env), null);
  assert.deepEqual(CHECKOUT_PLANS, ["lite", "basic", "pro"], "Pro Max is not sold through Checkout");
});

test("a subscription becomes the plan, its interval, status and period end", () => {
  const fields = subscriptionFields(subscription(), null, env, now);
  assert.equal(fields.billingPlan, "pro");
  assert.equal(fields.billingInterval, "monthly");
  assert.equal(fields.billingStatus, "active");
  assert.equal(fields.billingPeriodEnd.toISOString(), new Date(1_800_000_000 * 1000).toISOString());
  assert.equal(fields.billingPastDueSince, null);
  assert.equal(fields.billingCancelAtPeriodEnd, false);
  assert.equal(subscriptionFields(subscription({ cancel_at_period_end: true }), null, env, now).billingCancelAtPeriodEnd, true);
  assert.equal(subscriptionFields(subscription({ cancel_at: 1_800_000_000 }), null, env, now).billingCancelAtPeriodEnd, true);
  // A price this deployment does not know grants nothing.
  const unknown = subscriptionFields(subscription({ items: { data: [{ price: { id: "price_Other" } }] } }), null, env, now);
  assert.equal(unknown.billingPlan, null);
  assert.equal(subscriptionFields(subscription({ items: { data: [{ price: { id: "price_MaxM" } }] } }), null, env, now).billingPlan, "promax");
});

test("past due keeps the date it started, so the grace period does not restart on every event", () => {
  const first = subscriptionFields(subscription({ status: "past_due" }), null, env, now);
  assert.equal(first.billingPastDueSince, now);
  const earlier = new Date("2026-10-20T00:00:00.000Z");
  assert.equal(subscriptionFields(subscription({ status: "past_due" }), { billingPastDueSince: earlier }, env, now).billingPastDueSince, earlier);
  assert.equal(subscriptionFields(subscription({ status: "active" }), { billingPastDueSince: earlier }, env, now).billingPastDueSince, null);
});

test("an old subscription ending never wipes out a newer live one", () => {
  const live = { stripeSubscriptionId: "sub_new", billingStatus: "active" };
  assert.equal(shouldApply(subscription({ id: "sub_old", status: "canceled" }), live), false);
  assert.equal(shouldApply(subscription({ id: "sub_new", status: "canceled" }), live), true);
  assert.equal(shouldApply(subscription({ id: "sub_other", status: "active" }), live), true);
  assert.equal(shouldApply(subscription({ id: "sub_old", status: "canceled" }), { stripeSubscriptionId: "sub_new", billingStatus: "canceled" }), true);
  assert.equal(shouldApply(subscription(), null), true);
});
