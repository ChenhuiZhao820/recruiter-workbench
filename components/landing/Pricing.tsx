"use client";

import { useState } from "react";

import { included, money, tiers } from "@/lib/plan-prices";

// A plan button scrolls to Contact and carries its plan into the email subject.
export const PLAN_EVENT = "lp-plan";

// With sign-up open, every plan button leads there (every plan starts with the
// Pro trial, and any plan can be bought from Billing); before sign-up opens,
// each goes to Contact with its plan.
export function Pricing({ signupOpen = false }: { signupOpen?: boolean }) {
  const [yearly, setYearly] = useState(false);
  return <>
    <div className="lp-price-head">
      <div className="lp-intro">
        <span className="lp-eyebrow">Pricing · per seat</span>
        <h2>Start small.<br /><span>Add what you use.</span></h2>
      </div>
      <div className="lp-toggle" role="group" aria-label="Billing period">
        <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>Monthly</button>
        <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>Annual <span className="lp-save">save up to 30%</span></button>
      </div>
    </div>

    <div className="lp-included">
      <b>Every plan</b>
      <ul>{included.map((item) => <li key={item}><svg><use href="#lp-i-check" /></svg>{item}</li>)}</ul>
    </div>
    <div className="lp-tiers">
      {tiers.map((tier) => <article key={tier.name} className={tier.featured ? "lp-tier lp-featured" : "lp-tier"}>
        <div className="lp-tier-name"><h3>{tier.name}</h3>{tier.featured && <span className="lp-trial">7 days free</span>}</div>
        <div className="lp-price"><span key={String(yearly)} className="lp-amt lp-flip">{money(yearly ? tier.yearly : tier.monthly)}</span><span className="lp-per">{yearly ? "/ year" : "/ month"}</span></div>
        <div className="lp-price-sub">{yearly
          ? <>≈ {money(Number((tier.yearly / 12).toFixed(2)))} / mo · <span className="lp-good">save {Math.round((1 - tier.yearly / (tier.monthly * 12)) * 100)}%</span></>
          : <>or {money(tier.yearly)} / year</>}</div>
        {signupOpen
          ? <a href="/signup" className={tier.featured ? "lp-btn lp-btn-primary" : "lp-btn"}>{tier.featured ? tier.cta : "Start with a free trial"}</a>
          : <a href="#contact" className={tier.featured ? "lp-btn lp-btn-primary" : "lp-btn"} onClick={() => window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail: tier.plan }))}>{tier.cta}</a>}
        <ul className="lp-feat">
          {tier.base && <li className="lp-base">{tier.base}</li>}
          {tier.features.map(([feature, note]) => <li key={feature}><svg><use href="#lp-i-check" /></svg><span>{feature}{note && <> <em>· {note}</em></>}</span></li>)}
        </ul>
      </article>)}
    </div>
    <p className="lp-seat-note">All prices per seat, excl. VAT.</p>
  </>;
}
