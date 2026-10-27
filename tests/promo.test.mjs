import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { PROMO, decidePromo, isPromoCode, normalizePromoCode, promoDeadlineText, promoEndsAt } from "../lib/promo-core.mjs";
import { allowanceStart } from "../lib/enrow-core.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
function load(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Date, require: (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id) }, { filename });
  return module.exports;
}
const tiers = load("lib/account-tiers.ts");
const features = load("lib/features.ts", { "./account-tiers": tiers });

const DAY = 86_400_000;
const now = new Date("2026-11-03T14:20:00.000Z");
const deadline = new Date(PROMO.endsAt);
const decide = (input) => decidePromo({ code: "TRIAL2026", tier: "basic", createdAt: new Date("2026-01-01T00:00:00Z"), trialExpiresAt: null, used: false, now, endsAt: deadline, ...input });
const recruiter = (fields = {}) => ({ role: "recruiter", accountTier: "basic", trialExpiresAt: null, signupSource: "admin", billingPlan: null, billingStatus: null, billingPastDueSince: null, promoProFrom: null, promoProUntil: null, ...fields });

test("the code is TRIAL2026 however it is typed, and nothing else", () => {
  for (const typed of ["TRIAL2026", "trial2026", "  Trial2026 ", "TRIAL-2026", "trial 2026", "ＴＲＩＡＬ２０２６", "TRIAL–2026"]) assert.ok(isPromoCode(typed), typed);
  for (const typed of ["", "TRIAL2025", "TRIAL20266", "TRIAL", "TR1AL2026", null, undefined]) assert.ok(!isPromoCode(typed), String(typed));
  assert.equal(normalizePromoCode(" ｔｒｉａｌ-2026 "), "TRIAL2026");
});

