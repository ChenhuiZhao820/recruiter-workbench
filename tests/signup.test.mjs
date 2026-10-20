import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import {
  cookieValue, isDisposableEmail, isSignupCode, readTermsCookie, signTermsCookie, signupName, trialKeyForEmail, TERMS_COOKIE,
} from "../lib/signup-core.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const now = new Date("2026-10-24T12:00:00.000Z");
const secret = "test-only-better-auth-secret-000000000000";

test("one trial per address, whatever its case or +tag", () => {
  assert.equal(trialKeyForEmail("Jane.Doe+trial2@Example.com"), trialKeyForEmail("jane.doe@example.com"));
  assert.notEqual(trialKeyForEmail("jane.doe@example.com"), trialKeyForEmail("jane.doe@example.org"));
  assert.match(trialKeyForEmail("a@b.c"), /^[0-9a-f]{64}$/);
});

test("throwaway inboxes, names and codes", () => {
  for (const email of ["x@mailinator.com", "x@sub.yopmail.com", "X@GuerrillaMail.com"]) assert.equal(isDisposableEmail(email), true, email);
  for (const email of ["x@gmail.com", "x@company.co.uk", "x@notmailinator.com"]) assert.equal(isDisposableEmail(email), false, email);
  assert.equal(signupName("  Jane   Doe "), "Jane Doe");
  for (const name of ["", "   ", null, "x".repeat(121)]) assert.equal(signupName(name), null);
  for (const code of ["123456", " 000000 "]) assert.equal(isSignupCode(code), true);
  for (const code of ["12345", "1234567", "12a456", "", null]) assert.equal(isSignupCode(code), false);
});

test("the terms cookie is signed, short-lived and bound to the secret", () => {
  const value = signTermsCookie("2026-10", secret, now.getTime());
  assert.deepEqual(readTermsCookie(value, secret, now.getTime() + 60_000), { version: "2026-10", acceptedAt: now });
  assert.equal(readTermsCookie(value, secret, now.getTime() + 16 * 60_000), null, "expired");
  assert.equal(readTermsCookie(value, "another-secret-000000000000000000000000", now.getTime()), null);
  assert.equal(readTermsCookie(value.replace("2026-10", "2027-01"), secret, now.getTime()), null, "tampered version");
  assert.equal(readTermsCookie(signTermsCookie("1", secret, now.getTime() + 5 * 60_000), secret, now.getTime()), null, "from the future");
  for (const bad of ["", null, "a.b", "a.b.c.d", value, "x"]) assert.equal(readTermsCookie(bad, "", now.getTime()), null);
  assert.equal(cookieValue(`a=1; ${TERMS_COOKIE}=${value}; b=2`, TERMS_COOKIE), value);
  assert.equal(cookieValue("a=1", TERMS_COOKIE), null);
});

