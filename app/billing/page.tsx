import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { accountTierLabels, getAccountTier, isPaidPlan } from "@/lib/account-tiers";
import { billingConfigured, hasLiveSubscription, loadBillingDetails, loadInvoices } from "@/lib/billing";
import { billingUsage } from "@/lib/billing-usage";
import { CHECKOUT_PLANS, formatDay, listWords, priceFor } from "@/lib/billing-core.mjs";
import { canUseFeature, type Feature } from "@/lib/features";
import type { PlanKey } from "@/lib/plan-prices";
import { openBillingPortal } from "@/app/actions/billing";
import { Icon } from "@/components/Icon";
import { RoleTabs } from "@/components/RoleTabs";
import { PlanPicker } from "@/components/billing/PlanPicker";
import { InvoiceArt, PlanMark, PlansArt } from "@/components/billing/BillingArt";

export const dynamic = "force-dynamic";

const BILLING_TABS = ["overview", "invoices", "plans"] as const;
type BillingTab = (typeof BILLING_TABS)[number];

// What a plan includes, in the order the homepage sells it. Each line is the
// feature that decides it, so the chips cannot promise what the account lacks.
const PLAN_FEATURES: { label: string; icon: Parameters<typeof Icon>[0]["name"]; feature: Feature }[] = [
  { label: "Roles & pipeline", icon: "roles", feature: "people" },
  { label: "Booking page", icon: "calendar", feature: "booking" },
  { label: "Client links", icon: "shortlist", feature: "clientShortlists" },
  { label: "Batch follow-up", icon: "clock", feature: "followUpRuns" },
  { label: "Talent database", icon: "people", feature: "peopleSearch" },
  { label: "Screening summaries", icon: "file", feature: "screening" },
  { label: "Instant Match", icon: "spark", feature: "instantMatch" },
  { label: "Client sign-off email", icon: "message", feature: "clientEmail" },
  { label: "Reply suggestions", icon: "undo", feature: "replySuggestions" },
  { label: "Email finder", icon: "search", feature: "emailFinder" },
];

