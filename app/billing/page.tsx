import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { accountTierLabels, getAccountTier, isPaidPlan } from "@/lib/account-tiers";
import { billingConfigured, hasLiveSubscription } from "@/lib/billing";
import { CHECKOUT_PLANS, priceFor } from "@/lib/billing-core.mjs";
import { formatWhen } from "@/lib/dates";
import { money, tiers } from "@/lib/plan-prices";
import { openBillingPortal, startCheckout } from "@/app/actions/billing";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

// The account's own plan and the way to pay for one. Open with or without a
// plan (an account whose trial ended lands here), never in an administrator's
// read-only view of somebody else.
export default async function BillingPage({ searchParams }: { searchParams: { checkout?: string; error?: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.viewUserId && session.viewUserId !== session.user.id) {
    return <div className="max-w-3xl card text-sm text-ink-soft">Billing belongs to each account. Return to your own workspace to see yours.</div>;
  }
  const user = await db.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      role: true, active: true, accountTier: true, trialExpiresAt: true, signupSource: true, billingPlan: true, billingStatus: true,
      billingPastDueSince: true, billingInterval: true, billingPeriodEnd: true, billingCancelAtPeriodEnd: true, stripeCustomerId: true, stripeSubscriptionId: true,
    },
  });
  const tier = getAccountTier(user);
  const configured = billingConfigured();
  const live = hasLiveSubscription(user);
  const offered = tiers.filter((plan) => (CHECKOUT_PLANS as string[]).includes(plan.key));

  return <div className="max-w-5xl space-y-8">
    <header className="page-header">
      <div>
        <p className="page-eyebrow">Workspace / Billing</p>
        <h1>Your plan</h1>
        <p className="page-description">What this account can use, and how it is paid for.</p>
      </div>
    </header>

    {searchParams.checkout === "done" && <p role="status" className="auth-success"><Icon name="check" size={17} />Thank you. Stripe is confirming the payment; your plan appears here within a minute. Reload if it has not.</p>}
    {searchParams.error && <p role="alert" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">That plan could not be started. Try again, or write to us.</p>}

    <section className="card space-y-3" aria-label="Current plan">
      <p className="field-label">Current plan</p>
      <p className="text-xl font-medium">{accountTierLabels[tier]}</p>
      {tier === "admin" && <p className="section-caption">Administrators have every feature and no plan to pay for.</p>}
      {tier === "trial" && user.trialExpiresAt && <p className="section-caption">Pro features until {formatWhen(user.trialExpiresAt)}. Choose a plan before then to carry straight on.</p>}
      {tier === "none" && <p className="section-caption">{user.trialExpiresAt ? "Your trial has ended." : "This address has had a trial before, so this account starts without one."} Your workspace is read-only until you choose a plan: everything you saved is still here to read, export or delete.</p>}
      {live && isPaidPlan(user.billingPlan) && <p className="section-caption">
        {accountTierLabels[user.billingPlan]}, billed {user.billingInterval === "yearly" ? "yearly" : "monthly"} through Stripe
        {user.billingPeriodEnd ? <> · {user.billingCancelAtPeriodEnd ? "ends" : "renews"} {formatWhen(user.billingPeriodEnd)}</> : null}.
      </p>}
      {user.billingStatus === "past_due" && <p role="status" className="text-sm text-rose-900">The last payment failed. Stripe will try again; update your card in Manage billing to keep your plan.</p>}
      {!live && user.billingPlan === null && user.signupSource !== "self" && tier !== "admin" && tier !== "trial" && <p className="section-caption">Your plan was set up by Retrivr. You can still subscribe below; a subscription takes over from it.</p>}
      {user.stripeCustomerId && configured && <form action={openBillingPortal}><button type="submit" className="btn-secondary">Manage billing<Icon name="external" size={15} /></button></form>}
    </section>

    {user.role === "recruiter" && !live && (configured ? <section aria-label="Choose a plan" className="space-y-4">
      <h2 className="section-heading">Choose a plan</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {offered.map((plan) => <article key={plan.key} className="card space-y-3">
          <h3 className="text-lg font-medium">{plan.name}</h3>
          <ul className="space-y-1 text-sm text-ink-soft">
            {plan.base && <li>{plan.base}</li>}
            {plan.features.map(([feature, note]) => <li key={feature}>{feature}{note ? ` · ${note}` : ""}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            {(["monthly", "yearly"] as const).filter((interval) => priceFor(plan.key, interval)).map((interval) => <form key={interval} action={startCheckout}>
              <input type="hidden" name="plan" value={plan.key} />
              <input type="hidden" name="interval" value={interval} />
              <button type="submit" className={interval === "monthly" ? "btn-primary" : "btn-secondary"}>{money(interval === "monthly" ? plan.monthly : plan.yearly)} / {interval === "monthly" ? "month" : "year"}</button>
            </form>)}
          </div>
        </article>)}
      </div>
      <p className="section-caption">Prices per seat, excl. VAT. Payment happens on Stripe&rsquo;s page; Retrivr never sees your card. Cancel any time from Manage billing. Pro Max or a team account: <Link href="/welcome#contact" className="text-accent underline">write to us</Link>.</p>
    </section> : <p className="card text-sm text-ink-soft">Paying online is not set up yet. <Link href="/welcome#contact" className="text-accent underline">Write to us</Link> and we will sort out your plan.</p>)}
  </div>;
}