// The Better Auth glue, with Better Auth itself replaced by a stand-in that
// keeps the configuration, so the rules this app adds are tested directly.
function loadAuth({ users = new Map(), claims = new Set(), pending = new Map() } = {}) {
  const filename = path.join(root, "lib/better-auth.ts");
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  let config = null;
  const issued = [];
  const revoked = [];
  const writes = [];
  const db = {
    trialClaim: { findUnique: async ({ where }) => claims.has(where.keyHash) ? { keyHash: where.keyHash } : null, upsert: (args) => ({ op: "claim", args }) },
    pendingSignup: { findUnique: async ({ where }) => pending.get(where.email) ?? null, deleteMany: (args) => ({ op: "pending", args }) },
    settings: { upsert: (args) => ({ op: "settings", args }) },
    auditEvent: { create: (args) => ({ op: "audit", args }) },
    user: { findUnique: async ({ where }) => users.get(where.id) ?? null },
    $transaction: async (operations) => { writes.push(...operations); },
  };
  const mocks = {
    "better-auth": { betterAuth: (options) => { config = options; return { api: {} }; } },
    "better-auth/adapters/prisma": { prismaAdapter: () => "adapter" },
    "better-auth/api": { createAuthMiddleware: (handler) => handler },
    "better-auth/cookies": { deleteSessionCookie: (ctx) => ctx.deleted.push("better-auth cookie") },
    "better-auth/next-js": { nextCookies: () => ({ id: "next-cookies" }) },
    "better-auth/plugins/email-otp": { emailOTP: (options) => ({ id: "email-otp", options }) },
    "@/lib/db": { db },
    "@/lib/auth": {
      appOrigin: () => "https://retrivr.example",
      issueSessionToken: async (userId, authVersion) => { issued.push({ userId, authVersion }); return "workbench-token"; },
      revokeSessionToken: async (token) => { revoked.push(token); },
      sessionCookieName: () => "__Host-capture_session",
      sessionCookieOptions: () => ({ httpOnly: true, secure: true, sameSite: "lax", path: "/" }),
    },
    "@/lib/account-tiers": { trialEndsAt: () => new Date(now.getTime() + 7 * 86_400_000) },
    "@/lib/mailer": { sendMail: async () => {} },
    "@/lib/release": { CURRENT_RELEASE: "test-release" },
    "@/lib/retention": { purgeExpiredTranscripts: async () => {} },
    "@/lib/signup-core.mjs": { CODE_MINUTES: 10, TERMS_COOKIE, cookieValue, isDisposableEmail, readTermsCookie, trialKeyForEmail },
  };
  const module = { exports: {} };
  const env = { ...process.env, BETTER_AUTH_SECRET: secret, DATABASE_URL: "file:./x.db", GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs" };
  delete env.MICROSOFT_CLIENT_ID;
  vm.runInNewContext(source, {
    module, exports: module.exports, Buffer, URL, Date, process: { ...process, env },
    require: (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id),
  }, { filename });
  module.exports.getAuth();
  return { config, issued, revoked, writes };
}

// Values made inside the sandbox come from another realm; compare them as data.
const plain = (value) => JSON.parse(JSON.stringify(value));
const before = (h, user, ctx) => h.config.databaseHooks.user.create.before(user, ctx);
const cookieHeader = (value) => new Headers({ cookie: `${TERMS_COOKIE}=${value}` });

test("Better Auth is configured to prove identity only", () => {
  const h = loadAuth();
  assert.equal(h.config.emailAndPassword.enabled, false);
  assert.deepEqual(Object.keys(h.config.socialProviders), ["google"]);
  assert.deepEqual(plain(h.config.account.accountLinking.trustedProviders), [], "linking by email only when the provider verified it");
  assert.deepEqual(plain(h.config.trustedOrigins), ["https://retrivr.example"]);
  assert.equal(h.config.session.modelName, "authSession");
  assert.ok(h.config.session.expiresIn <= 300);
  for (const field of Object.values(h.config.user.additionalFields)) assert.equal(field.input, false, "nothing a browser sends sets these");
  assert.equal(h.config.user.additionalFields.role, undefined, "a sign-up can never choose its role");
  const otp = h.config.plugins.find((plugin) => plugin.id === "email-otp").options;
  assert.equal(otp.otpLength, 6);
  assert.equal(otp.allowedAttempts, 5);
  assert.equal(otp.storeOTP, "hashed");
  assert.equal(h.config.plugins.at(-1).id, "next-cookies");
});

test("a code sign-up creates the account from its pending row, with the trial unless the address had one", async () => {
  const pending = new Map([["new@example.com", { email: "new@example.com", name: "New Person", passwordHash: "scrypt$hash", termsVersion: "2026-10", createdAt: now, expiresAt: new Date(Date.now() + 60_000) }]]);
  const h = loadAuth({ pending });
  const result = await before(h, { email: "new@example.com", emailVerified: true, name: "" }, { path: "/sign-in/email-otp" });
  assert.equal(result.data.name, "New Person");
  assert.equal(result.data.passwordHash, "scrypt$hash");
  assert.equal(result.data.signupSource, "self");
  assert.equal(result.data.accountTier, "trial");
  assert.ok(result.data.trialExpiresAt > now);
  assert.equal(result.data.termsVersion, "2026-10");
  assert.equal(result.data.role, undefined);
  const again = loadAuth({ pending, claims: new Set([trialKeyForEmail("New+x@example.com")]) });
  assert.equal((await before(again, { email: "new@example.com", emailVerified: true }, { path: "/sign-in/email-otp" })).data.trialExpiresAt, null);
  for (const email of ["other@example.com"]) assert.equal(await before(h, { email, emailVerified: true }, { path: "/sign-in/email-otp" }), false);
  const expired = loadAuth({ pending: new Map([["new@example.com", { ...pending.get("new@example.com"), expiresAt: new Date(Date.now() - 1) }]]) });
  assert.equal(await before(expired, { email: "new@example.com", emailVerified: true }, { path: "/sign-in/email-otp" }), false);
});

test("a provider sign-up needs a verified address, a real inbox and the signed terms", async () => {
  const h = loadAuth();
  const terms = signTermsCookie("2026-10", secret);
  const ok = await before(h, { email: "jane@company.com", emailVerified: true, name: "Jane" }, { path: "/callback/google", headers: cookieHeader(terms) });
  assert.equal(ok.data.signupSource, "self");
  assert.equal(ok.data.termsVersion, "2026-10");
  for (const [user, headers] of [
    [{ email: "jane@company.com", emailVerified: false }, cookieHeader(terms)],
    [{ email: "jane@mailinator.com", emailVerified: true }, cookieHeader(terms)],
    [{ email: "jane@company.com", emailVerified: true }, new Headers()],
    [{ email: "jane@company.com", emailVerified: true }, cookieHeader(signTermsCookie("2026-10", "wrong-secret-0000000000000000000000000"))],
  ]) assert.equal(await before(h, user, { path: "/callback/microsoft", headers }), false);
  for (const ctx of [null, undefined, {}, { path: "/sign-up/email" }, { path: "/admin/create-user" }]) {
    assert.equal(await before(h, { email: "jane@company.com", emailVerified: true }, ctx), false, JSON.stringify(ctx));
  }
});

test("after a new account: trial claimed, pending row gone, settings current, audited", async () => {
  const h = loadAuth();
  await h.config.databaseHooks.user.create.after({ id: "u1", email: "New@Example.com", name: " New " });
  assert.deepEqual(h.writes.map((write) => write.op), ["claim", "pending", "settings", "audit"]);
  assert.equal(h.writes[0].args.where.keyHash, trialKeyForEmail("new@example.com"));
  assert.equal(h.writes[1].args.where.email, "new@example.com");
  assert.deepEqual(plain(h.writes[2].args.create), { userId: "u1", recruiterName: "New", seenRelease: "test-release" });
  assert.equal(h.writes[3].args.data.action, "account_signed_up");
});

function hookContext(newSession, cookies = {}) {
  const ctx = {
    deleted: [], set: [], deletedSessions: [],
    context: { newSession, internalAdapter: { deleteSession: async (token) => ctx.deletedSessions.push(token) } },
    getCookie: (name) => cookies[name],
    setCookie: (name, value, options) => ctx.set.push({ name, value, options }),
    redirect: (url) => Object.assign(new Error("redirect"), { url }),
  };
  return ctx;
}

test("Better Auth's session is exchanged at once for the workbench's own", async () => {
  const users = new Map([["u1", { id: "u1", active: true, role: "recruiter", authVersion: 3 }], ["u2", { id: "u2", active: false, role: "recruiter", authVersion: 0 }]]);
  const h = loadAuth({ users });
  assert.equal(await h.config.hooks.after(hookContext(null)), undefined, "nothing happens without a new session");
  const ctx = hookContext({ session: { token: "ba-token" }, user: { id: "u1" } }, { "__Host-capture_session": "old-token" });
  await h.config.hooks.after(ctx);
  assert.deepEqual(ctx.deletedSessions, ["ba-token"]);
  assert.deepEqual(ctx.deleted, ["better-auth cookie"]);
  assert.deepEqual(h.revoked, ["old-token"]);
  assert.deepEqual(h.issued, [{ userId: "u1", authVersion: 3 }]);
  assert.deepEqual(ctx.set.map(({ name, value }) => [name, value]), [["__Host-capture_session", "workbench-token"]]);
  for (const id of ["u2", "missing"]) {
    const refused = hookContext({ session: { token: `ba-${id}` }, user: { id } });
    await assert.rejects(h.config.hooks.after(refused), (error) => error.url === "/login?error=unavailable");
    assert.deepEqual(refused.deletedSessions, [`ba-${id}`]);
    assert.equal(refused.set.length, 0);
  }
});

test("only the provider round trip is reachable over HTTP", () => {
  const route = readFileSync(path.join(root, "app/api/auth/[...all]/route.ts"), "utf8");
  const open = route.match(/const OPEN = new Set\(\[([^\]]*)\]\)/)[1].split(",").map((entry) => entry.trim().replace(/"/g, "")).filter(Boolean);
  assert.deepEqual(open.sort(), ["GET /callback/google", "GET /callback/microsoft", "POST /sign-in/social"]);
});

test("the legal pages name who runs Retrivr, and stay a draft until the required details are in", () => {
  const filename = path.join(root, "lib/legal.ts");
  const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports }, { filename });
  const legal = module.exports;
  const filled = { ...legal.OPERATOR, legalName: "Jane Doe", address: "1 High Street, London", contactEmail: "jane@example.com" };
  assert.equal(legal.legalDetailsComplete(filled), true);
  for (const field of ["legalName", "address", "contactEmail"]) {
    for (const value of [null, "", "  "]) assert.equal(legal.legalDetailsComplete({ ...filled, [field]: value }), false, `${field} ${JSON.stringify(value)}`);
  }
  assert.equal(legal.operatorName(filled), "Jane Doe, trading as Basanite");
  assert.equal(legal.operatorName({ ...filled, legalName: "Basanite Ltd", companyNumber: "12345678" }), "Basanite Ltd (company number 12345678)");
  assert.match(legal.operatorName({ ...filled, legalName: null }), /^\[.+\], trading as Basanite$/);
  assert.match(legal.LEGAL_VERSION, /^\d{4}-\d{2}-\d{2}$/);
  // Sign-up never opens on our own pages while they are a draft.
  const config = readFileSync(path.join(root, "lib/signup-config.ts"), "utf8");
  assert.match(config, /!pointsAtDraft\(termsUrl\) && !pointsAtDraft\(privacyUrl\)/);
});
