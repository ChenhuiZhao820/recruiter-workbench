"use client";

import { useState } from "react";
import { startCheckout } from "@/app/actions/billing";
import { Icon } from "@/components/Icon";
import { money, tiers, type PlanKey } from "@/lib/plan-prices";

type Interval = "monthly" | "yearly";

// The four plans with a Monthly / Yearly switch, as on the homepage. Without a
// subscription a plan's button starts Stripe Checkout; with one it opens the
// portal's change-plan flow (startCheckout decides, on the server), so nobody
// ends up paying twice. The plan being paid for now says so instead.
export function PlanPicker({ offered, current, interval, live, mayBuy }: {
  // Plan and interval pairs this deployment sells: a Stripe price exists for each.
  offered: Partial<Record<PlanKey, Interval[]>>;
  current: PlanKey | null;
  interval: Interval | null;
  live: boolean;
  mayBuy: boolean;
}) {
  const [yearly, setYearly] = useState(interval === "yearly");
  const chosen: Interval = yearly ? "yearly" : "monthly";
  return <div className="space-y-4">
    <div className="billing-toggle" role="group" aria-label="Billing period">
      <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>Monthly</button>
      <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>Yearly <span className="billing-save">save up to 30%</span></button>
    </div>
    <div className="billing-plans">
      {tiers.filter((plan) => offered[plan.key]?.length).map((plan) => {
        const sells = offered[plan.key]?.includes(chosen);
        const isCurrent = live && current === plan.key && interval === chosen;
        return <article key={plan.key} className={isCurrent ? "billing-plan is-current" : "billing-plan"}>
          <div className="billing-plan-head">
            <h3>{plan.name}</h3>
            {live && current === plan.key && <span className="billing-pill">Current plan</span>}
          </div>
          <p className="billing-plan-price"><strong>{money(yearly ? plan.yearly : plan.monthly)}</strong> / {yearly ? "year" : "month"}</p>
          <ul className="billing-plan-features">
            {plan.base && <li className="text-ink-soft">{plan.base}</li>}
            {plan.features.map(([feature, note]) => <li key={feature}><Icon name="check" size={14} /><span>{feature}{note ? <span className="text-ink-soft"> · {note}</span> : null}</span></li>)}
          </ul>
          {mayBuy && (isCurrent
            ? <button type="button" className="btn-secondary w-full justify-center" disabled>Your plan</button>
            : sells
              ? <form action={startCheckout}>
                <input type="hidden" name="plan" value={plan.key} />
                <input type="hidden" name="interval" value={chosen} />
                <button type="submit" className={plan.featured ? "btn-primary w-full justify-center" : "btn-secondary w-full justify-center"}>
                  {live ? `Switch to ${plan.name}` : `Choose ${plan.name}`}
                </button>
              </form>
              : <p className="section-caption">Not sold {yearly ? "yearly" : "monthly"} yet.</p>)}
        </article>;
      })}
    </div>
  </div>;
}
