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
  assert.equal(env.DATABASE_URL, env.BASANITE_TEST_DATABASE_URL);
  assert.equal(config.webServer[1].env.DATABASE_URL, env.DATABASE_URL);
  assert.equal(config.webServer[1].env.BASANITE_TEST_DATABASE_URL, env.DATABASE_URL);
  assert.equal(config.webServer[1].env.APP_ORIGIN, "http://localhost:3100");
  assert.equal(config.use.storageState.cookies[0].value, env.BASANITE_TEST_SESSION_TOKEN);
  let constructed = 0;
  const helpers = load("tests/helpers.ts", { "@prisma/client": { PrismaClient: class {
    constructor() { constructed++; assert.equal(env.DATABASE_URL, env.BASANITE_TEST_DATABASE_URL); }
  } } }, env);
  assert.equal(constructed, 1);
  assert.equal(helpers.TEST_DATABASE_URL, env.DATABASE_URL);
});

test("config and helpers refuse dev.db, test.db, paths outside prisma and malformed test names", () => {
  for (const url of ["file:./dev.db", "file:./test.db", "file:../test-00000000-0000-4000-8000-000000000001.db", "file:./test-not-a-uuid.db", "postgresql://example.invalid/db", `${uniqueUrl}?anything=1`]) {
    assert.throws(() => load("playwright.config.ts", { "@playwright/test": { defineConfig: (value) => value } }, { BASANITE_TEST_DATABASE_URL: url }));
    let constructed = false;
    assert.throws(() => load("tests/helpers.ts", { "@prisma/client": { PrismaClient: class { constructor() { constructed = true; } } } }, { BASANITE_TEST_DATABASE_URL: url }));
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
      assert.equal(options.env.BASANITE_TEST_DATABASE_URL, uniqueUrl);
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
  }, { BASANITE_TEST_SESSION_TOKEN: "a".repeat(43) }).default;
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
