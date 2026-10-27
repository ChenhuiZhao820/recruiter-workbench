import type { AccountTier } from "@/lib/account-tiers";

// The billing page's drawings: line art in ink with one cobalt accent, inline
// so nothing is fetched. Decoration only; each is hidden from screen readers.

const MARK_LETTERS: Record<AccountTier, string> = { none: "–", lite: "L", basic: "B", pro: "P", trial: "P", promo: "P", promax: "P+", admin: "A" };

// The plan's letter inside nested rounded squares, one ring per step up.
export function PlanMark({ tier }: { tier: AccountTier }) {
  const rings = { none: 1, lite: 2, basic: 3, pro: 4, trial: 4, promo: 4, promax: 5, admin: 5 }[tier];
  return <svg className="billing-mark" width="76" height="76" viewBox="0 0 76 76" fill="none" aria-hidden="true">
    {Array.from({ length: rings }, (_, i) => <rect key={i} x={2 + i * 5} y={2 + i * 5} width={72 - i * 10} height={72 - i * 10} rx={20 - i * 3} stroke={i === rings - 1 ? "var(--color-accent)" : "currentColor"} strokeOpacity={i === rings - 1 ? 1 : 0.28 + i * 0.12} strokeWidth="1.5" />)}
    <text x="38" y="38" dominantBaseline="central" textAnchor="middle" fontSize={MARK_LETTERS[tier].length > 1 ? 17 : 21} fontWeight="650" fill="currentColor" style={{ letterSpacing: "-0.04em" }}>{MARK_LETTERS[tier]}</text>
  </svg>;
}

// Three plan cards standing on a base, the tallest marked.
export function PlansArt() {
  return <svg width="112" height="74" viewBox="0 0 112 74" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 60 56 72l46-12-46-12z" fill="var(--color-surface)" />
    <path d="M24 56V30l14-4v26z" fill="var(--color-surface)" />
    <path d="M44 52V18l14-4v34z" fill="var(--color-accent-soft)" stroke="var(--color-accent)" />
    <path d="M64 48V24l14-4v24z" fill="var(--color-surface)" />
    <path d="M28 36l6-2M28 41l6-2M48 26l6-2M48 31l6-2M48 36l4-1M68 30l6-2M68 35l6-2" />
    <circle cx="58" cy="10" r="5" fill="var(--color-accent)" stroke="var(--color-accent)" />
    <path d="m55.8 10 1.5 1.5 2.8-3" stroke="white" />
  </svg>;
}

// An invoice lying at an angle, one line picked out.
export function InvoiceArt() {
  return <svg className="billing-invoice-art" width="120" height="80" viewBox="0 0 120 80" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 40 64 10l48 26-56 32z" fill="var(--color-surface)" />
    <path d="M8 40v4l48 28v-4M56 72l56-32v-4" />
    <path d="M24 38l10-5 6 3-10 5zM40 44l26-14M46 48l26-14M52 52l26-14M58 56l16-9" strokeOpacity=".45" />
    <path d="M80 46l14-8" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" />
  </svg>;
}
