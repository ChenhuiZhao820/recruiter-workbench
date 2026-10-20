import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const now = new Date("2026-09-18T12:00:00.000Z");
class TestDate extends Date {
  constructor(value = now.getTime()) { super(value); }
  static now() { return now.getTime(); }
}
function load(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, Date: TestDate, Buffer, URL,
    require: (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id),
  }, { filename });
  return module.exports;
}
const tiers = load("lib/account-tiers.ts");
const user = (accountTier = "basic", trialExpiresAt = null, role = "recruiter", active = true, extra = {}) => ({ id: "recruiter", role, active, accountTier, trialExpiresAt, signupSource: "admin", ...extra });
const selfServe = (accountTier = "trial", trialExpiresAt = null, extra = {}) => user(accountTier, trialExpiresAt, "recruiter", true, { signupSource: "self", ...extra });
const billed = (billingPlan, billingStatus, extra = {}) => selfServe("trial", null, { billingPlan, billingStatus, ...extra });
const form = (values) => {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
};

test("effective account types preserve admin and default unknown tiers to Basic for accounts an admin made", () => {
  for (const accountTier of ["basic", "pro", "trial", "admin", "unknown", undefined]) {
    assert.equal(tiers.getAccountTier(user(accountTier, null, "admin")), "admin");
    assert.equal(tiers.getAccountTier(selfServe(accountTier, null, { role: "admin" })), "admin");
  }
  for (const plan of ["lite", "basic", "pro", "promax"]) assert.equal(tiers.getAccountTier(user(plan)), plan);
  for (const value of ["admin", "unknown", "PRO", "", null]) assert.equal(tiers.getAccountTier(user(value)), "basic");
  assert.equal(tiers.getAccountTier(user("pro", null, "unknown")), "none");
  assert.equal(tiers.canUseProFeatures(user("pro", null, "unknown")), false);
});

test("a self-serve account without a trial, a grant or a subscription has no plan", () => {
  assert.equal(tiers.getAccountTier(selfServe("trial", new Date(now.getTime() + 1))), "trial");
  for (const expiry of [null, now, new Date(now.getTime() - 1)]) assert.equal(tiers.getAccountTier(selfServe("trial", expiry)), "none");
  assert.equal(tiers.hasPlan(selfServe("trial", null)), false);
  // An administrator can still grant a plan to a self-serve account.
  assert.equal(tiers.getAccountTier(selfServe("basic")), "basic");
  assert.equal(tiers.hasPlan({ ...selfServe("pro"), active: false }), false);
  assert.equal(tiers.trialEndsAt(now).getTime() - now.getTime(), tiers.TRIAL_DAYS * 86_400_000);
});

test("a Stripe subscription decides the plan while active, trialing or briefly past due", () => {
  for (const status of ["active", "trialing"]) assert.equal(tiers.getAccountTier(billed("lite", status)), "lite");
  assert.equal(tiers.getAccountTier(billed("promax", "active")), "promax");
  const grace = tiers.PAST_DUE_GRACE_DAYS * 86_400_000;
  assert.equal(tiers.getAccountTier(billed("basic", "past_due", { billingPastDueSince: new Date(now.getTime() - grace + 1) })), "basic");
  assert.equal(tiers.getAccountTier(billed("basic", "past_due", { billingPastDueSince: new Date(now.getTime() - grace) })), "none");
  assert.equal(tiers.getAccountTier(billed("basic", "past_due")), "none", "past due with no start date grants nothing");
  for (const status of ["canceled", "incomplete", "incomplete_expired", "unpaid", "paused", null]) {
    assert.equal(tiers.getAccountTier(billed("pro", status)), "none", String(status));
  }
  for (const plan of ["admin", "trial", "PRO", "unknown", null]) assert.equal(tiers.getAccountTier(billed(plan, "active")), "none", String(plan));
  // A subscription comes before what an administrator granted, either way.
  assert.equal(tiers.getAccountTier(user("pro", null, "recruiter", true, { billingPlan: "lite", billingStatus: "active" })), "lite");
  assert.equal(tiers.getAccountTier(user("lite", null, "recruiter", true, { billingPlan: "pro", billingStatus: "canceled" })), "lite");
});

