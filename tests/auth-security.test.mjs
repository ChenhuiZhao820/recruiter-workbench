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
const uniqueUrl = "file:./test-00000000-0000-4000-8000-000000000001.db";

function load(relative, mocks = {}, env = {}) {
  const filename = path.join(root, relative);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, __dirname: path.dirname(filename), __filename: filename,
    Buffer, URL, console, process: { env },
    require: (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id),
  });
  vm.runInContext(source, context, { filename });
  return module.exports;
}

const crypto = load("lib/auth-crypto.ts");

function sessionHarness(origin) {
  const jar = new Map();
  const records = new Map();
  const writes = [];
  const auth = load("lib/auth.ts", {
    "@/lib/db": { db: { session: {
      findUnique: async ({ where }) => records.get(where.tokenHash) ?? null,
      create: async ({ data }) => { records.set(data.tokenHash, data); return data; },
      deleteMany: async ({ where }) => {
        const hashes = typeof where.tokenHash === "string" ? [where.tokenHash] : where.tokenHash.in;
        for (const hash of hashes) records.delete(hash);
      },
    } } },
    "@/lib/auth-crypto": crypto,
    "next/headers": { cookies: () => ({
      get: (name) => jar.has(name) ? { value: jar.get(name) } : undefined,
      set: (name, value, options) => {
        writes.push({ name, value, options });
        if (options.maxAge === 0) jar.delete(name);
        else jar.set(name, value);
      },
    }), headers: () => ({ get: () => origin }) },
    "next/navigation": { redirect: (path) => { throw new Error(`Redirect: ${path}`); } },
  }, { APP_ORIGIN: origin });
  const add = (name, userId) => {
    const token = crypto.newSecret();
    jar.set(name, token);
    records.set(crypto.hashToken(token), {
      tokenHash: crypto.hashToken(token), userId, authVersion: 0,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: userId, email: `${userId}@fixture.invalid`, name: userId, role: "recruiter", active: true, authVersion: 0 },
    });
    return token;
  };
  return { auth, jar, records, writes, add };
}

for (const origin of ["http://localhost:3000", "https://capture.example.test"]) {
  const secure = origin.startsWith("https:");
  const current = `${secure ? "__Host-" : ""}capture_session`;
  const legacy = `${secure ? "__Host-" : ""}basanite_session`;
  test(`Capture session cookies use the new name and preserve security attributes on ${origin}`, async () => {
    const h = sessionHarness(origin);
    await h.auth.createSession("new-user", 3);
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].name, current);
    assert.equal(h.writes[0].options.httpOnly, true);
    assert.equal(h.writes[0].options.secure, secure);
    assert.equal(h.writes[0].options.sameSite, "lax");
    assert.equal(h.writes[0].options.path, "/");
    assert.equal(h.records.get(crypto.hashToken(h.jar.get(current))).authVersion, 3);
  });
  test(`legacy sessions remain readable but the Capture session takes precedence on ${origin}`, async () => {
    const h = sessionHarness(origin);
    h.add(legacy, "legacy-user");
    assert.equal((await h.auth.getSession()).user.id, "legacy-user");
    h.add(current, "current-user");
    assert.equal((await h.auth.getSession()).user.id, "current-user");
    h.jar.set(current, "invalid-current-token");
    assert.equal(await h.auth.getSession(), null);
  });
  test(`logout revokes both session cookies so a legacy login cannot return on ${origin}`, async () => {
    const h = sessionHarness(origin);
    h.add(legacy, "legacy-user");
    h.add(current, "current-user");
    await h.auth.endSession();
    assert.equal(h.records.size, 0);
    assert.equal(h.jar.size, 0);
    assert.deepEqual(h.writes.map((write) => write.name).sort(), [current, legacy].sort());
    for (const write of h.writes) {
      assert.equal(write.options.maxAge, 0);
      assert.equal(write.options.secure, secure);
      assert.equal(write.options.httpOnly, true);
    }
    assert.equal(await h.auth.getSession(), null);
  });
  test(`revoked legacy sessions do not bypass expiry or account checks on ${origin}`, async () => {
    for (const change of ["expiry", "disabled", "version"]) {
      const h = sessionHarness(origin);
      const token = h.add(legacy, "legacy-user");
      const record = h.records.get(crypto.hashToken(token));
      if (change === "expiry") record.expiresAt = new Date(0);
      if (change === "disabled") record.user.active = false;
      if (change === "version") record.user.authVersion++;
      assert.equal(await h.auth.getSession(), null);
    }
  });
}

