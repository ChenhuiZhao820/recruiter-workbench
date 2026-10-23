"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { appOrigin } from "@/lib/auth";
import { requireOwnAccount } from "@/lib/workspace";
import { billingConfigured, hasLiveSubscription, stripe } from "@/lib/billing";
import { CHECKOUT_PLANS, INTERVALS, portalFlow, priceFor } from "@/lib/billing-core.mjs";

// Starting a subscription, and everything after it, happens on Stripe's own
// pages: Checkout to pay, the customer portal to change plan, cancel, update
// the card or download invoices. Nothing here changes a plan; the webhook
// does, once Stripe says so (app/api/billing/webhook).

export async function startCheckout(form: FormData) {
  const user = await requireOwnAccount();
  if (!billingConfigured() || user.role !== "recruiter") redirect("/billing");
  const plan = String(form.get("plan") ?? "");
  const interval = String(form.get("interval") ?? "");
  const price = CHECKOUT_PLANS.includes(plan) && INTERVALS.includes(interval) ? priceFor(plan, interval) : null;
  if (!price) redirect("/billing?error=plan");
  const account = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, email: true, stripeCustomerId: true, stripeSubscriptionId: true, billingStatus: true } });
  // Already paying: a change of plan is the portal's job, so nobody ends up
  // with two subscriptions.
  if (hasLiveSubscription(account)) {
    const change = new FormData();
    change.set("flow", "update");
    return openBillingPortal(change);
  }
  const tax = process.env.STRIPE_TAX === "1";
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    client_reference_id: account.id,
    ...(account.stripeCustomerId ? { customer: account.stripeCustomerId, ...(tax ? { customer_update: { address: "auto", name: "auto" } } : {}) } : { customer_email: account.email }),
    subscription_data: { metadata: { userId: account.id } },
    metadata: { userId: account.id },
    allow_promotion_codes: true,
    ...(tax ? { automatic_tax: { enabled: true }, tax_id_collection: { enabled: true } } : {}),
    success_url: `${appOrigin()}/billing?checkout=done`,
    cancel_url: `${appOrigin()}/billing`,
  });
  if (!session.url) redirect("/billing?error=stripe");
  redirect(session.url);
}

// The portal's home page, or one of its flows (change plan, cancel, update the
// card) when the form names one. A flow Stripe refuses - a portal not
// configured for it, a subscription already gone - falls back to the home page.
export async function openBillingPortal(form?: FormData) {
  const user = await requireOwnAccount();
  const account = await db.user.findUnique({ where: { id: user.id }, select: { stripeCustomerId: true, stripeSubscriptionId: true, billingStatus: true } });
  if (!billingConfigured() || !account?.stripeCustomerId) redirect("/billing");
  const flow = portalFlow(form instanceof FormData ? String(form.get("flow") ?? "") : "");
  const subscription = hasLiveSubscription(account) ? account.stripeSubscriptionId : null;
  const return_url = `${appOrigin()}/billing`;
  const flow_data = flow === "payment" ? { type: "payment_method_update" as const }
    : flow === "update" && subscription ? { type: "subscription_update" as const, subscription_update: { subscription } }
    : flow === "cancel" && subscription ? { type: "subscription_cancel" as const, subscription_cancel: { subscription } }
    : null;
  let url: string | null = null;
  if (flow_data) {
    url = await stripe().billingPortal.sessions.create({ customer: account.stripeCustomerId, return_url, flow_data: { ...flow_data, after_completion: { type: "redirect", redirect: { return_url } } } })
      .then((session) => session.url).catch(() => null);
  }
  url ??= (await stripe().billingPortal.sessions.create({ customer: account.stripeCustomerId, return_url })).url;
  redirect(url);
}