test("Trial grants Pro access only strictly before expiry, without a cleanup job", () => {
  for (const expiry of [null, new Date(NaN), new Date(now.getTime() - 1), now]) {
    assert.equal(tiers.getAccountTier(user("trial", expiry)), "basic");
    assert.equal(tiers.canUseProFeatures(user("trial", expiry)), false);
  }
  const trial = user("trial", new Date(now.getTime() + 1));
  assert.equal(tiers.getAccountTier(trial), "trial");
  assert.equal(tiers.canUseProFeatures(trial), true);
  assert.equal(tiers.canUseProFeatures(trial, new Date(now.getTime() + 1)), false);
  assert.equal(trial.accountTier, "trial");
  for (const role of ["admin", "recruiter"]) {
    for (const tier of ["basic", "pro", "trial"]) {
      const account = user(tier, new Date(now.getTime() + 1000), role);
      assert.equal(tiers.canUseProFeatures(account), role === "admin" || tier !== "basic");
      assert.equal(tiers.canUseProFeatures({ ...account, active: false }), false);
    }
  }
});

test("tier input allows only ordinary tiers and requires a real future UTC minute for Trial", () => {
  for (const tier of ["admin", "recruiter", "PRO", "none", "", null, undefined]) {
    assert.ok(tiers.parseAccountTier(tier, "2026-09-19T12:00").error);
  }
  for (const expiry of ["", null, "tomorrow", "2026-09-18T12:00", "2026-09-18T11:59", "2027-02-30T12:00", "2026-13-01T12:00", "2026-09-19T24:00", "2026-09-19T12:00Z", "2026-09-19T12:00+08:00"]) {
    assert.ok(tiers.parseAccountTier("trial", expiry).error, String(expiry));
  }
  const parsed = tiers.parseAccountTier("trial", "2026-09-19T12:30").data;
  assert.equal(parsed.accountTier, "trial");
  assert.equal(parsed.trialExpiresAt.toISOString(), "2026-09-19T12:30:00.000Z");
  for (const tier of ["lite", "basic", "pro", "promax"]) {
    assert.equal(tiers.parseAccountTier(tier, "untrusted stale value").data.trialExpiresAt, null);
  }
});

function guardHarness() {
  const controls = { actor: user(), owner: null, readOnly: false, sameOrigin: true, signedIn: true };
  const guards = load("lib/feature-access.ts", {
    "@/lib/account-tiers": tiers,
    "@/lib/auth": { assertSameOrigin: () => { if (!controls.sameOrigin) throw new Error("Wrong origin"); } },
    "@/lib/workspace": { NO_PLAN_MESSAGE: "Your trial has ended.", getWorkspace: async () => {
      if (!controls.signedIn) throw new Error("Sign in required");
      const noPlan = !controls.owner && !tiers.hasPlan(controls.actor, now);
      return { user: controls.actor, owner: controls.owner ?? controls.actor, readOnly: controls.readOnly || noPlan, noPlan };
    } },
    "@/lib/features": features,
    "next/navigation": { notFound: () => { throw new Error("Not found"); } },
  });
  return { controls, guards };
}
const features = load("lib/features.ts", { "./account-tiers": tiers });

