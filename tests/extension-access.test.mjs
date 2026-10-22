import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// The extension comes with a plan: there is no activation code any more. What
// these tests hold is that only an account with a plan (or an administrator)
// can generate a capture key or use one, so a copy of the extension passed to
// someone else saves nothing for them.

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const now = new Date("2026-09-10T12:00:00.000Z");
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
    module, exports: module.exports, Buffer, URL, Date: TestDate,
    require: (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id),
  }, { filename });
  return module.exports;
}

const crypto = load("lib/auth-crypto.ts");
const tiers = load("lib/account-tiers.ts");
const access = load("lib/extension-access.ts", { "@/lib/account-tiers": tiers });

// Plan states an account can be in.
const PLANS = {
  basic: { accountTier: "basic", trialExpiresAt: null, signupSource: "admin" },
  trial: { accountTier: "trial", trialExpiresAt: new Date(now.getTime() + 86_400_000), signupSource: "self" },
  ended: { accountTier: "trial", trialExpiresAt: new Date(now.getTime() - 1), signupSource: "self" },
  paid: { accountTier: "trial", trialExpiresAt: null, signupSource: "self", billingPlan: "lite", billingStatus: "active" },
  cancelled: { accountTier: "trial", trialExpiresAt: null, signupSource: "self", billingPlan: "pro", billingStatus: "canceled" },
};
const withPlan = (plan) => Object.keys(PLANS[plan]).length && tiers.hasPlan({ role: "recruiter", active: true, ...PLANS[plan] }, now);

test("the extension needs an active account with a plan, or an administrator", () => {
  for (const active of [true, false]) {
    for (const role of ["admin", "recruiter", "unknown"]) {
      for (const plan of Object.keys(PLANS)) {
        const account = { active, role, ...PLANS[plan] };
        assert.equal(access.canUseExtension(account, now), active && (role === "admin" || (role === "recruiter" && withPlan(plan))), `${active} ${role} ${plan}`);
      }
    }
  }
});

function harness() {
  const users = new Map(["admin", "recruiter", "other"].map((id) => [id, {
    id, name: id, email: `${id}@fixture.invalid`, role: id === "admin" ? "admin" : "recruiter", active: true, ...PLANS.basic,
  }]));
  const settings = new Map();
  const controls = { actor: "admin", readOnly: false, sameOrigin: true, beforeUpdate: null };
  let writes = 0;
  const db = {
    user: { findUnique: async ({ where, select }) => {
      assert.equal(select.passwordHash, undefined);
      // The workspace's own read of a viewed account selects publicUserSelect, mocked empty here.
      if (Object.keys(select).length) for (const field of ["role", "active", "accountTier", "trialExpiresAt", "signupSource", "billingPlan", "billingStatus", "billingPastDueSince"]) assert.equal(select[field], true, field);
      const user = users.get(where.id);
      return user ? { ...user } : null;
    }, update: async ({ where, data }) => {
      if (controls.beforeUpdate) { const hook = controls.beforeUpdate; controls.beforeUpdate = null; hook(); }
      assert.equal(where.active, true);
      const user = users.get(where.id);
      if (!user || !user.active) throw new Error("Account unavailable");
      const change = data.settings.upsert;
      settings.set(user.id, settings.has(user.id) ? { ...settings.get(user.id), ...change.update } : change.create);
      writes++;
    } },
    settings: { upsert: async ({ where, create, update }) => {
      settings.set(where.userId, settings.has(where.userId) ? { ...settings.get(where.userId), ...update } : create);
      writes++;
    } },
    $transaction: async (callback) => {
      const previous = structuredClone({ settings: [...settings], writes });
      try { return await callback(db); } catch (error) {
        settings.clear();
        for (const [id, value] of previous.settings) settings.set(id, value);
        writes = previous.writes;
        throw error;
      }
    },
  };
  const workspace = load("lib/workspace.ts", {
    "@/lib/db": { db },
    "@/lib/account-tiers": tiers,
    "next/navigation": { redirect: () => { throw new Error("Sign in required"); }, notFound: () => { throw new Error("Missing workspace"); } },
    "@/lib/auth": {
      assertSameOrigin: () => { if (!controls.sameOrigin) throw new Error("Request did not come from the workbench"); },
      getSession: async () => ({ user: users.get(controls.actor), viewUserId: controls.readOnly ? "other" : null }),
      publicUserSelect: {},
    },
  });
  const mocks = {
    "@/lib/db": { db }, "@/lib/workspace": workspace, "@/lib/auth-crypto": crypto, "@/lib/extension-access": access,
    "next/cache": { revalidatePath: () => {} },
    "@/lib/capture": { newCaptureToken: crypto.newSecret },
  };
  return { users, settings, controls, get writes() { return writes; }, settingsActions: load("app/actions/settings.ts", mocks) };
}

