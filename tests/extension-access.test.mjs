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
const access = load("lib/extension-access.ts", { "@/lib/auth-crypto": crypto });
const form = (values) => {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
};

function harness() {
  const users = new Map(["admin", "recruiter", "other"].map((id) => [id, {
    id, name: id, email: `${id}@fixture.invalid`, role: id === "admin" ? "admin" : "recruiter", active: true,
  }]));
  const records = new Map();
  const settings = new Map();
  const audits = [];
  const paths = [];
  const attempts = [];
  const controls = { actor: "admin", readOnly: false, sameOrigin: true, allowAttempt: true, auditFails: false, beforeUpdate: null };
  let writes = 0;
  const db = {
    user: { findUnique: async ({ where, select }) => {
      assert.equal(select.extensionAccess.select.activatedAt, true);
      assert.equal(select.passwordHash, undefined);
      const user = users.get(where.id);
      return user ? { ...user, extensionAccess: records.get(user.id) ?? null } : null;
    }, update: async ({ where, data }) => {
      if (controls.beforeUpdate) { const hook = controls.beforeUpdate; controls.beforeUpdate = null; hook(); }
      assert.equal(where.active, true);
      assert.equal(where.OR[0].role, "admin");
      assert.equal(where.OR[1].extensionAccess.activatedAt.not, null);
      const user = users.get(where.id);
      if (!user || !access.canUseExtension({ ...user, extensionAccess: records.get(user.id) })) throw new Error("Account unavailable");
      const change = data.settings.upsert;
      settings.set(user.id, settings.has(user.id) ? { ...settings.get(user.id), ...change.update } : change.create);
      writes++;
    } },
    extensionAccess: {
      create: async ({ data }) => {
        if (records.has(data.userId)) throw new Error("Unique constraint");
        records.set(data.userId, { activatedAt: null, ...data });
        writes++;
      },
      updateMany: async ({ where, data }) => {
        if (controls.beforeUpdate) { const hook = controls.beforeUpdate; controls.beforeUpdate = null; hook(); }
        assert.equal(where.activatedAt, null);
        assert.equal(where.user.active, true);
        assert.equal(where.user.role, "recruiter");
        const record = records.get(where.userId);
        const user = users.get(where.userId);
        if (!record || record.activatedAt || !user?.active || user.role !== "recruiter" ||
            (where.codeHash && record.codeHash !== where.codeHash) ||
            (where.expiresAt && !(record.expiresAt > where.expiresAt.gt))) return { count: 0 };
        Object.assign(record, data);
        writes++;
        return { count: 1 };
      },
    },
    auditEvent: { create: async ({ data }) => {
      if (controls.auditFails) throw new Error("Audit unavailable");
      assert.deepEqual(Object.keys(data).sort(), ["action", "actorId", "targetUserId"]);
      audits.push(data);
    } },
    settings: { upsert: async ({ where, create, update }) => {
      settings.set(where.userId, settings.has(where.userId) ? { ...settings.get(where.userId), ...update } : create);
      writes++;
    } },
    $transaction: async (callback) => {
      const previous = structuredClone({ records: [...records], settings: [...settings], audits, writes });
      try { return await callback(db); } catch (error) {
        records.clear(); settings.clear();
        for (const [id, value] of previous.records) records.set(id, value);
        for (const [id, value] of previous.settings) settings.set(id, value);
        audits.splice(0, audits.length, ...previous.audits);
        writes = previous.writes;
        throw error;
      }
    },
  };
  const workspace = load("lib/workspace.ts", {
    "@/lib/db": { db },
    "next/navigation": { redirect: () => { throw new Error("Sign in required"); }, notFound: () => { throw new Error("Missing workspace"); } },
    "@/lib/auth": {
      assertSameOrigin: () => { if (!controls.sameOrigin) throw new Error("Request did not come from the workbench"); },
      getSession: async () => ({ user: users.get(controls.actor), viewUserId: controls.readOnly ? "other" : null }),
      publicUserSelect: { extensionAccess: { select: { activatedAt: true } } },
    },
  });
  const mocks = {
    "@/lib/db": { db }, "@/lib/workspace": workspace, "@/lib/auth-crypto": crypto, "@/lib/extension-access": access,
    "next/cache": { revalidatePath: (value) => paths.push(value) },
    "@/lib/auth": { takeAuthAttempt: async (...args) => { attempts.push(args); return controls.allowAttempt; } },
    "@/lib/capture": { newCaptureToken: crypto.newSecret },
  };
  return { users, records, settings, audits, paths, attempts, controls, get writes() { return writes; },
    actions: load("app/actions/extension.ts", mocks), settingsActions: load("app/actions/settings.ts", mocks) };
}

