// The promo code: one code, typed on the billing page, for 30 days of free
// Pro. The rules are here, shared with the server action and the unit tests
// (tests/promo.test.mjs). No database, no network.
//
// It never changes a plan anyone paid for or was given: it sets a window
// (User.promoProFrom/promoProUntil) that getAccountTier reads as Pro only while
// the account would otherwise have less than Pro, or a trial.

export const PROMO = {
  id: "trial2026",
  code: "TRIAL2026",
  days: 30,
  // 15 November 2026 at 23:59 UK time. The clocks went back on 25 October,
  // so that is GMT, which is UTC: the code works until this instant, not at it.
  endsAt: "2026-11-16T00:00:00.000Z",
};

const DAY_MS = 86_400_000;

// When the code stops working. Outside production a test may move it, so
// the expired path can be played before 15 November.
export function promoEndsAt(env = process.env) {
  const override = env.NODE_ENV !== "production" ? env.CAPTURE_TEST_PROMO_ENDS_AT : undefined;
  const at = new Date(override || PROMO.endsAt);
  return Number.isFinite(at.getTime()) ? at : new Date(PROMO.endsAt);
}

// What was typed, as the code compares it: full-width letters from an input
// method made plain, case ignored, and spaces and dashes dropped.
export function normalizePromoCode(value) {
  return String(value ?? "").normalize("NFKC").toUpperCase().replace(/[\s\-‐-―−]/g, "");
}

export function isPromoCode(value) {
  return normalizePromoCode(value) === PROMO.code;
}

// What typing the code does, in the order the page answers:
// - "invalid": not the code;
// - "used": this address has redeemed it before (deleting the account and
//   signing up again does not give a second one);
// - "expired": the code, after its deadline;
// - "has_pro": the account already has Pro or more (paid, granted, Admin):
//   refused, and the code is not spent;
// - "trial_long": a trial that already runs 30 days or more: refused, not spent;
// - "granted", with the window: a trial becomes 30 days from its start (not
//   30 more), and anyone else gets 30 days from now.
/**
 * @typedef {{ outcome: "invalid" | "used" | "expired" | "has_pro" | "trial_long" } | { outcome: "granted", from: Date, until: Date, extendedTrial: boolean }} PromoDecision
 * @param {{ code: unknown, tier: string, createdAt: Date, trialExpiresAt: Date | null, used: boolean, now?: Date, endsAt?: Date }} input
 * @returns {PromoDecision}
 */
export function decidePromo({ code, tier, createdAt, trialExpiresAt, used, now = new Date(), endsAt = promoEndsAt() }) {
  if (!isPromoCode(code)) return { outcome: "invalid" };
  if (used) return { outcome: "used" };
  if (now >= endsAt) return { outcome: "expired" };
  if (["pro", "promax", "admin", "promo"].includes(tier)) return { outcome: "has_pro" };
  if (tier === "trial") {
    const from = new Date(createdAt);
    const until = new Date(from.getTime() + PROMO.days * DAY_MS);
    if (until <= now || (trialExpiresAt && until <= new Date(trialExpiresAt))) return { outcome: "trial_long" };
    return { outcome: "granted", from, until, extendedTrial: true };
  }
  return { outcome: "granted", from: now, until: new Date(now.getTime() + PROMO.days * DAY_MS), extendedTrial: false };
}

// The deadline as the page says it, in UK time: the last minute it works.
export function promoDeadlineText(endsAt = promoEndsAt()) {
  const last = new Date(endsAt.getTime() - 60_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London",
  }).formatToParts(last).map((part) => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.year} at ${parts.hour}:${parts.minute}`;
}