test("a capture key is generated only for an active account with a plan, or an administrator", async () => {
  for (const actor of ["admin", "recruiter"]) {
    for (const active of [true, false]) {
      for (const plan of Object.keys(PLANS)) {
        const h = harness();
        h.controls.actor = actor;
        Object.assign(h.users.get(actor), { active, ...PLANS[plan] });
        h.settings.set(actor, { captureTokenHash: "preexisting-key-hash" });
        const allowed = active && (actor === "admin" || withPlan(plan));
        const attempt = h.settingsActions.regenerateCaptureToken();
        if (allowed) {
          const result = await attempt;
          assert.ok(result.token, `${actor} ${active} ${plan}`);
          assert.equal(h.settings.get(actor).captureTokenHash, crypto.hashToken(result.token));
          continue;
        }
        // Without a plan the workspace is read-only, so the action refuses
        // before reading anything; otherwise it answers with an error.
        try {
          assert.match((await attempt).error, /plan/);
        } catch (error) {
          assert.match(error.message, /trial has ended/);
        }
        assert.equal(h.settings.get(actor).captureTokenHash, "preexisting-key-hash");
        assert.equal(h.writes, 0);
      }
    }
  }
});

test("capture key generation rechecks the account at the write and blocks read-only views", async () => {
  const h = harness();
  h.settings.set("admin", { captureTokenHash: "preexisting-key-hash" });
  h.controls.beforeUpdate = () => { h.users.get("admin").active = false; };
  assert.ok((await h.settingsActions.regenerateCaptureToken()).error);
  assert.equal(h.settings.get("admin").captureTokenHash, "preexisting-key-hash");
  assert.equal(h.writes, 0);
  h.users.get("admin").active = true;
  h.controls.readOnly = true;
  await assert.rejects(h.settingsActions.regenerateCaptureToken(), /read-only/);
  assert.equal(h.writes, 0);
});

test("capture GET and POST deny an existing key once the plan has ended, and keep 401/CORS", async () => {
  for (const active of [true, false]) {
    for (const role of ["admin", "recruiter"]) {
      for (const plan of Object.keys(PLANS)) {
        const account = { id: "recruiter", email: "recruiter@fixture.invalid", name: "Recruiter", role, active, ...PLANS[plan] };
        const shared = {
          "next/server": { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200, headers: options.headers }) } },
          "@/lib/auth-crypto": crypto, "@/lib/extension-access": access,
          "@/lib/capture": { corsHeaders: () => ({ "Access-Control-Allow-Origin": "chrome-extension://fixture" }) },
          "@/lib/db": { db: {
            settings: { findUnique: async ({ select }) => {
              for (const field of ["role", "active", "accountTier", "trialExpiresAt", "signupSource", "billingPlan", "billingStatus"]) assert.equal(select.user.select[field], true, field);
              return { user: account };
            } },
            role: { findMany: async ({ where }) => { assert.equal(where.userId, account.id); return []; } },
          } },
        };
        // The key check every capture route shares, loaded for real.
        const captureAuth = load("lib/capture-auth.ts", shared);
        const route = load("app/api/capture/route.ts", {
          ...shared,
          "@/lib/capture-auth": captureAuth,
          "next/cache": { revalidatePath: () => {} },
          "@/lib/urls": { normalizeProfileUrl: (url) => url },
          "@/lib/linkedin": { memberIdOrNull: (value) => value || null },
          "@/lib/people": { findOrCreatePerson: async () => { throw new Error("no write expected"); }, isSuppressed: async () => false },
          "@/lib/person-keys.mjs": { canonicalProfileUrl: (url) => url, cleanEmail: (value) => value },
          "@/lib/features": { canUseFeature: () => false },
          "@/lib/email-finder": { emailAllowance: async () => { throw new Error("no allowance expected"); } },
          "@/lib/enrow-core.mjs": { enrowKey: () => null },
        });
        const request = new Request("http://localhost:3000/api/capture", { headers: { "x-capture-token": crypto.newSecret() } });
        const get = await route.GET(request);
        const post = await route.POST(request);
        if (access.canUseExtension(account)) {
          assert.equal(get.status, 200);
          assert.deepEqual(Object.keys(get.body.account).sort(), ["email", "id", "name"]);
          assert.equal(post.status, 400);
        } else {
          for (const result of [get, post]) {
            assert.equal(result.status, 401);
            assert.match(result.body.error, /no plan/);
            assert.equal(result.headers["Access-Control-Allow-Origin"], "chrome-extension://fixture");
          }
        }
      }
    }
  }
});
