// Billing rules shared by the server and the unit tests (tests/billing.test.mjs):
// which Stripe price is which plan, and what a Stripe subscription means for
// the account. No network, no database.

// Plans sold through Stripe Checkout: all four. An administrator can still
// grant any of them by hand instead.
export const CHECKOUT_PLANS = ["lite", "basic", "pro", "promax"];
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

// The billing portal's reading side: what an invoice and the customer's
// billing details look like on the page. Nothing is stored; these shape what
// Stripe returned for one render.

// The Stripe customer portal flows the page may open. Anything else opens the
// portal's home page.
export const PORTAL_FLOWS = ["update", "cancel", "payment"];

export function portalFlow(value) {
  return PORTAL_FLOWS.includes(value) ? value : null;
}

// Links out go only to Stripe's own pages. Outside production the local stub
// serves them from loopback, over plain HTTP.
export function stripeLink(value, production = process.env.NODE_ENV === "production") {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && (url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com"))) return url.toString();
    if (!production && url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return url.toString();
  } catch {}
  return null;
}

const ZERO_DECIMAL = ["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"];

export function formatAmount(minor, currency) {
  const code = String(currency || "gbp").toLowerCase();
  const value = ZERO_DECIMAL.includes(code) ? minor : minor / 100;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: code.toUpperCase() }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code.toUpperCase()}`;
  }
}

// "21 November 2026", in UTC, the way Stripe dates a billing period.
export function formatDay(date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

export const INVOICE_STATUS_LABELS = { paid: "Paid", open: "Due", void: "Void", uncollectible: "Unpaid", draft: "Draft" };

// One row of the invoice table. Drafts are Stripe's working copies and are
// never listed.
export function invoiceRow(invoice, production) {
  if (!invoice || invoice.status === "draft") return null;
  const line = invoice.lines?.data?.[0];
  const product = String(line?.description ?? invoice.description ?? "Retrivr subscription").replace(/\s*\(at [^)]*\)\s*$/, "").trim();
  const minor = invoice.status === "paid" ? invoice.amount_paid ?? invoice.total ?? 0 : invoice.amount_due ?? invoice.total ?? 0;
  return {
    id: String(invoice.id),
    number: invoice.number ?? null,
    product,
    date: new Date((invoice.status_transitions?.finalized_at ?? invoice.created) * 1000),
    amount: formatAmount(minor, invoice.currency),
    status: invoice.status,
    statusLabel: INVOICE_STATUS_LABELS[invoice.status] ?? String(invoice.status),
    viewUrl: stripeLink(invoice.hosted_invoice_url, production),
    pdfUrl: stripeLink(invoice.invoice_pdf, production),
  };
}

// What the next invoice will carry, and what is missing from the address for
// it to be a full postal address.
export function billingDetails(customer) {
  if (!customer || customer.deleted) return null;
  const address = customer.address ?? {};
  const lines = [address.line1, address.line2, [address.city, address.state].filter(Boolean).join(", "), address.postal_code].filter((part) => typeof part === "string" && part.trim());
  const missing = [];
  if (!address.line1) missing.push("the street");
  if (!address.city) missing.push("the city");
  if (!address.postal_code) missing.push("the postcode");
  if (!address.country) missing.push("the country");
  const country = address.country ? regionName(address.country) : null;
  return {
    name: customer.name || null,
    email: customer.email || null,
    lines,
    country,
    missing,
    taxIds: (customer.tax_ids?.data ?? []).map((tax) => String(tax.value)).filter(Boolean),
  };
}

function regionName(code) {
  try {
    return new Intl.DisplayNames(["en-GB"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

// "the street and the city"
export function listWords(words) {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}