// Generated from FEATURE_TIERS, so moving a feature between tiers moves its
// expected behaviour here too without editing the test.
test("every feature in FEATURE_TIERS is guarded by exactly its tier", async () => {
  assert.ok(features.FEATURES.length > 0);
  const accounts = [
    user("lite"), user(), user("trial", now), user("pro"), user("promax"), user("trial", new Date(now.getTime() + 1)), user("basic", null, "admin"),
    selfServe("trial", new Date(now.getTime() + 1)), selfServe("trial", now), billed("lite", "active"), billed("basic", "active"),
  ];
  for (const feature of features.FEATURES) {
    const tier = features.FEATURE_TIERS[feature];
    assert.ok(["lite", "basic", "pro"].includes(tier), feature);
    for (const account of accounts) {
      const h = guardHarness();
      h.controls.actor = account;
      const effective = tiers.getAccountTier(account, now);
      const noPlan = effective === "none";
      // No plan still reads what every plan has, and writes nothing.
      const allowed = tiers.PLAN_RANK[noPlan ? "lite" : effective] >= tiers.PLAN_RANK[tier];
      assert.equal(features.canUseFeature(account, feature, now), allowed, `${feature} ${account.accountTier} ${account.role}`);
      if (allowed) {
        assert.equal((await h.guards.requireFeature(feature)).owner, account);
        if (noPlan) await assert.rejects(h.guards.requireWritableFeature(feature), /trial has ended/);
        else assert.equal(await h.guards.requireWritableFeature(feature), account);
      } else {
        await assert.rejects(h.guards.requireFeature(feature), /Not found/);
        await assert.rejects(h.guards.requireWritableFeature(feature), /Not found/);
      }
    }
    // Inactive accounts can use nothing, whatever the tier.
    assert.equal(features.canUseFeature(user("pro", null, "recruiter", false), feature, now), false);
    // A read-only Admin view follows the owner's tier and never writes.
    const h = guardHarness();
    h.controls.actor = user("basic", null, "admin");
    h.controls.owner = { ...user(), id: "other" };
    h.controls.readOnly = true;
    if (tier !== "pro") {
      assert.equal((await h.guards.requireFeature(feature)).owner.id, "other");
      await assert.rejects(h.guards.requireWritableFeature(feature), /read-only/);
    } else {
      await assert.rejects(h.guards.requireFeature(feature), /Not found/);
    }
    const availability = await h.guards.featureAvailability();
    assert.equal(availability[feature], tier !== "pro");
  }
});

test("feature guards hide Basic and expired Trial from direct reads and writes", async () => {
  for (const account of [user("lite"), user(), user("trial", now), user("pro", null, "recruiter", false), selfServe("trial", now)]) {
    const h = guardHarness();
    h.controls.actor = account;
    await assert.rejects(h.guards.requireProWorkspace(), /Not found/);
    await assert.rejects(h.guards.requireWritableProWorkspace(), /Not found/);
  }
  for (const account of [user("basic", null, "admin"), user("pro"), user("promax"), user("trial", new Date(now.getTime() + 1)), billed("pro", "active")]) {
    const h = guardHarness();
    h.controls.actor = account;
    assert.equal((await h.guards.requireProWorkspace()).owner, account);
    assert.equal(await h.guards.requireWritableProWorkspace(), account);
    h.controls.sameOrigin = false;
    await assert.rejects(h.guards.requireWritableProWorkspace(), /origin/);
    h.controls.signedIn = false;
    await assert.rejects(h.guards.requireProWorkspace(), /Sign in/);
  }
});

test("feature guards retain owner scope and read-only administrator restrictions", async () => {
  const h = guardHarness();
  h.controls.actor = user("basic", null, "admin");
  h.controls.owner = { ...user("pro"), id: "other" };
  h.controls.readOnly = true;
  assert.equal((await h.guards.requireProWorkspace()).owner.id, "other");
  await assert.rejects(h.guards.requireWritableProWorkspace(), /read-only/);
  h.controls.owner = user();
  await assert.rejects(h.guards.requireProWorkspace(), /Not found/);
});

