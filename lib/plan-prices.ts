// The homepage's price table, shared with the Billing page so both say the
// same numbers. Marketing copy only: what an account can use is FEATURE_TIERS
// (lib/features.ts), and what it pays is the Stripe price behind each plan.
export type PlanKey = "lite" | "basic" | "pro" | "promax";
export type Tier = { key: PlanKey; name: string; monthly: number; yearly: number; cta: string; plan: string; featured?: boolean; base?: string; features: [string, string?][] };

export const tiers: Tier[] = [
  { key: "lite", name: "Lite", monthly: 5.99, yearly: 49.99, cta: "Get Lite", plan: "Lite", features: [["Batch follow-up"], ["Client shortlists", "3 open"]] },
  { key: "basic", name: "Basic", monthly: 29.99, yearly: 299, cta: "Get Basic", plan: "Basic", base: "Lite, plus", features: [["Talent database"], ["Screening summaries", "30/mo"], ["Unlimited batch follow-up"]] },
  { key: "pro", name: "Pro", monthly: 49.99, yearly: 499, cta: "Start free trial", plan: "Pro trial", featured: true, base: "Basic, plus", features: [["Screening summaries", "120/mo"], ["One-click sign-off to clients"], ["Reply suggestions"], ["Meeting prompt decks", "n/mo"], ["Custom solutions", "small"]] },
  { key: "promax", name: "Pro Max", monthly: 99.99, yearly: 999, cta: "Contact us", plan: "Pro Max", base: "Pro, plus", features: [["More screening summaries"], ["Email finder", "add-on"], ["Unlimited prompt decks"], ["Custom solutions", "large"]] },
];
export const included = ["Chrome extension", "Roles & pipeline", "AI role briefings", "Outreach queue", "Booking page", "Client links"];

export const money = (amount: number) => `£${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