// The account's own billing: its plan and credits, its invoices, and the
// plans it can move to. Paying, changing plan, cancelling and the card all
// happen on Stripe's pages; nothing here changes a plan (the webhook does).
// Open with or without a plan, never in an administrator's read-only view.
export default async function BillingPage({ searchParams }: { searchParams: { checkout?: string; error?: string; tab?: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.viewUserId && session.viewUserId !== session.user.id) {
    return <div className="max-w-3xl card text-sm text-ink-soft">Billing belongs to each account. Return to your own workspace to see yours.</div>;
  }
  const user = await db.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      id: true, role: true, active: true, accountTier: true, trialExpiresAt: true, signupSource: true, billingPlan: true, billingStatus: true,
      billingPastDueSince: true, billingInterval: true, billingPeriodEnd: true, billingCancelAtPeriodEnd: true, stripeCustomerId: true, stripeSubscriptionId: true,
    },
  });
  const now = new Date();
  const tier = getAccountTier(user, now);
  const configured = billingConfigured();
  const live = hasLiveSubscription(user);
  const paidPlan = live && isPaidPlan(user.billingPlan) ? user.billingPlan : null;
  const interval = user.billingInterval === "yearly" ? "yearly" : user.billingInterval === "monthly" ? "monthly" : null;
  const stripeCustomer = configured ? user.stripeCustomerId : null;
  const [usage, details, invoices] = await Promise.all([
    billingUsage(user, now),
    stripeCustomer ? loadBillingDetails(stripeCustomer) : null,
    stripeCustomer ? loadInvoices(stripeCustomer) : null,
  ]);

  const offered = Object.fromEntries((CHECKOUT_PLANS as PlanKey[]).map((plan) => [plan, (["monthly", "yearly"] as const).filter((each) => priceFor(plan, each))]));
  const mayBuy = configured && user.role === "recruiter";
  const tab: BillingTab = (BILLING_TABS as readonly string[]).includes(searchParams.tab ?? "") ? searchParams.tab as BillingTab : tier === "none" ? "plans" : "overview";
  const included = tier === "none" ? [] : PLAN_FEATURES.filter((item) => canUseFeature(user, item.feature, now));
  const daysLeft = user.trialExpiresAt ? Math.max(1, Math.ceil((user.trialExpiresAt.getTime() - now.getTime()) / 86_400_000)) : 0;

  const status = tier === "admin" ? null
    : user.billingStatus === "past_due" && live ? { label: "Payment failed", tone: "bad" }
    : live && user.billingCancelAtPeriodEnd ? { label: "Ending", tone: "warn" }
    : live ? { label: "Active", tone: "good" }
    : tier === "trial" ? { label: `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`, tone: "accent" }
    : tier === "none" ? { label: "Read-only", tone: "bad" }
    : { label: "Set up by Retrivr", tone: "plain" };

  const overview = <div className="space-y-6">
    <section className="card billing-card" aria-label="Current plan">
      <div className="billing-plan-top">
        <PlanMark tier={tier} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="billing-plan-name">{tier === "none" ? "No plan" : `${accountTierLabels[tier]}${tier === "admin" || tier === "trial" ? "" : " plan"}`}</h2>
            {status && <span className={`billing-pill billing-pill-${status.tone}`}>{status.label}</span>}
          </div>
          {tier === "admin" && <p className="billing-plan-line">Administrators have every feature and no plan to pay for.</p>}
          {tier === "trial" && user.trialExpiresAt && <p className="billing-plan-line">Pro features until {formatDay(user.trialExpiresAt)}. Choose a plan before then to carry straight on.</p>}
          {tier === "none" && <p className="billing-plan-line">{user.trialExpiresAt ? "Your trial has ended." : "This address has had a trial before, so this account starts without one."} Your workspace is read-only until you choose a plan: everything you saved is still here to read, export or delete.</p>}
          {paidPlan && <p className="billing-plan-line">
            {accountTierLabels[paidPlan]}, billed {interval === "yearly" ? "yearly" : "monthly"} through Stripe.
            {user.billingPeriodEnd ? <> Your plan will {user.billingCancelAtPeriodEnd ? "end" : "renew automatically"} on {formatDay(user.billingPeriodEnd)}.</> : null}
          </p>}
          {!live && tier !== "admin" && tier !== "trial" && tier !== "none" && <p className="billing-plan-line">Your plan was set up by Retrivr. You can still subscribe; a subscription takes over from it.</p>}
          {user.billingStatus === "past_due" && live && <p role="status" className="billing-plan-line text-rose-900">The last payment failed. Stripe will try again; update your card to keep your plan.</p>}
        </div>
        <a href="#choose-plan" className="billing-plans-link"><PlansArt /><span>Plans &amp; prices<Icon name="arrow" size={15} /></span></a>
      </div>
      {included.length > 0 && <ul className="billing-features" aria-label="Included in your plan">
        {included.map((item) => <li key={item.label}><Icon name={item.icon} size={17} />{item.label}</li>)}
        <li><Icon name="grid" size={17} />Chrome extension</li>
      </ul>}
    </section>

    {usage.lines.length > 0 && <section className="card billing-card space-y-4" aria-labelledby="usage-heading">
      <div>
        <h2 id="usage-heading" className="section-heading">This month&rsquo;s credits</h2>
        <p className="section-caption">Counted the same way the features count them. Monthly credits start again on {formatDay(usage.resets)} (UTC).</p>
      </div>
      <ul className="billing-usage">
        {usage.lines.map((line) => {
          const share = line.quota > 0 ? Math.min(100, Math.round((line.used / line.quota) * 100)) : 100;
          const out = line.used >= line.quota;
          return <li key={line.key}>
            <div className="billing-usage-head"><span>{line.label}</span><span className={out ? "tabular text-rose-900" : "tabular"}>{line.used.toLocaleString("en-GB")} of {line.quota.toLocaleString("en-GB")}{out ? " · used up" : ""}</span></div>
            <div className="billing-meter" role="img" aria-label={`${line.label}: ${line.used} of ${line.quota} used`}><span className={out ? "is-out" : share >= 80 ? "is-high" : ""} style={{ width: `${share}%` }} /></div>
            {line.wholeTrial && <p className="section-caption">For the whole trial, not per month.</p>}
          </li>;
        })}
      </ul>
    </section>}

    {stripeCustomer && live && <section className="card billing-card" aria-labelledby="manage-heading">
      <h2 id="manage-heading" className="section-heading">Manage subscription</h2>
      <div className="billing-rows">
        <div className="billing-row">
          <div><p className="billing-row-title">Change plan</p><p className="billing-row-text">Move to another plan or between monthly and yearly. Stripe works out the difference.</p></div>
          <form action={openBillingPortal}><input type="hidden" name="flow" value="update" /><button type="submit" className="btn-secondary"><Icon name="sort" size={16} />Change plan</button></form>
        </div>
        <div className="billing-row">
          <div><p className="billing-row-title">Payment method</p><p className="billing-row-text">Your card is kept by Stripe; Retrivr never sees it.</p></div>
          <form action={openBillingPortal}><input type="hidden" name="flow" value="payment" /><button type="submit" className="btn-secondary"><Icon name="card" size={16} />Update card</button></form>
        </div>
        {user.billingCancelAtPeriodEnd
          ? <div className="billing-row">
            <div><p className="billing-row-title">Keep your plan</p><p className="billing-row-text">Your plan ends{user.billingPeriodEnd ? ` on ${formatDay(user.billingPeriodEnd)}` : ""}. Renew it on Stripe to carry on without a break.</p></div>
            <form action={openBillingPortal}><button type="submit" className="btn-secondary"><Icon name="undo" size={16} />Keep my plan</button></form>
          </div>
          : <div className="billing-row">
            <div><p className="billing-row-title">Cancel plan</p><p className="billing-row-text">Your plan stays until the end of the period you paid for. After that the workspace is read-only, and everything you saved stays to read, export or delete.</p></div>
            <form action={openBillingPortal}><input type="hidden" name="flow" value="cancel" /><button type="submit" className="billing-danger-link">Cancel subscription</button></form>
          </div>}
      </div>
    </section>}
  </div>;

  const invoicesPanel = !stripeCustomer
    ? <section className="card billing-card billing-empty"><InvoiceArt /><div><h2 className="section-heading">No invoices yet</h2><p className="section-caption">{configured ? "Invoices appear here once you subscribe to a plan." : "Paying online is not set up yet."} {tier === "trial" || tier === "admin" ? "" : <>Questions about a bill: <Link href="/welcome#contact" className="text-accent underline">write to us</Link>.</>}</p></div></section>
    : <div className="space-y-6">
      <section className="card billing-card" aria-labelledby="details-heading">
        <div className="billing-section-head">
          <span className="billing-icon-box"><Icon name="file" size={19} /></span>
          <div className="flex-1"><h2 id="details-heading" className="section-heading">Billing details</h2><p className="section-caption">What your next invoices will show.</p></div>
          <form action={openBillingPortal}><button type="submit" className={details && details !== "unavailable" && details.missing.length ? "btn-primary" : "btn-secondary"}>{details && details !== "unavailable" && details.missing.length ? "Complete" : "Edit"}<Icon name="external" size={15} /></button></form>
        </div>
        {details === "unavailable"
          ? <p className="billing-note">Stripe could not be reached just now. Reload in a moment, or open the Stripe portal.</p>
          : details && <div className="billing-details">
            <div>
              <p className="field-label">Billed to</p>
              <p className="font-medium">{details.name ?? <span className="text-ink-soft">No name yet</span>}</p>
              {details.lines.map((line) => <p key={line}>{line}</p>)}
              {details.country && <p>{details.country}</p>}
              {details.missing.length > 0 && <p className="billing-warn"><Icon name="shield" size={16} />Incomplete address: add {listWords(details.missing)}.</p>}
            </div>
            <div>
              <p className="field-label">Invoices sent to</p>
              <p>{details.email ?? <span className="text-ink-soft">No email</span>}</p>
            </div>
            <div>
              <p className="field-label">Tax ID</p>
              <p>{details.taxIds.length ? details.taxIds.join(", ") : <span className="text-ink-soft">None</span>}</p>
            </div>
          </div>}
      </section>

      <section className="card billing-card" aria-labelledby="invoices-heading">
        <div className="billing-section-head">
          <div className="flex-1"><h2 id="invoices-heading" className="section-heading">Invoices</h2><p className="section-caption">Every invoice on your account, with its PDF. A paid invoice&rsquo;s page also holds its receipt.</p></div>
          <InvoiceArt />
        </div>
        {invoices === "unavailable"
          ? <p className="billing-note">Stripe could not be reached just now. Reload in a moment, or open the Stripe portal.</p>
          : !invoices?.length
            ? <p className="billing-note">No invoices yet.</p>
            : <table className="billing-invoices">
              <thead><tr><th scope="col">Invoice</th><th scope="col">Product</th><th scope="col">Date</th><th scope="col" className="text-right">Amount</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{invoices.map((invoice) => <tr key={invoice.id}>
                <td data-label="Invoice" className="font-mono text-xs">{invoice.number ?? "—"}</td>
                <td data-label="Product">{invoice.product}</td>
                <td data-label="Date" className="tabular">{formatDay(invoice.date)}</td>
                <td data-label="Amount" className="tabular md:text-right">{invoice.amount}</td>
                <td data-label="Status"><span className={`billing-pill billing-pill-${invoice.status === "paid" ? "good" : invoice.status === "open" ? "warn" : "plain"}`}>{invoice.statusLabel}</span></td>
                <td className="billing-invoice-actions">
                  {invoice.viewUrl && <a href={invoice.viewUrl} target="_blank" rel="noreferrer" className="row-icon-button hover-tip" aria-label={`View invoice ${invoice.number ?? ""} on Stripe`} data-tip="View on Stripe"><Icon name="eye" size={18} /></a>}
                  {invoice.pdfUrl && <a href={invoice.pdfUrl} target="_blank" rel="noreferrer" className="row-icon-button hover-tip" aria-label={`Download invoice ${invoice.number ?? ""} as PDF`} data-tip="Download PDF"><Icon name="download" size={18} /></a>}
                </td>
              </tr>)}</tbody>
            </table>}
        <div className="billing-stripe-note">
          <p><Icon name="lock" size={16} />Your card and payment methods are managed on Stripe.</p>
          <form action={openBillingPortal}><button type="submit" className="btn-secondary">Stripe portal<Icon name="external" size={15} /></button></form>
        </div>
      </section>
    </div>;

  const plansPanel = <section aria-labelledby="choose-plan" className="space-y-4">
    <div>
      <h2 id="choose-plan" className="section-heading">{live ? "Change plan" : "Choose a plan"}</h2>
      <p className="section-caption">Prices per seat, excl. VAT. Payment happens on Stripe&rsquo;s page; Retrivr never sees your card.{live ? " A change is confirmed on Stripe before it takes effect." : " Cancel any time."}</p>
    </div>
    {configured
      ? <PlanPicker offered={offered} current={paidPlan} interval={interval} live={live} mayBuy={mayBuy} />
      : <p className="card text-sm text-ink-soft">Paying online is not set up yet. <Link href="/welcome#contact" className="text-accent underline">Write to us</Link> and we will sort out your plan.</p>}
    <p className="section-caption">A team account or custom work: <Link href="/welcome#contact" className="text-accent underline">write to us</Link>.</p>
  </section>;

  return <div className="max-w-5xl">
    <header className="page-header">
      <div>
        <p className="page-eyebrow">Workspace / Billing</p>
        <h1>Billing</h1>
        <p className="page-description">Your plan, what it includes, and how it is paid for.</p>
      </div>
    </header>

    {searchParams.checkout === "done" && <p role="status" className="auth-success mb-6"><Icon name="check" size={17} />Thank you. Stripe is confirming the payment; your plan appears here within a minute. Reload if it has not.</p>}
    {searchParams.error && <p role="alert" className="mb-6 rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">That plan could not be started. Try again, or write to us.</p>}

    <RoleTabs key={tab} label="Billing" home={tier === "none" ? "plans" : "overview"} initial={tab} tabs={[
      { id: "overview", label: "Overview", panel: overview },
      { id: "invoices", label: "Invoices", panel: invoicesPanel },
      { id: "plans", label: "Plans", panel: plansPanel },
    ]} />
  </div>;
}
