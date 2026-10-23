import test from "node:test";
import assert from "node:assert/strict";
import { CHECKOUT_PLANS, billingDetails, formatAmount, formatDay, invoiceRow, listWords, portalFlow, priceFor, priceTable, shouldApply, stripeLink, subscriptionFields } from "../lib/billing-core.mjs";

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
  assert.deepEqual(CHECKOUT_PLANS, ["lite", "basic", "pro", "promax"], "every plan is sold through Checkout");
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

test("the portal opens only the three named flows", () => {
  assert.equal(portalFlow("update"), "update");
  assert.equal(portalFlow("cancel"), "cancel");
  assert.equal(portalFlow("payment"), "payment");
  for (const other of ["", "customer_update", "subscription_update_confirm", "UPDATE", null, undefined]) assert.equal(portalFlow(other), null);
});

test("links out go only to Stripe, and to loopback only outside production", () => {
  assert.equal(stripeLink("https://invoice.stripe.com/i/acct_1/test_x", true), "https://invoice.stripe.com/i/acct_1/test_x");
  assert.equal(stripeLink("https://pay.stripe.com/invoice/x/pdf", true), "https://pay.stripe.com/invoice/x/pdf");
  assert.equal(stripeLink("https://stripe.com.evil.example/x", true), null);
  assert.equal(stripeLink("https://evilstripe.com/x", true), null);
  assert.equal(stripeLink("http://invoice.stripe.com/x", true), null);
  assert.equal(stripeLink("javascript:alert(1)", false), null);
  assert.equal(stripeLink("http://localhost:8766/invoice/1", true), null);
  assert.equal(stripeLink("http://localhost:8766/invoice/1", false), "http://localhost:8766/invoice/1");
  assert.equal(stripeLink(null, false), null);
});

test("money and days read the way an invoice does", () => {
  assert.equal(formatAmount(2999, "gbp"), "£29.99");
  assert.equal(formatAmount(1700, "usd"), "US$17.00");
  assert.equal(formatAmount(500, "jpy"), "JP¥500");
  assert.equal(formatDay(new Date("2026-11-21T23:30:00.000Z")), "21 November 2026");
  assert.equal(listWords(["the street"]), "the street");
  assert.equal(listWords(["the street", "the city"]), "the street and the city");
  assert.equal(listWords(["a", "b", "c"]), "a, b and c");
});

test("an invoice row shows what was bought and links only to Stripe; drafts are left out", () => {
  const invoice = {
    id: "in_1", number: "DAA95AD0-0001", status: "paid", currency: "gbp", amount_paid: 2999, amount_due: 0, total: 2999, created: 1_792_540_800,
    status_transitions: { finalized_at: 1_792_540_900 }, hosted_invoice_url: "https://invoice.stripe.com/i/x", invoice_pdf: "https://evil.example/x.pdf",
    lines: { data: [{ description: "1 × Retrivr Basic (at £29.99 / month)" }] },
  };
  const row = invoiceRow(invoice, true);
  assert.equal(row.product, "1 × Retrivr Basic");
  assert.equal(row.amount, "£29.99");
  assert.equal(row.statusLabel, "Paid");
  assert.equal(row.date.getTime(), 1_792_540_900_000);
  assert.equal(row.viewUrl, "https://invoice.stripe.com/i/x");
  assert.equal(row.pdfUrl, null, "a PDF link off Stripe is dropped");
  assert.equal(invoiceRow({ ...invoice, status: "open", amount_due: 4999 }, true).amount, "£49.99");
  assert.equal(invoiceRow({ ...invoice, status: "draft" }, true), null);
});

test("billing details say which parts of the address are missing", () => {
  const full = billingDetails({ name: "Aditya Shah", email: "a@example.com", address: { line1: "1 High St", city: "Belfast", postal_code: "BT47 2AF", country: "GB" }, tax_ids: { data: [{ value: "GB123456789" }] } });
  assert.deepEqual(full.missing, []);
  assert.equal(full.country, "United Kingdom");
  assert.deepEqual(full.taxIds, ["GB123456789"]);
  const partial = billingDetails({ name: "Aditya Shah", address: { postal_code: "BT47 2AF", country: "GB" } });
  assert.deepEqual(partial.missing, ["the street", "the city"]);
  assert.deepEqual(partial.lines, ["BT47 2AF"]);
  assert.equal(billingDetails({ deleted: true }), null);
  assert.deepEqual(billingDetails({}).missing, ["the street", "the city", "the postcode", "the country"]);
});