function actionHarness() {
  const users = new Map([['admin', { ...user("basic", null, "admin"), id: "admin" }], ['recruiter', user()]]);
  const audits = [];
  const paths = [];
  const controls = { actor: "admin", readOnly: false, sameOrigin: true, auditFails: false };
  const db = {
    user: { updateMany: async ({ where, data }) => {
      assert.equal(where.role, "recruiter");
      assert.equal(data.role, undefined);
      const target = users.get(where.id);
      if (!target || target.role !== where.role) return { count: 0 };
      Object.assign(target, data);
      return { count: 1 };
    } },
    auditEvent: { create: async ({ data }) => {
      if (controls.auditFails) throw new Error("Audit unavailable");
      audits.push(data);
    } },
    $transaction: async (callback) => {
      const before = structuredClone({ users: [...users], audits });
      try { return await callback(db); } catch (error) {
        users.clear();
        for (const [id, value] of before.users) users.set(id, value);
        audits.splice(0, audits.length, ...before.audits);
        throw error;
      }
    },
  };
  const assertSameOrigin = () => { if (!controls.sameOrigin) throw new Error("Wrong origin"); };
  const actions = load("app/actions/accounts.ts", {
    "@/lib/db": { db },
    "@/lib/account-tiers": tiers,
    "@/lib/auth-crypto": {},
    // A new account starts current on the release notice; nothing here is
    // about which release it was shown.
    "@/lib/release": { CURRENT_RELEASE: "test-release" },
    "@/lib/account-deletion": { deleteAccountData: async () => {} },
    "@/lib/billing": { billingConfigured: () => false, hasLiveSubscription: () => false, stripe: () => { throw new Error("no stripe"); } },
    "@/lib/auth": { assertSameOrigin, endSession: async () => {}, requireAdmin: async () => {
      const actor = users.get(controls.actor);
      if (!actor?.active || actor.role !== "admin") throw new Error("Administrator access is required");
      return actor;
    } },
    "@/lib/workspace": { requireOwnAccount: async () => users.get(controls.actor), requireWritableWorkspace: async () => {
      assertSameOrigin();
      if (controls.readOnly) throw new Error("This workspace is read-only");
      return users.get(controls.actor);
    } },
    "next/cache": { revalidatePath: (...args) => paths.push(args) },
    "next/navigation": {},
  });
  return { controls, users, audits, paths, actions };
}

test("admin tier changes are atomic, audited, preserve role and clear obsolete expiry", async () => {
  const h = actionHarness();
  for (const accountTier of ["lite", "promax", "pro", "trial", "basic"]) {
    const result = await h.actions.setAccountTier({}, form({ userId: "recruiter", accountTier, trialExpiresAt: "2026-09-19T12:30", role: "admin" }));
    assert.ok(result.notice);
    assert.equal(h.users.get("recruiter").accountTier, accountTier);
    assert.equal(h.users.get("recruiter").role, "recruiter");
    assert.equal(h.users.get("recruiter").trialExpiresAt?.toISOString() ?? null, accountTier === "trial" ? "2026-09-19T12:30:00.000Z" : null);
    assert.equal(h.audits.at(-1).action, `account_tier_changed_to_${accountTier}`);
    assert.equal(h.audits.at(-1).actorId, "admin");
    assert.equal(h.audits.at(-1).targetUserId, "recruiter");
  }
  assert.ok(h.paths.some(([route, type]) => route === "/" && type === "layout"));
  h.controls.auditFails = true;
  await assert.rejects(h.actions.setAccountTier({}, form({ userId: "recruiter", accountTier: "pro" })), /Audit/);
  assert.equal(h.users.get("recruiter").accountTier, "basic");
  assert.equal(h.audits.length, 5);
});

test("existing account reset and enable actions also reject read-only admin views before any mutation", async () => {
  for (const action of ["issueActivation", "setAccountActive"]) {
    const h = actionHarness();
    h.controls.readOnly = true;
    await assert.rejects(h.actions[action]({}, form({ userId: "recruiter", active: "false" })), /read-only/);
    assert.equal(h.users.get("recruiter").active, true);
    assert.equal(h.audits.length, 0);
  }
});

