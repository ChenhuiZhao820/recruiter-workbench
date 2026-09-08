import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { link, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { bootstrapAdmin, businessModels, normalizeEmail, parseArgs, targetProvider, validateOrigin } from "../scripts/bootstrap-admin.mjs";
import { applyLegacy, assertDifferentSource, inspectTarget, legacyColumns, legacyDate, readLegacy, validateAndTransformLegacy } from "../scripts/import-legacy.mjs";
import { postgresSchema } from "../scripts/prepare-postgres.mjs";
import { backupLegacy, fingerprint, preflight, verifyImported } from "../scripts/backup-legacy.mjs";

const epoch = Date.parse("2025-01-02T03:04:05.123Z");
const modelFor = (table) => table[0].toLowerCase() + table.slice(1);
const encode = (value) => value instanceof Date ? value.getTime() : typeof value === "boolean" ? Number(value) : value;

const resources = new WeakMap();

async function temp(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "account-migration-"));
  resources.set(t, []);
  t.after(async () => {
    for (const close of resources.get(t).reverse()) close();
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function sourceRows() {
  const rows = {};
  for (const [table, columns] of Object.entries(legacyColumns)) {
    const row = {};
    for (const [column, descriptor] of Object.entries(columns)) {
      row[column] = descriptor.endsWith("?") ? null : descriptor === "int" ? 1 : descriptor === "date" ? epoch : descriptor === "kind" ? "message" : `${table}-${column}`;
    }
    rows[table] = [row];
  }
  rows.Briefing[0].roleId = rows.Role[0].id;
  rows.Candidate[0].roleId = rows.Role[0].id;
  rows.SavedSearch[0].roleId = rows.Role[0].id;
  rows.OutreachLog[0].candidateId = rows.Candidate[0].id;
  rows.OutreachLog[0].templateId = rows.MessageTemplate[0].id;
  rows.Settings[0].captureToken = "old-private-capture-key";
  return rows;
}

function businessDDL(target = false) {
  return Object.entries(legacyColumns).map(([table, columns]) => {
    const fields = Object.entries(columns).filter(([column]) => !target || column !== "captureToken").map(([column, descriptor]) => {
      const type = descriptor.startsWith("date") ? "DATETIME" : descriptor === "int" ? "INTEGER" : "TEXT";
      return `"${column}" ${type}${column === "id" ? " PRIMARY KEY" + (table === "Settings" ? " AUTOINCREMENT" : "") : descriptor.endsWith("?") ? "" : " NOT NULL"}`;
    });
    if (target && ["Role", "SavedSearch", "MessageTemplate", "Settings"].includes(table)) fields.push('"userId" TEXT NOT NULL REFERENCES "User"("id")');
    if (target && table === "Settings") fields.push('"captureTokenHash" TEXT UNIQUE', 'UNIQUE("userId")');
    if (["Briefing", "Candidate", "SavedSearch"].includes(table)) fields.push('FOREIGN KEY ("roleId") REFERENCES "Role"("id")');
    if (table === "Briefing") fields.push('UNIQUE("roleId")');
    if (table === "OutreachLog") fields.push('FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id")', 'FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id")');
    return `CREATE TABLE "${table}" (${fields.join(", ")});`;
  }).join("\n");
}

function insert(sqlite, table, data) {
  const keys = Object.keys(data);
  sqlite.prepare(`INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((key) => encode(data[key])));
}

function legacyFixture(path, rows = sourceRows()) {
  const sqlite = new DatabaseSync(path);
  try {
    sqlite.exec(businessDDL());
    for (const table of ["Role", "MessageTemplate", "Briefing", "SavedSearch", "Candidate", "OutreachLog", "Settings"]) {
      for (const row of rows[table]) insert(sqlite, table, row);
    }
  } finally { sqlite.close(); }
}

function targetFixture(t, path) {
  const sqlite = new DatabaseSync(path);
  resources.get(t).push(() => sqlite.close());
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "email" TEXT UNIQUE NOT NULL, "name" TEXT NOT NULL, "role" TEXT NOT NULL DEFAULT 'recruiter', "active" INTEGER NOT NULL DEFAULT 1, "passwordHash" TEXT);
    CREATE TABLE "Session" ("tokenHash" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id"));
    CREATE TABLE "ActivationToken" ("tokenHash" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id"), "expiresAt" DATETIME NOT NULL);
    CREATE TABLE "LoginThrottle" ("key" TEXT PRIMARY KEY);
    CREATE TABLE "AuditEvent" ("id" TEXT PRIMARY KEY, "actorId" TEXT NOT NULL, "targetUserId" TEXT, "action" TEXT NOT NULL);
    ${businessDDL(true)}
  `);
  const db = {};
  for (const table of ["User", "Session", "ActivationToken", "LoginThrottle", "AuditEvent", ...Object.keys(legacyColumns)]) {
    db[modelFor(table)] = {
      count: async () => sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n,
      findUnique: async ({ where }) => {
        const [key, value] = Object.entries(where)[0];
        const row = sqlite.prepare(`SELECT * FROM "${table}" WHERE "${key}" = ?`).get(value);
        if (row && table === "User") row.active = Boolean(row.active);
        return row ?? null;
      },
      create: async ({ data }) => {
        const row = { ...data };
        if (["User", "AuditEvent"].includes(table) && !row.id) row.id = randomUUID();
        insert(sqlite, table, row);
        return row;
      },
    };
  }
  db.$transaction = async (callback) => {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = await callback(db);
      sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  };
  return { db, sqlite };
}

async function adminAndPaul(db) {
  await db.user.create({ data: { id: "admin", email: "admin@example.test", name: "Admin", role: "admin", active: true } });
  await db.user.create({ data: { id: "paul", email: "paul@example.test", name: "Paul", role: "recruiter", active: true } });
}

for (const mode of ["delete", "wal"]) {
  test(`read-only ${mode} backup preserves source bytes and verifies a readable snapshot`, async (t) => {
    const directory = await temp(t);
    const source = resolve(directory, "legacy.db");
    const backup = resolve(directory, "backup.db");
    const target = resolve(directory, "accounts.db");
    legacyFixture(source);
    const connection = new DatabaseSync(source);
    resources.get(t).push(() => connection.close());
    connection.exec(`PRAGMA journal_mode=${mode}`);
    connection.prepare('UPDATE "Role" SET "title" = ?').run("Synthetic latest title");
    const before = await fingerprint(source);
    const counts = await preflight(source, target);
    const result = await backupLegacy(source, backup);
    assert.deepEqual(result.counts, counts);
    assert.equal(result.sourceSha256, before);
    assert.equal(await fingerprint(source), before);
    assert.equal((await readLegacy(backup)).Role[0].title, "Synthetic latest title");
    await assert.rejects(backupLegacy(source, backup), { code: "EEXIST" });
    await assert.rejects(preflight(source, backup), /already exists/);
  });
}

test("post-import verification checks every field, ownership and audit without exposing credentials", async (t) => {
  const directory = await temp(t);
  const source = resolve(directory, "legacy.db");
  const backup = resolve(directory, "backup.db");
  const target = resolve(directory, "accounts.db");
  const reportPath = resolve(directory, "verification.json");
  legacyFixture(source);
  const report = { source, backup, target, ...await backupLegacy(source, backup) };
  await writeFile(reportPath, JSON.stringify(report));
  const { db, sqlite } = targetFixture(t, target);
  const email = "admin@example.test";
  await bootstrapAdmin(db, { email, origin: "http://localhost:3000", output: resolve(directory, "setup.txt") });
  await applyLegacy(db, await readLegacy(backup), { email }, { confirmed: true });
  const result = await verifyImported(reportPath, email);
  assert.deepEqual(result.counts, report.counts);
  assert.equal(result.verified, true);
  assert.equal(result.sourceUnchanged, true);
  assert.equal(result.passwordSet, false);
  assert.equal(result.activationUsable, true);
  assert.ok(!JSON.stringify(result).includes("token"));
  sqlite.prepare('UPDATE "Role" SET "title" = ?').run("Unexpected edit");
  await assert.rejects(verifyImported(reportPath, email), /Imported role records differ/);
  assert.equal(await fingerprint(source), report.sourceSha256);
});

test("PostgreSQL schema changes only the datasource provider and retains the shared client", async () => {
  const sqlite = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const postgres = await readFile(new URL("../prisma/postgresql/schema.prisma", import.meta.url), "utf8");
  assert.equal(postgres.replaceAll("\r\n", "\n"), postgresSchema(sqlite).replaceAll("\r\n", "\n"));
  assert.throws(() => postgresSchema(postgres));
  const migration = await readFile(new URL("../prisma/postgresql/migrations/20260908000000_initial/migration.sql", import.meta.url), "utf8");
  for (const [, model] of postgres.matchAll(/model\s+(\w+)\s*\{/g)) assert.ok(migration.includes(`CREATE TABLE "${model}"`));
  assert.ok(migration.includes('"id" SERIAL NOT NULL'));
  assert.ok(migration.includes('"Settings_captureTokenHash_key"'));
});

test("CLI rejects unknown, duplicate and missing arguments and unsafe origins", () => {
  assert.throws(() => parseArgs(["--email"], ["--email"]));
  assert.throws(() => parseArgs(["--email", "a", "--email", "b"], ["--email"]));
  assert.throws(() => parseArgs(["--yes"], ["--apply"], ["--apply"]));
  assert.equal(normalizeEmail(" ADMIN@Example.test "), "admin@example.test");
  assert.throws(() => normalizeEmail("bad"));
  for (const origin of ["http://example.test", "https://user:pass@example.test", "https://example.test/path", "https://example.test/?secret=yes", "https://example.test/#secret", "ftp://localhost"]) assert.throws(() => validateOrigin(origin));
  assert.equal(validateOrigin("http://localhost:3000", false), "http://localhost:3000");
  assert.throws(() => validateOrigin("http://localhost:3000", true));
  assert.equal(validateOrigin("https://example.test"), "https://example.test");
  assert.throws(() => targetProvider(undefined));
  assert.throws(() => targetProvider("mysql://localhost/app"));
});

test("bootstrap creates only one admin, a hashed 24-hour token and an exclusive private fragment-link file", async (t) => {
  const directory = await temp(t);
  const { db, sqlite } = targetFixture(t, resolve(directory, "target.db"));
  const output = resolve(directory, "activation.txt");
  const options = { email: "ADMIN@example.test", origin: "https://example.test", output, now: new Date(epoch) };
  assert.equal(await bootstrapAdmin(db, options), output);
  const link = new URL((await readFile(output, "utf8")).trim());
  assert.equal(link.pathname, "/activate");
  assert.equal(link.search, "");
  assert.match(link.hash, /^#token=[A-Za-z0-9_-]{43}$/);
  const token = link.hash.slice(7);
  const activation = sqlite.prepare('SELECT * FROM "ActivationToken"').get();
  assert.equal(activation.tokenHash, createHash("sha256").update(token).digest("hex"));
  assert.equal(activation.expiresAt, epoch + 86400000);
  const admin = sqlite.prepare('SELECT * FROM "User"').get();
  assert.equal(admin.email, "admin@example.test");
  assert.equal(admin.role, "admin");
  assert.equal(admin.passwordHash, null);
  assert.equal(await db.auditEvent.count(), 1);
  for (const model of businessModels) assert.equal(await db[model].count(), 0);
  if (process.platform !== "win32") assert.equal((await stat(output)).mode & 0o777, 0o600);
  await assert.rejects(bootstrapAdmin(db, { ...options, output: resolve(directory, "second.txt") }), /already exists/);
  await assert.rejects(stat(resolve(directory, "second.txt")), { code: "ENOENT" });
  const original = await readFile(output, "utf8");
  await assert.rejects(bootstrapAdmin(db, options), { code: "EEXIST" });
  assert.equal(await readFile(output, "utf8"), original);
  assert.equal(await db.user.count(), 1);
});

test("bootstrap rolls back admin, activation and audit when writing the link fails", async (t) => {
  const directory = await temp(t);
  const { db } = targetFixture(t, resolve(directory, "target.db"));
  const output = resolve(directory, "activation.txt");
  await assert.rejects(bootstrapAdmin(db, {
    email: "admin@example.test", origin: "https://example.test", output,
    openFile: async (...args) => {
      const handle = await open(...args);
      return { writeFile: async () => { throw new Error("simulated disk failure"); }, close: () => handle.close() };
    },
  }), /disk failure/);
  for (const model of ["user", "activationToken", "auditEvent"]) assert.equal(await db[model].count(), 0);
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test("bootstrap refuses an existing user even if that user is inactive", async (t) => {
  const directory = await temp(t);
  const { db } = targetFixture(t, resolve(directory, "target.db"));
  await db.user.create({ data: { email: "existing@example.test", name: "Existing", active: false, role: "recruiter" } });
  await assert.rejects(bootstrapAdmin(db, { email: "admin@example.test", origin: "https://example.test", output: resolve(directory, "activation.txt") }), /already exists/);
  assert.equal(await db.activationToken.count(), 0);
});

test("transform preserves every legacy ID, date, relationship and content but invalidates capture secrets", () => {
  const source = sourceRows();
  const copy = structuredClone(source);
  const data = validateAndTransformLegacy(source, "admin");
  assert.deepEqual(source, copy);
  for (const [table, rows] of Object.entries(source)) {
    for (const [column, value] of Object.entries(rows[0])) {
      if (column === "captureToken") continue;
      assert.deepEqual(data[modelFor(table)][0][column], legacyColumns[table][column].startsWith("date") && value !== null ? new Date(value) : value);
    }
  }
  for (const model of ["role", "savedSearch", "messageTemplate", "settings"]) assert.equal(data[model][0].userId, "admin");
  assert.equal(data.settings[0].captureTokenHash, null);
  assert.ok(!JSON.stringify(data).includes("old-private-capture-key"));
  delete source.MessageTemplate[0].kind;
  delete source.OutreachLog[0].kind;
  delete source.Settings[0].captureToken;
  assert.equal(validateAndTransformLegacy(source, "admin").messageTemplate[0].kind, "message");
});

test("malformed values, duplicate IDs, ownership columns and broken references are rejected without content disclosure", () => {
  const changes = [
    (s) => { s.Candidate[0].roleId = "missing-private-id"; },
    (s) => { s.OutreachLog[0].candidateId = "missing-private-id"; },
    (s) => { s.OutreachLog[0].templateId = "missing-private-id"; },
    (s) => { s.SavedSearch[0].roleId = "missing-private-id"; },
    (s) => { s.Briefing.push({ ...s.Briefing[0], id: "second" }); },
    (s) => { s.Role.push({ ...s.Role[0] }); },
    (s) => { s.Settings.push({ ...s.Settings[0], id: 2 }); },
    (s) => { s.Role[0].createdAt = "private-invalid-date"; },
    (s) => { s.Role[0].updatedAt = "2025-02-30T00:00:00Z"; },
    (s) => { s.Candidate[0].nudgeCount = -1; },
    (s) => { s.Role[0].userId = "old-owner"; },
    (s) => { s.User = []; },
    (s) => { delete s.Role[0].title; },
  ];
  for (const change of changes) {
    const source = sourceRows();
    change(source);
    assert.throws(() => validateAndTransformLegacy(source, "admin"), (error) => !error.message.includes("private") && /unsupported schema/.test(error.message));
  }
  assert.equal(legacyDate("2025-01-02 03:04:05.123").getTime(), epoch);
  assert.equal(legacyDate("2025-01-02T04:04:05.123+01:00").getTime(), epoch);
});

test("read-only SQLite import dry-run leaves both files unchanged and apply assigns everything only to Admin", async (t) => {
  const directory = await temp(t);
  const sourcePath = resolve(directory, "legacy.db");
  const targetPath = resolve(directory, "target.db");
  legacyFixture(sourcePath);
  const before = await readFile(sourcePath);
  const { db, sqlite } = targetFixture(t, targetPath);
  await adminAndPaul(db);
  assert.equal(await assertDifferentSource(sourcePath, `file:${targetPath}`), await assertDifferentSource(sourcePath, "postgresql://unused:unused@localhost/unused"));
  await assert.rejects(assertDifferentSource(sourcePath, `file:${sourcePath}`), /must be different/);
  await assert.rejects(assertDifferentSource(sourcePath, "file:legacy.db", directory), /must be different/);
  const alias = resolve(directory, "legacy-alias.db");
  await link(sourcePath, alias);
  await assert.rejects(assertDifferentSource(sourcePath, `file:${alias}`), /must be different/);
  await assert.rejects(assertDifferentSource(sourcePath, `file:${resolve(directory, "missing-target.db")}`), /existing initialized file/);
  await assert.rejects(stat(resolve(directory, "missing-target.db")), { code: "ENOENT" });
  const source = await readLegacy(sourcePath);
  assert.ok(!Object.hasOwn(source.Settings[0], "captureToken"));
  assert.equal(await inspectTarget(db, { email: "admin@example.test" }), "admin");
  const data = validateAndTransformLegacy(source, "admin");
  assert.equal(data.role.length, 1);
  for (const model of businessModels) assert.equal(await db[model].count(), 0);
  await assert.rejects(applyLegacy(db, source, { id: "admin" }), /confirmation/);
  assert.equal(await db.auditEvent.count(), 0);
  const counts = await applyLegacy(db, source, { id: "admin" }, { confirmed: true });
  for (const count of Object.values(counts)) assert.equal(count, 1);
  for (const table of ["Role", "SavedSearch", "MessageTemplate", "Settings"]) {
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE "userId" = 'paul'`).get().n, 0);
    assert.equal(sqlite.prepare(`SELECT "userId" FROM "${table}"`).get().userId, "admin");
  }
  assert.equal(sqlite.prepare('SELECT "captureTokenHash" FROM "Settings"').get().captureTokenHash, null);
  assert.equal(sqlite.prepare('SELECT "action" FROM "AuditEvent"').get().action, "legacy.import");
  assert.deepEqual(await readFile(sourcePath), before);
  await assert.rejects(applyLegacy(db, source, { id: "admin" }, { confirmed: true }), /empty/);
  assert.equal(await db.auditEvent.count(), 1);
});

test("import rejects recruiters, missing and inactive admins, and nonempty target settings", async (t) => {
  const directory = await temp(t);
  const { db, sqlite } = targetFixture(t, resolve(directory, "target.db"));
  await adminAndPaul(db);
  for (const id of ["paul", "missing"]) await assert.rejects(inspectTarget(db, { id }), /active admin/);
  sqlite.exec('UPDATE "User" SET "active" = 0 WHERE "id" = \'admin\'');
  await assert.rejects(applyLegacy(db, sourceRows(), { id: "admin" }, { confirmed: true }), /active admin/);
  sqlite.exec('UPDATE "User" SET "active" = 1 WHERE "id" = \'admin\'');
  await db.settings.create({ data: validateAndTransformLegacy(sourceRows(), "admin").settings[0] });
  await assert.rejects(inspectTarget(db, { id: "admin" }), /empty/);
  assert.equal(await db.role.count(), 0);
});

test("a failure after business inserts rolls back all imported data and audit", async (t) => {
  const directory = await temp(t);
  const { db } = targetFixture(t, resolve(directory, "target.db"));
  await adminAndPaul(db);
  db.auditEvent.create = async () => { throw new Error("simulated audit failure"); };
  await assert.rejects(applyLegacy(db, sourceRows(), { id: "admin" }, { confirmed: true }), /audit failure/);
  for (const model of businessModels) assert.equal(await db[model].count(), 0);
  assert.equal(await db.auditEvent.count(), 0);
  assert.equal(await db.user.count(), 2);
});

test("wrong SQLite schema and unexpected account tables are rejected; a missing source is never created", async (t) => {
  const directory = await temp(t);
  const wrong = resolve(directory, "wrong.db");
  const sqlite = new DatabaseSync(wrong);
  sqlite.exec('CREATE TABLE "Unknown" ("id" TEXT)');
  sqlite.close();
  await assert.rejects(readLegacy(wrong), /unsupported schema/);
  const missing = resolve(directory, "missing.db");
  await assert.rejects(readLegacy(missing));
  await assert.rejects(stat(missing), { code: "ENOENT" });
  const accountSource = resolve(directory, "accounts.db");
  legacyFixture(accountSource);
  const accounts = new DatabaseSync(accountSource);
  accounts.exec('CREATE TABLE "User" ("id" TEXT)');
  accounts.close();
  await assert.rejects(readLegacy(accountSource), /unsupported schema/);
});