test("passwords are salted, verifiable and never stored as plaintext", async () => {
  const password = "TEST-ONLY-security-password-3100!";
  const first = await crypto.hashPassword(password);
  const second = await crypto.hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.equal(await crypto.verifyPassword(password, first), true);
  assert.equal(await crypto.verifyPassword("wrong-password", first), false);
  assert.equal(await crypto.verifyPassword(password, null), false);
  assert.equal(await crypto.verifyPassword(password, "invalid hash"), false);
});

test("tokens are random URL-safe secrets and only deterministic hashes are persisted", () => {
  const first = crypto.newSecret();
  const second = crypto.newSecret();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(crypto.hashToken(first), crypto.hashToken(first));
  assert.notEqual(crypto.hashToken(first), first);
  assert.notEqual(crypto.hashToken(first), crypto.hashToken(second));
});

test("password and email validation preserve the account contracts", () => {
  assert.ok(crypto.passwordError("a".repeat(11)));
  assert.equal(crypto.passwordError("a".repeat(12)), null);
  assert.equal(crypto.passwordError("a".repeat(128)), null);
  assert.ok(crypto.passwordError("a".repeat(129)));
  assert.equal(crypto.normalizeEmail("  ADMIN@Example.invalid  "), "admin@example.invalid");
  assert.equal(crypto.validEmail("admin@example.invalid"), true);
  assert.equal(crypto.validEmail("missing-at-sign"), false);
});

test("loading Playwright config and importing helpers cannot create or connect a database", () => {
  const env = { DATABASE_URL: "file:./dev.db" };
  const config = load("playwright.config.ts", { "@playwright/test": { defineConfig: (value) => value } }, env).default;
  assert.match(env.DATABASE_URL, /^file:\.\/test-[0-9a-f-]{36}\.db$/);
  assert.equal(env.DATABASE_URL, env.CAPTURE_TEST_DATABASE_URL);
  assert.equal(config.webServer[1].env.DATABASE_URL, env.DATABASE_URL);
  assert.equal(config.webServer[1].env.CAPTURE_TEST_DATABASE_URL, env.DATABASE_URL);
  assert.equal(config.webServer[1].env.APP_ORIGIN, "http://localhost:3100");
  assert.equal(config.use.storageState.cookies[0].value, env.CAPTURE_TEST_SESSION_TOKEN);
  let constructed = 0;
  const helpers = load("tests/helpers.ts", { "@prisma/client": { PrismaClient: class {
    constructor() { constructed++; assert.equal(env.DATABASE_URL, env.CAPTURE_TEST_DATABASE_URL); }
  } } }, env);
  assert.equal(constructed, 1);
  assert.equal(helpers.TEST_DATABASE_URL, env.DATABASE_URL);
});

test("config and helpers refuse dev.db, test.db, paths outside prisma and malformed test names", () => {
  for (const url of ["file:./dev.db", "file:./test.db", "file:../test-00000000-0000-4000-8000-000000000001.db", "file:./test-not-a-uuid.db", "postgresql://example.invalid/db", `${uniqueUrl}?anything=1`]) {
    assert.throws(() => load("playwright.config.ts", { "@playwright/test": { defineConfig: (value) => value } }, { CAPTURE_TEST_DATABASE_URL: url }));
    let constructed = false;
    assert.throws(() => load("tests/helpers.ts", { "@prisma/client": { PrismaClient: class { constructor() { constructed = true; } } } }, { CAPTURE_TEST_DATABASE_URL: url }));
    assert.equal(constructed, false);
  }
});