async function issue(h, userId = "recruiter") {
  h.controls.actor = "admin";
  return h.actions.issueExtensionCode({}, form({ userId }));
}
async function redeem(h, code, actor = "recruiter") {
  h.controls.actor = actor;
  return h.actions.redeemExtensionCode({}, form({ code, userId: "other" }));
}

test("extension entitlement requires active admin or explicit activation", () => {
  for (const active of [true, false]) {
    for (const role of ["admin", "recruiter"]) {
      for (const extensionAccess of [undefined, null, { activatedAt: null }, { activatedAt: now }]) {
        assert.equal(access.canUseExtension({ active, role, extensionAccess }), active && (role === "admin" || Boolean(extensionAccess?.activatedAt)));
      }
    }
  }
  const code = access.newExtensionCode();
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(code, "base64url").length, 32);
  assert.notEqual(code, access.newExtensionCode());
  assert.equal(access.hashExtensionCode(code), crypto.hashToken(code));
});

test("issuance stores only hashes for exactly seven days; reissue replaces the only code", async () => {
  const h = harness();
  const first = await issue(h);
  assert.ok(first.code);
  assert.equal(h.records.get("recruiter").codeHash, access.hashExtensionCode(first.code));
  assert.equal(h.records.get("recruiter").expiresAt.getTime(), now.getTime() + 604800000);
  const second = await issue(h);
  assert.notEqual(first.code, second.code);
  assert.equal(h.records.size, 1);
  assert.equal(h.records.get("recruiter").codeHash, access.hashExtensionCode(second.code));
  assert.ok(!JSON.stringify([...h.records.values(), ...h.audits]).includes(second.code));
  assert.equal(h.audits.filter((event) => event.action === "extension_code_issued").length, 2);
  assert.ok((await redeem(h, first.code)).error);
  assert.ok((await redeem(h, second.code)).notice);
  assert.deepEqual([...new Set(h.paths)].sort(), ["/account", "/admin", "/settings"]);
});

test("issuance refuses non-admin, inactive, admin, missing and already activated targets", async () => {
  const h = harness();
  h.controls.actor = "recruiter";
  assert.ok((await h.actions.issueExtensionCode({}, form({ userId: "other" }))).error);
  for (const target of ["admin", "missing", ""]) assert.ok((await issue(h, target)).error);
  h.users.get("recruiter").active = false;
  assert.ok((await issue(h)).error);
  h.users.get("recruiter").active = true;
  h.records.set("recruiter", { activatedAt: now, codeHash: null, expiresAt: null });
  assert.ok((await issue(h)).error);
  assert.equal(h.writes, 0);
  assert.equal(h.audits.length, 0);
});

test("both actions enforce same-origin and read-only workspace guards before any writes", async () => {
  for (const guard of ["sameOrigin", "readOnly"]) {
    for (const action of ["issueExtensionCode", "redeemExtensionCode"]) {
      const h = harness();
      h.controls[guard] = guard === "readOnly";
      await assert.rejects(h.actions[action]({}, form({ userId: "recruiter", code: access.newExtensionCode() })), /workbench|read-only/);
      assert.equal(h.writes, 0);
      assert.equal(h.attempts.length, 0);
    }
  }
});

test("redemption is self-scoped, expiring, one-time and clears secret material", async () => {
  const h = harness();
  const { code } = await issue(h);
  assert.ok((await redeem(h, code, "other")).error);
  h.records.get("recruiter").expiresAt = now;
  assert.ok((await redeem(h, code)).error);
  h.records.get("recruiter").expiresAt = new Date(now.getTime() + 1);
  h.users.get("recruiter").active = false;
  assert.ok((await redeem(h, code)).error);
  h.users.get("recruiter").active = true;
  const results = await Promise.all([redeem(h, code), redeem(h, code)]);
  assert.equal(results.filter((result) => result.notice).length, 1);
  assert.equal(results.filter((result) => result.error).length, 1);
  const record = h.records.get("recruiter");
  assert.equal(record.activatedAt.getTime(), now.getTime());
  assert.equal(record.codeHash, null);
  assert.equal(record.expiresAt, null);
  assert.equal(h.audits.filter((event) => event.action === "extension_activated").length, 1);
  assert.ok(h.attempts.every(([key, limit, seconds]) => /^extension:(recruiter|other)$/.test(key) && limit === 10 && seconds === 900));
});

