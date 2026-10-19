"use client";

import { useState } from "react";

type Tier = { name: string; monthly: number; yearly: number; cta: string; plan: string; featured?: boolean; base?: string; features: [string, string?][] };

const tiers: Tier[] = [
  { name: "Lite", monthly: 5.99, yearly: 49.99, cta: "Get Lite", plan: "Lite", features: [["Batch follow-up"], ["Client shortlists", "3 open"]] },
  { name: "Basic", monthly: 29.99, yearly: 299, cta: "Get Basic", plan: "Basic", base: "Lite, plus", features: [["Talent database"], ["Screening summaries", "30/mo"], ["Unlimited batch follow-up"]] },
  { name: "Pro", monthly: 49.99, yearly: 499, cta: "Start free trial", plan: "Pro trial", featured: true, base: "Basic, plus", features: [["Screening summaries", "120/mo"], ["One-click sign-off to clients"], ["Reply suggestions"], ["Meeting prompt decks", "n/mo"], ["Custom solutions", "small"]] },
  { name: "Pro Max", monthly: 99.99, yearly: 999, cta: "Contact us", plan: "Pro Max", base: "Pro, plus", features: [["More screening summaries"], ["Email finder", "add-on"], ["Unlimited prompt decks"], ["Custom solutions", "large"]] },
];
const included = ["Chrome extension", "Roles & pipeline", "AI role briefings", "Outreach queue", "Booking page", "Client links"];

const money = (amount: number) => `£${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;

// A plan button scrolls to Contact and carries its plan into the email subject.
export const PLAN_EVENT = "lp-plan";

export function Pricing() {
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
        <a href="#contact" className={tier.featured ? "lp-btn lp-btn-primary" : "lp-btn"} onClick={() => window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail: tier.plan }))}>{tier.cta}</a>
        <ul className="lp-feat">
          {tier.base && <li className="lp-base">{tier.base}</li>}
          {tier.features.map(([feature, note]) => <li key={feature}><svg><use href="#lp-i-check" /></svg><span>{feature}{note && <> <em>· {note}</em></>}</span></li>)}
        </ul>
      </article>)}
    </div>
    <p className="lp-seat-note">All prices per seat, excl. VAT.</p>
  </>;
}