function setupHarness(existing = []) {
  const dbFile = path.join(root, "prisma", uniqueUrl.slice("file:./".length));
  const protectedFiles = [path.join(root, "prisma", "dev.db"), path.join(root, "prisma", "test.db")];
  const files = new Map([...protectedFiles, ...existing.map((suffix) => `${dbFile}${suffix}`)].map((file) => [file, { ino: 1, dev: 1, birthtimeMs: 1, isFile: () => true }]));
  const deleted = [];
  const commands = [];
  const seeded = [];
  let pushesFail = false;
  let databaseBusy = false;
  const mockDb = {
    $disconnect: async () => {},
    user: { create: async (input) => { seeded.push(input); } },
  };
  const setup = load("tests/global-setup.ts", {
    "node:child_process": { execSync: (command, options) => {
      commands.push({ command, options });
      assert.equal(options.env.DATABASE_URL, uniqueUrl);
      assert.equal(options.env.CAPTURE_TEST_DATABASE_URL, uniqueUrl);
      assert.ok(files.has(dbFile));
      if (pushesFail) throw new Error("simulated db push failure");
    } },
    "node:fs": {
      lstatSync: (file, options) => { if (!files.has(file) && options?.throwIfNoEntry !== false) throw new Error(`missing ${file}`); return files.get(file); },
      openSync: (file, flags) => { assert.equal(flags, "wx"); assert.ok(!files.has(file)); files.set(file, { ino: 2, dev: 1, birthtimeMs: 2, isFile: () => true }); return 1; },
      closeSync: () => {},
      rmSync: (file) => {
        assert.ok(!protectedFiles.includes(file));
        if (databaseBusy && file === dbFile) throw Object.assign(new Error("database is open"), { code: "EBUSY" });
        deleted.push(file);
        files.delete(file);
      },
    },
    "./helpers": { db: mockDb, TEST_ADMIN_ID: "test-admin", TEST_ADMIN_EMAIL: "admin@test.invalid", TEST_ADMIN_PASSWORD: "TEST-ONLY-password", TEST_DATABASE_URL: uniqueUrl },
    "../lib/auth-crypto": { hashPassword: async () => "test-password-hash", hashToken: () => "test-session-hash" },
  }, { CAPTURE_TEST_SESSION_TOKEN: "a".repeat(43) }).default;
  return { setup, files, deleted, commands, seeded, dbFile, protectedFiles, failPush: () => { pushesFail = true; }, holdDatabase: () => { databaseBusy = true; } };
}

test("setup refuses every pre-existing target or SQLite sidecar without deletion or db push", async () => {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const harness = setupHarness([suffix]);
    await assert.rejects(harness.setup(), /Refusing to overwrite/);
    assert.equal(harness.commands.length, 0);
    assert.equal(harness.deleted.length, 0);
    assert.equal(harness.seeded.length, 0);
    for (const protectedFile of harness.protectedFiles) assert.ok(harness.files.has(protectedFile));
  }
});

test("setup seeds only the fresh database and teardown removes only its exact database and sidecars", async () => {
  const harness = setupHarness();
  const teardown = await harness.setup();
  assert.equal(harness.commands.length, 1);
  assert.equal(harness.commands[0].command, "npx prisma db push --skip-generate");
  assert.equal(harness.seeded.length, 1);
  assert.equal(harness.seeded[0].data.role, "admin");
  assert.equal(harness.seeded[0].data.passwordHash, "test-password-hash");
  assert.equal(harness.seeded[0].data.sessions.create.tokenHash, "test-session-hash");
  const unrelated = `${harness.dbFile}.unknown`;
  harness.files.set(unrelated, { isFile: () => true });
  for (const suffix of ["-journal", "-wal", "-shm"]) harness.files.set(`${harness.dbFile}${suffix}`, { isFile: () => true });
  await teardown();
  assert.equal(harness.deleted.length, 4);
  assert.ok(harness.files.has(unrelated));
  for (const protectedFile of harness.protectedFiles) assert.ok(harness.files.has(protectedFile));
});

test("a Windows-locked test database is retained together with its sidecars, never force-deleted", async () => {
  const harness = setupHarness();
  const teardown = await harness.setup();
  harness.holdDatabase();
  for (const suffix of ["-journal", "-wal", "-shm"]) harness.files.set(`${harness.dbFile}${suffix}`, { isFile: () => true });
  await teardown();
  assert.equal(harness.deleted.length, 0);
  for (const suffix of ["", "-journal", "-wal", "-shm"]) assert.ok(harness.files.has(`${harness.dbFile}${suffix}`));
});

test("teardown refuses a replaced database instead of deleting an unknown file", async () => {
  const harness = setupHarness();
  const teardown = await harness.setup();
  harness.files.set(harness.dbFile, { ino: 999, dev: 1, birthtimeMs: 999, isFile: () => true });
  await assert.rejects(teardown(), /Refusing to remove a replaced test database/);
  assert.equal(harness.deleted.length, 0);
});

test("failed db push cleans up only the newly reserved test database", async () => {
  const harness = setupHarness();
  harness.failPush();
  await assert.rejects(harness.setup(), /simulated db push failure/);
  assert.deepEqual(harness.deleted, [harness.dbFile]);
  for (const protectedFile of harness.protectedFiles) assert.ok(harness.files.has(protectedFile));
});
