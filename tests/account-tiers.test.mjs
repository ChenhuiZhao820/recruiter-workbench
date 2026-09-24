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
const user = (accountTier = "basic", trialExpiresAt = null, role = "recruiter", active = true) => ({ id: "recruiter", role, active, accountTier, trialExpiresAt });
const form = (values) => {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
};

test("effective account types preserve admin and default unknown tiers to Basic", () => {
  for (const accountTier of ["basic", "pro", "trial", "admin", "unknown", undefined]) {
    assert.equal(tiers.getAccountTier(user(accountTier, null, "admin")), "admin");
  }
  assert.equal(tiers.getAccountTier(user()), "basic");
  assert.equal(tiers.getAccountTier(user("pro")), "pro");
  for (const value of ["admin", "unknown", "PRO", "", null]) assert.equal(tiers.getAccountTier(user(value)), "basic");
  assert.equal(tiers.canUseProFeatures(user("pro", null, "unknown")), false);
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
  for (const tier of ["admin", "recruiter", "PRO", "", null, undefined]) {
    assert.ok(tiers.parseAccountTier(tier, "2026-09-19T12:00").error);
  }
  for (const expiry of ["", null, "tomorrow", "2026-09-18T12:00", "2026-09-18T11:59", "2027-02-30T12:00", "2026-13-01T12:00", "2026-09-19T24:00", "2026-09-19T12:00Z", "2026-09-19T12:00+08:00"]) {
    assert.ok(tiers.parseAccountTier("trial", expiry).error, String(expiry));
  }
  const parsed = tiers.parseAccountTier("trial", "2026-09-19T12:30").data;
  assert.equal(parsed.accountTier, "trial");
  assert.equal(parsed.trialExpiresAt.toISOString(), "2026-09-19T12:30:00.000Z");
  for (const tier of ["basic", "pro"]) {
    assert.equal(tiers.parseAccountTier(tier, "untrusted stale value").data.trialExpiresAt, null);
  }
});

function guardHarness() {
  const controls = { actor: user(), owner: null, readOnly: false, sameOrigin: true, signedIn: true };
  const guards = load("lib/feature-access.ts", {
    "@/lib/account-tiers": tiers,
    "@/lib/auth": { assertSameOrigin: () => { if (!controls.sameOrigin) throw new Error("Wrong origin"); } },
    "@/lib/workspace": { getWorkspace: async () => {
      if (!controls.signedIn) throw new Error("Sign in required");
      return { user: controls.actor, owner: controls.owner ?? controls.actor, readOnly: controls.readOnly };
    } },
    "next/navigation": { notFound: () => { throw new Error("Not found"); } },
  });
  return { controls, guards };
}

test("feature guards hide Basic and expired Trial from direct reads and writes", async () => {
  for (const account of [user(), user("trial", now), user("pro", null, "recruiter", false)]) {
    const h = guardHarness();
    h.controls.actor = account;
    await assert.rejects(h.guards.requireProWorkspace(), /Not found/);
    await assert.rejects(h.guards.requireWritableProWorkspace(), /Not found/);
  }
  for (const account of [user("basic", null, "admin"), user("pro"), user("trial", new Date(now.getTime() + 1))]) {
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
    "@/lib/auth": { assertSameOrigin, requireAdmin: async () => {
      const actor = users.get(controls.actor);
      if (!actor?.active || actor.role !== "admin") throw new Error("Administrator access is required");
      return actor;
    } },
    "@/lib/workspace": { requireWritableWorkspace: async () => {
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
  for (const accountTier of ["pro", "trial", "basic"]) {
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
  assert.equal(h.audits.length, 3);
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
  for (const values of [{ userId: "admin", accountTier: "pro" }, { userId: "missing", accountTier: "pro" }, { userId: "recruiter", accountTier: "admin" }, { userId: "recruiter", accountTier: "trial" }]) {
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