test("reissue cannot overwrite entitlement activated after its initial read", async () => {
  const h = harness();
  await issue(h);
  h.controls.beforeUpdate = () => Object.assign(h.records.get("recruiter"), { activatedAt: now, codeHash: null, expiresAt: null });
  const result = await issue(h);
  assert.ok(result.error);
  assert.equal(result.code, undefined);
  assert.equal(h.records.get("recruiter").activatedAt, now);
  assert.equal(h.records.get("recruiter").codeHash, null);
  assert.equal(h.audits.length, 1);
});

test("throttled and malformed redemption cannot mutate; admins need no code", async () => {
  const h = harness();
  h.controls.allowAttempt = false;
  assert.match((await redeem(h, access.newExtensionCode())).error, /Too many/);
  h.controls.allowAttempt = true;
  assert.ok((await redeem(h, "malformed")).error);
  assert.match((await redeem(h, "", "admin")).notice, /already have/);
  assert.equal(h.attempts.length, 2);
  assert.equal(h.writes, 0);
});

test("audit failure rolls back issue and redemption without returning raw secrets", async () => {
  const h = harness();
  h.controls.auditFails = true;
  assert.ok((await issue(h)).error);
  assert.equal(h.records.size, 0);
  h.controls.auditFails = false;
  const { code } = await issue(h);
  h.controls.auditFails = true;
  const result = await redeem(h, code);
  assert.ok(result.error);
  assert.equal(result.code, undefined);
  assert.equal(h.records.get("recruiter").activatedAt, null);
  assert.equal(h.records.get("recruiter").codeHash, access.hashExtensionCode(code));
});

test("capture key regeneration blocks locked and inactive users before settings mutation", async () => {
  for (const actor of ["admin", "recruiter"]) {
    for (const active of [true, false]) {
      for (const activated of [true, false]) {
        const h = harness();
        h.controls.actor = actor;
        h.users.get(actor).active = active;
        if (activated) h.records.set(actor, { activatedAt: now });
        h.settings.set(actor, { captureTokenHash: "preexisting-key-hash" });
        const result = await h.settingsActions.regenerateCaptureToken();
        if (active && (actor === "admin" || activated)) {
          assert.ok(result.token);
          assert.equal(h.settings.get(actor).captureTokenHash, crypto.hashToken(result.token));
        } else {
          assert.match(result.error, /activation/);
          assert.equal(result.token, undefined);
          assert.equal(h.settings.get(actor).captureTokenHash, "preexisting-key-hash");
          assert.equal(h.writes, 0);
        }
      }
    }
  }
});

test("capture key generation rechecks account eligibility at the write and blocks read-only views", async () => {
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

test("capture GET and POST deny preexisting keys without entitlement and retain 401/CORS", async () => {
  for (const active of [true, false]) {
    for (const role of ["admin", "recruiter"]) {
      for (const activated of [true, false]) {
        const account = { id: "recruiter", email: "recruiter@fixture.invalid", name: "Recruiter", role, active, extensionAccess: activated ? { activatedAt: now } : null };
        const route = load("app/api/capture/route.ts", {
          "next/server": { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200, headers: options.headers }) } },
          "next/cache": { revalidatePath: () => {} },
          "@/lib/auth-crypto": crypto, "@/lib/extension-access": access,
          "@/lib/urls": { normalizeProfileUrl: (url) => url },
          "@/lib/capture": { corsHeaders: () => ({ "Access-Control-Allow-Origin": "chrome-extension://fixture" }) },
          "@/lib/db": { db: {
            settings: { findUnique: async ({ select }) => {
              assert.equal(select.user.select.role, true);
              assert.deepEqual(Object.keys(select.user.select.extensionAccess.select), ["activatedAt"]);
              return { user: account };
            } },
            role: { findMany: async ({ where }) => { assert.equal(where.userId, account.id); return []; } },
          } },
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
            assert.match(result.body.error, /extension activation/);
            assert.equal(result.headers["Access-Control-Allow-Origin"], "chrome-extension://fixture");
          }
        }
      }
    }
  }
});