test("forged account classification requests cannot grant admin or bypass actor and workspace guards", async () => {
  for (const values of [{ userId: "admin", accountTier: "pro" }, { userId: "missing", accountTier: "pro" }, { userId: "recruiter", accountTier: "admin" }, { userId: "recruiter", accountTier: "none" }, { userId: "recruiter", accountTier: "trial" }]) {
    const h = actionHarness();
    assert.ok((await h.actions.setAccountTier({}, form(values))).error);
    assert.equal(h.audits.length, 0);
    assert.equal(h.users.get("admin").role, "admin");
  }
  for (const tier of ["basic", "pro", "trial"]) {
    const h = actionHarness();
    h.controls.actor = "recruiter";
    h.users.get("recruiter").accountTier = tier;
    await assert.rejects(h.actions.setAccountTier({}, form({ userId: "recruiter", accountTier: "pro" })), /Administrator/);
    assert.equal(h.audits.length, 0);
  }
  for (const setting of ["readOnly", "sameOrigin"]) {
    const h = actionHarness();
    h.controls[setting] = setting === "readOnly";
    await assert.rejects(h.actions.setAccountTier({}, form({ userId: "recruiter", accountTier: "pro" })), /read-only|origin/);
    assert.equal(h.users.get("recruiter").accountTier, "basic");
    assert.equal(h.audits.length, 0);
  }
});

test("the custom shortlist limit follows the effective tier, not the stored one", () => {
  const limit = (account) => features.activeShortlistLimit(account, now);
  assert.equal(limit(user()), features.SHORTLIST_LIMITS.belowPro);
  assert.equal(limit(user("lite")), features.SHORTLIST_LIMITS.belowPro);
  assert.equal(limit(user("pro")), null);
  assert.equal(limit(user("promax")), null);
  assert.equal(limit(user("trial", new Date(now.getTime() + 1))), null);
  assert.equal(limit(user("trial", now)), features.SHORTLIST_LIMITS.belowPro, "a trial ending now is Basic");
  assert.equal(limit(user("basic", null, "admin")), null);
  assert.equal(limit(user("pro", null, "recruiter", false)), features.SHORTLIST_LIMITS.belowPro);
  assert.equal(features.SHORTLIST_LIMITS.belowPro, 3);
});

test("a Lite follow-up run takes a batch at a time; Basic and above have no limit", () => {
  const limit = (account) => features.followUpRunLimit(account, now);
  assert.equal(limit(user("lite")), features.LITE_FOLLOWUP_RUN_LIMIT);
  assert.equal(limit(billed("lite", "active")), features.LITE_FOLLOWUP_RUN_LIMIT);
  for (const account of [user(), user("pro"), user("promax"), user("trial", new Date(now.getTime() + 1)), user("basic", null, "admin")]) assert.equal(limit(account), null);
});

test("monthly AI allowances follow the plan, and a deployment ceiling only lowers them", () => {
  const quota = (account, kind, ceiling = null) => features.monthlyQuota(account, kind, ceiling, now);
  assert.equal(quota(user(), "screening"), 30);
  assert.equal(quota(user("pro"), "screening"), 120);
  assert.equal(quota(user("lite"), "screening"), 0);
  assert.equal(quota(selfServe("trial", new Date(now.getTime() + 1)), "screening"), 10);
  assert.equal(quota(selfServe("trial", new Date(now.getTime() + 1)), "replies"), 30);
  assert.equal(quota(selfServe("trial", now), "matches"), 0);
  assert.equal(quota(user("pro"), "screening", 50), 50);
  assert.equal(quota(user(), "screening", 500), 30);
  for (const kind of Object.keys(features.MONTHLY_QUOTAS)) {
    for (const tier of Object.keys(tiers.PLAN_RANK)) assert.ok(Number.isInteger(features.MONTHLY_QUOTAS[kind][tier]), `${kind} ${tier}`);
  }
});