test("the deadline is 15 November 2026 at 23:59 UK time, which is GMT then", () => {
  assert.equal(promoEndsAt({ NODE_ENV: "production" }).toISOString(), "2026-11-16T00:00:00.000Z");
  assert.equal(promoDeadlineText(promoEndsAt({})), "15 November 2026 at 23:59");
  assert.equal(decide({ now: new Date("2026-11-15T23:59:59.999Z") }).outcome, "granted");
  assert.equal(decide({ now: new Date("2026-11-16T00:00:00.000Z") }).outcome, "expired");
  // A test may move the deadline, never in production.
  assert.equal(promoEndsAt({ NODE_ENV: "test", CAPTURE_TEST_PROMO_ENDS_AT: "2026-10-01T00:00:00.000Z" }).toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(promoEndsAt({ NODE_ENV: "production", CAPTURE_TEST_PROMO_ENDS_AT: "2026-10-01T00:00:00.000Z" }).toISOString(), PROMO.endsAt);
  assert.equal(promoEndsAt({ NODE_ENV: "test", CAPTURE_TEST_PROMO_ENDS_AT: "nonsense" }).toISOString(), PROMO.endsAt);
});

test("what the code does, in the order the page answers", () => {
  assert.deepEqual(decide({ code: "WRONG" }), { outcome: "invalid" });
  // A wrong code says nothing about having used or missed the right one.
  assert.equal(decide({ code: "WRONG", used: true, now: new Date("2027-01-01T00:00:00Z") }).outcome, "invalid");
  assert.equal(decide({ used: true }).outcome, "used");
  assert.equal(decide({ used: true, now: new Date("2027-01-01T00:00:00Z") }).outcome, "used");
  assert.equal(decide({ now: new Date("2027-01-01T00:00:00Z") }).outcome, "expired");
  for (const tier of ["pro", "promax", "admin", "promo"]) assert.equal(decide({ tier }).outcome, "has_pro", tier);
  for (const tier of ["none", "lite", "basic"]) {
    const decision = decide({ tier });
    assert.equal(decision.outcome, "granted");
    assert.equal(decision.from.getTime(), now.getTime());
    assert.equal(decision.until.getTime(), now.getTime() + 30 * DAY);
    assert.equal(decision.extendedTrial, false);
  }
});

test("a trial becomes 30 days from its start, not 30 more", () => {
  const createdAt = new Date("2026-11-01T09:00:00.000Z");
  const decision = decide({ tier: "trial", createdAt, trialExpiresAt: new Date(createdAt.getTime() + 7 * DAY) });
  assert.equal(decision.outcome, "granted");
  assert.equal(decision.extendedTrial, true);
  assert.equal(decision.from.getTime(), createdAt.getTime());
  assert.equal(decision.until.toISOString(), "2026-12-01T09:00:00.000Z");
  // A trial that already runs 30 days or more gains nothing, and keeps the code.
  assert.equal(decide({ tier: "trial", createdAt, trialExpiresAt: new Date(createdAt.getTime() + 30 * DAY) }).outcome, "trial_long");
  assert.equal(decide({ tier: "trial", createdAt: new Date("2026-09-01T00:00:00Z"), trialExpiresAt: new Date("2026-11-20T00:00:00Z") }).outcome, "trial_long");
});

test("the window lifts anything below Pro and a trial, and never lowers a plan", () => {
  const window = { promoProFrom: new Date(now.getTime() - DAY), promoProUntil: new Date(now.getTime() + 29 * DAY) };
  assert.equal(tiers.getAccountTier(recruiter(window), now), "promo");
  assert.equal(tiers.getAccountTier(recruiter({ ...window, accountTier: "lite" }), now), "promo");
  assert.equal(tiers.getAccountTier(recruiter({ ...window, signupSource: "self", accountTier: "trial" }), now), "promo");
  assert.equal(tiers.getAccountTier(recruiter({ ...window, signupSource: "self", accountTier: "trial", trialExpiresAt: new Date(now.getTime() + DAY) }), now), "promo");
  assert.equal(tiers.getAccountTier(recruiter({ ...window, billingPlan: "basic", billingStatus: "active" }), now), "promo");
  assert.equal(tiers.getAccountTier(recruiter({ ...window, billingPlan: "promax", billingStatus: "active" }), now), "promax");
  assert.equal(tiers.getAccountTier(recruiter({ ...window, accountTier: "pro" }), now), "pro");
  assert.equal(tiers.getAccountTier({ ...recruiter(window), role: "admin" }, now), "admin");
  // Before the window opens, after it closes, and with none at all.
  assert.equal(tiers.getAccountTier(recruiter({ promoProFrom: new Date(now.getTime() + DAY), promoProUntil: new Date(now.getTime() + 31 * DAY) }), now), "basic");
  assert.equal(tiers.getAccountTier(recruiter({ ...window, promoProUntil: now }), now), "basic");
  assert.equal(tiers.getAccountTier(recruiter({ ...window, promoProUntil: now, signupSource: "self", accountTier: "trial" }), now), "none");
  assert.equal(tiers.getAccountTier(recruiter(), now), "basic");
  assert.equal(tiers.baseAccountTier(recruiter(window), now), "basic");
  assert.equal(tiers.accountTierLabels.promo, "Pro trial");
});

test("the window is Pro for features and allowances, and email searches count over all of it", () => {
  const account = { ...recruiter({ promoProFrom: new Date(now.getTime() - DAY), promoProUntil: new Date(now.getTime() + 29 * DAY) }), active: true };
  for (const feature of features.FEATURES) assert.ok(features.canUseFeature(account, feature, now), feature);
  assert.equal(tiers.canUseProFeatures(account, now), true);
  assert.equal(features.activeShortlistLimit(account, now), null);
  for (const kind of ["screening", "replies", "matches", "emails"]) assert.equal(features.MONTHLY_QUOTAS[kind].promo, features.MONTHLY_QUOTAS[kind].pro, kind);
  assert.equal(features.monthlyQuota(account, "emails", null, now), 250);
  const from = new Date("2026-10-20T08:00:00.000Z");
  assert.equal(allowanceStart("promo", now, null, from).toISOString(), from.toISOString());
  assert.equal(allowanceStart("pro", now, null, from).toISOString(), "2026-11-01T00:00:00.000Z");
});
