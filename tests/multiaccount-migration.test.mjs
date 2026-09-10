import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import { accountColumns, readAccounts, validateAccounts, snapshotAccounts, inspectAccountsTarget, importAccounts, verifyAccounts } from "../scripts/import-accounts.mjs";

const initializer = fileURLToPath(new URL("../scripts/init-local.mjs", import.meta.url));
const importer = fileURLToPath(new URL("../scripts/import-accounts.mjs", import.meta.url));
const adminEmail = "admin@fixture.invalid";
const passwordHash = `scrypt$32768$8$3$${"12".repeat(16)}$${"ab".repeat(64)}`;
const captureHashes = ["31".repeat(32), "42".repeat(32)];
const extensionCodeHashes = ["75".repeat(32), "86".repeat(32)];
const sessionHash = "53".repeat(32);
const activationHash = "64".repeat(32);
const throttleKey = "fixture-private-throttle-key";
const createdAt = new Date("2023-01-02T03:04:05.006Z");
const updatedAt = new Date("2024-02-03T04:05:06.007Z");
const tables = ["User", "ExtensionAccess", "Role", "MessageTemplate", "Briefing", "SavedSearch", "Candidate", "OutreachLog", "Settings", "AuditEvent"];
const ephemeralTables = ["Session", "ActivationToken", "LoginThrottle"];
const modelFor = (table) => table[0].toLowerCase() + table.slice(1);
const models = [...tables, ...ephemeralTables].map(modelFor);
const fileUrl = (path) => `file:${path.replaceAll("\\", "/")}`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sorted = (rows) => [...rows].sort((left, right) => String(left.id ?? left.userId ?? left.tokenHash ?? left.key).localeCompare(String(right.id ?? right.userId ?? right.tokenHash ?? right.key)));
let directory;
let emptyPath;
let sourcePath;
let sourceBytes;
let source;
let fixtureRows;
let targetNumber = 0;

async function seedSource(db) {
  for (const [index, label] of ["admin", "recruiter"].entries()) {
    const userId = `fixture-user-${label}`;
    const roleId = `fixture-role-${label}`;
    const templateId = `fixture-template-${label}`;
    const candidateId = `fixture-candidate-${label}`;
    await db.user.create({ data: { id: userId, email: `${label}@fixture.invalid`, name: `Fixture ${label}`, role: label, active: true, passwordHash, authVersion: index + 4, createdAt, updatedAt } });
    await db.extensionAccess.create({ data: { userId, codeHash: extensionCodeHashes[index], expiresAt: new Date("2035-01-01T00:00:00Z"), activatedAt: index ? null : updatedAt, createdAt, updatedAt } });
    await db.role.create({ data: { id: roleId, userId, title: `${label} role`, client: `${label} client`, jobDesc: `${label} private job description`, status: index ? "closed" : "open", createdAt, updatedAt } });
    await db.messageTemplate.create({ data: { id: templateId, userId, name: `${label} template`, body: `${label} private {{first_name}} template`, kind: index ? "connection_note" : "message", createdAt, updatedAt } });
    await db.briefing.create({ data: { id: `fixture-briefing-${label}`, roleId, dayToDay: `${label} day to day`, keySkills: '[{"skill":"fixture","real_vs_buzzword":"real"}]', searchTitles: '["Fixture title"]', targetCompanies: '["Fixture company"]', salaryRange: "Fixture salary", firstCallQuestions: '[{"question":"fixture","strong_answer":"yes","weak_answer":"no"}]', createdAt } });
    await db.savedSearch.create({ data: { id: `fixture-search-${label}`, userId, roleId, name: `${label} search`, groupLabel: `${label} group`, titles: '["Fixture title"]', keywords: `${label} keywords`, industries: '["Fixture industry"]', locations: '["Fixture location"]', filterNotes: `${label} private filter notes`, lastUsedAt: updatedAt, createdAt, updatedAt } });
    await db.candidate.create({ data: { id: candidateId, roleId, fullName: `${label} Fixture Candidate`, profileUrl: `https://profiles.fixture.invalid/${label}`, headline: `${label} headline`, notes: `${label} private candidate notes`, stage: index ? "booking_pending" : "contacted", lastActivityAt: updatedAt, lastNudgeAt: createdAt, nudgeCount: index + 2, createdAt, updatedAt } });
    await db.outreachLog.create({ data: { id: `fixture-outreach-${label}`, candidateId, templateId, renderedBody: `${label} private rendered outreach`, kind: index ? "connection_note" : "message", sentAt: updatedAt } });
    await db.settings.create({ data: { id: index + 7, userId, recruiterName: `${label} custom name`, calendarLink: `https://calendar.fixture.invalid/${label}`, bookingChaseDays: index + 3, quietNudgeDays: index + 8, captureTokenHash: captureHashes[index] } });
    await db.auditEvent.create({ data: { id: `fixture-audit-${label}`, actorId: "fixture-user-admin", targetUserId: userId, action: index ? "admin.workspace.view" : "admin.bootstrap", createdAt } });
  }
  await db.session.create({ data: { tokenHash: sessionHash, userId: "fixture-user-admin", viewUserId: "fixture-user-recruiter", authVersion: 4, expiresAt: new Date("2035-01-01T00:00:00Z"), createdAt } });
  await db.activationToken.create({ data: { tokenHash: activationHash, userId: "fixture-user-recruiter", expiresAt: new Date("2035-01-01T00:00:00Z"), createdAt } });
  await db.loginThrottle.create({ data: { key: throttleKey, attempts: 6, resetAt: updatedAt } });
}

async function allRows(db) {
  return Object.fromEntries(await Promise.all(models.map(async (model) => [model, sorted(await db[model].findMany())])));
}

async function withTarget(callback, populate) {
  const path = join(directory, `target-${++targetNumber}.db`);
  await copyFile(emptyPath, path);
  if (populate) {
    const sqlite = new DatabaseSync(path, { enableForeignKeyConstraints: false });
    try { populate(sqlite); } finally { sqlite.close(); }
  }
  const db = new PrismaClient({ datasourceUrl: fileUrl(path), log: [] });
  try { return await callback(db, path); } finally { await db.$disconnect(); }
}

function insertRaw(sqlite, table, row) {
  const columns = Object.keys(row);
  sqlite.prepare(`INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...Object.values(row));
}

async function assertEmpty(db) {
  for (const model of models) assert.equal(await db[model].count(), 0, `${model} must remain empty`);
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "capture-multiaccount-migration-"));
  emptyPath = join(directory, "empty.db");
  sourcePath = join(directory, "source.db");
  const result = spawnSync(process.execPath, [initializer, "--path", emptyPath], { encoding: "utf8", timeout: 120000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  await copyFile(emptyPath, sourcePath);
  const db = new PrismaClient({ datasourceUrl: fileUrl(sourcePath), log: [] });
  try {
    await seedSource(db);
    fixtureRows = await allRows(db);
  } finally { await db.$disconnect(); }
  sourceBytes = await readFile(sourcePath);
  source = await readAccounts(sourcePath);
}, { timeout: 180000 });

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("account source projection excludes authentication material and leaves every source byte unchanged", async () => {
  assert.deepEqual(Object.keys(accountColumns).sort(), [...tables].sort());
  assert.deepEqual(Object.keys(source).sort(), [...tables].sort());
  for (const table of tables) assert.equal(source[table].length, 2, table);
  for (const row of source.Settings) assert.equal(row.captureTokenHash, null);
  for (const secret of [...captureHashes, ...extensionCodeHashes, sessionHash, activationHash, throttleKey]) assert.equal(JSON.stringify(source).includes(secret), false);
  assert.equal(source.User[0].passwordHash, passwordHash);
  assert.deepEqual(await readFile(sourcePath), sourceBytes);
});

test("capture and extension code hashes and pending expiries are redacted in the SQLite query", async (t) => {
  const queries = [];
  const prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, "prepare", function (sql, ...args) {
    queries.push(sql);
    return prepare.call(this, sql, ...args);
  });
  await readAccounts(sourcePath);
  const projection = queries.find((sql) => /SELECT\s/i.test(sql) && /FROM\s+"?Settings"?\b/i.test(sql));
  assert.ok(projection, "source reader must project Settings");
  assert.match(projection, /NULL\s+(?:AS\s+)?"?captureTokenHash"?/i);
  const extensionProjection = queries.find((sql) => /SELECT\s/i.test(sql) && /FROM\s+"ExtensionAccess"/i.test(sql));
  assert.ok(extensionProjection);
  assert.match(extensionProjection, /NULL AS "codeHash"/);
  assert.match(extensionProjection, /NULL AS "expiresAt"/);
  assert.equal(extensionProjection.match(/"codeHash"/g).length, 1);
  assert.doesNotMatch(extensionProjection, /SELECT\s+\*/i);
  for (const row of source.ExtensionAccess) {
    assert.equal(row.codeHash, null);
    assert.equal(row.expiresAt, null);
  }
});

test("validation preserves every persisted field except auth versions, capture keys and pending extension codes/expiries", () => {
  const original = structuredClone(source);
  const result = validateAccounts(source, adminEmail);
  assert.equal(result.adminId, "fixture-user-admin");
  assert.deepEqual(Object.keys(result.data).sort(), tables.map(modelFor).sort());
  for (const table of tables) {
    const model = modelFor(table);
    const expected = fixtureRows[model].map((row) => ({ ...row, ...(table === "User" ? { authVersion: row.authVersion + 1 } : {}), ...(table === "Settings" ? { captureTokenHash: null } : {}), ...(table === "ExtensionAccess" ? { codeHash: null, expiresAt: null } : {}) }));
    assert.deepEqual(sorted(result.data[model]), sorted(expected), table);
  }
  assert.deepEqual(structuredClone(source), original);
  assert.ok(result.counts);
});

test("older account databases and snapshots may omit only ExtensionAccess", async () => {
  const path = join(directory, "pre-extension-source.db");
  await copyFile(sourcePath, path);
  const sqlite = new DatabaseSync(path);
  try { sqlite.exec('DROP TABLE "ExtensionAccess"'); } finally { sqlite.close(); }
  const before = await readFile(path);
  const legacy = await readAccounts(path);
  assert.deepEqual(legacy.ExtensionAccess, []);
  const oldSnapshot = structuredClone(legacy);
  delete oldSnapshot.ExtensionAccess;
  assert.deepEqual(validateAccounts(oldSnapshot, adminEmail), validateAccounts(legacy, adminEmail));
  const backup = join(directory, "pre-extension-snapshot.db");
  await snapshotAccounts(path, backup);
  assert.deepEqual(await readAccounts(backup), legacy);
  assert.deepEqual(await readFile(path), before);
  await withTarget(async (db) => {
    await importAccounts(db, oldSnapshot, adminEmail, { provider: "sqlite", confirmed: true });
    assert.equal(await db.extensionAccess.count(), 0);
    await verifyAccounts(db, legacy, adminEmail);
    await db.extensionAccess.create({ data: { userId: "fixture-user-recruiter", activatedAt: updatedAt } });
    await assert.rejects(verifyAccounts(db, oldSnapshot, adminEmail), /extensionAccess/);
  });
  for (const table of tables.filter((table) => table !== "ExtensionAccess")) {
    const missing = structuredClone(oldSnapshot);
    delete missing[table];
    assert.throws(() => validateAccounts(missing, adminEmail), /missing/);
  }
  for (const value of [null, undefined, {}, ""]) assert.throws(() => validateAccounts({ ...oldSnapshot, ExtensionAccess: value }, adminEmail), /missing ExtensionAccess/);
});

test("extension grants retain activation and dates while pending codes and expiry are invalidated", async () => {
  const input = structuredClone(source);
  input.ExtensionAccess = structuredClone(fixtureRows.extensionAccess).reverse();
  const original = structuredClone(input);
  await withTarget(async (db) => {
    await importAccounts(db, input, adminEmail, { provider: "sqlite", confirmed: true });
    for (const row of original.ExtensionAccess) {
      assert.deepEqual(await db.extensionAccess.findUniqueOrThrow({ where: { userId: row.userId } }), { ...row, codeHash: null, expiresAt: null });
    }
    await verifyAccounts(db, source, adminEmail);
    await verifyAccounts(db, input, adminEmail);
  });
  assert.deepEqual(input, original);
});

test("source reader rejects malformed ExtensionAccess schemas and orphan grants", async (t) => {
  const cases = [
    ["orphan", 'UPDATE "ExtensionAccess" SET "userId" = \'missing-user\' WHERE "userId" = \'fixture-user-admin\'', /foreign keys/],
    ["wrong primary key", 'DROP TABLE "ExtensionAccess"; CREATE TABLE "ExtensionAccess" ("userId" TEXT, "codeHash" TEXT PRIMARY KEY, "expiresAt" DATETIME, "activatedAt" DATETIME, "createdAt" DATETIME, "updatedAt" DATETIME)', /primary key/],
    ["wrong date type", 'DROP TABLE "ExtensionAccess"; CREATE TABLE "ExtensionAccess" ("userId" TEXT PRIMARY KEY, "codeHash" TEXT, "expiresAt" TEXT, "activatedAt" DATETIME, "createdAt" DATETIME, "updatedAt" DATETIME)', /column type/],
    ["missing column", 'ALTER TABLE "ExtensionAccess" DROP COLUMN "activatedAt"', /columns/],
    ["unknown column", 'ALTER TABLE "ExtensionAccess" ADD COLUMN "unexpected" TEXT', /columns/],
    ["required table absent", 'DROP TABLE "LoginThrottle"', /missing LoginThrottle/],
  ];
  for (const [name, sql, error] of cases) await t.test(name, async () => {
    const path = join(directory, `malformed-${name.replaceAll(" ", "-")}.db`);
    await copyFile(sourcePath, path);
    const sqlite = new DatabaseSync(path, { enableForeignKeyConstraints: false });
    try { sqlite.exec(sql); } finally { sqlite.close(); }
    const before = await readFile(path);
    await assert.rejects(readAccounts(path), error);
    assert.deepEqual(await readFile(path), before);
  });
});

test("selected admin lookup accepts normalized email without changing account identities", () => {
  assert.equal(validateAccounts(source, "  ADMIN@FIXTURE.INVALID  ").adminId, "fixture-user-admin");
});

test("disabled and pending non-primary accounts retain their state, identity, and business data", async () => {
  for (const state of [{ active: false, passwordHash }, { active: true, passwordHash: null }, { active: false, passwordHash: null }]) {
    const input = structuredClone(source);
    Object.assign(input.User.find((row) => row.id === "fixture-user-recruiter"), state);
    const expected = validateAccounts(input, adminEmail).data;
    await withTarget(async (db) => {
      await importAccounts(db, input, adminEmail, { provider: "sqlite", confirmed: true });
      const user = await db.user.findUniqueOrThrow({ where: { id: "fixture-user-recruiter" } });
      assert.equal(user.active, state.active);
      assert.equal(user.passwordHash, state.passwordHash);
      assert.deepEqual(user, expected.user.find((row) => row.id === user.id));
      assert.deepEqual(sorted(await db.role.findMany()), sorted(expected.role));
      await verifyAccounts(db, input, adminEmail);
    });
  }
});

test("validation rejects orphaned references and cross-owner relationships", async (t) => {
  const cases = [
    ["role owner", (data) => { data.Role[0].userId = "fixture-missing-user"; }],
    ["template owner", (data) => { data.MessageTemplate[0].userId = "fixture-missing-user"; }],
    ["search owner", (data) => { data.SavedSearch[0].userId = "fixture-missing-user"; }],
    ["settings owner", (data) => { data.Settings[0].userId = "fixture-missing-user"; }],
    ["extension grant owner", (data) => { data.ExtensionAccess[0].userId = "fixture-missing-user"; }],
    ["briefing role", (data) => { data.Briefing[0].roleId = "fixture-missing-role"; }],
    ["candidate role", (data) => { data.Candidate[0].roleId = "fixture-missing-role"; }],
    ["search role", (data) => { data.SavedSearch[0].roleId = "fixture-missing-role"; }],
    ["outreach candidate", (data) => { data.OutreachLog[0].candidateId = "fixture-missing-candidate"; }],
    ["outreach template", (data) => { data.OutreachLog[0].templateId = "fixture-missing-template"; }],
    ["cross-owner search role", (data) => { data.SavedSearch[0].roleId = data.Role.find((row) => row.userId !== data.SavedSearch[0].userId).id; }],
    ["cross-owner outreach template", (data) => {
      const roleId = data.Candidate.find((row) => row.id === data.OutreachLog[0].candidateId).roleId;
      const userId = data.Role.find((row) => row.id === roleId).userId;
      data.OutreachLog[0].templateId = data.MessageTemplate.find((row) => row.userId !== userId).id;
    }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const input = structuredClone(source);
    mutate(input);
    assert.throws(() => validateAccounts(input, adminEmail));
  });
});

test("validation rejects duplicate identities, normalized email collisions, invalid roles and stages", async (t) => {
  const cases = tables.map((table) => [`duplicate ${table} ID`, (data) => { data[table].push({ ...data[table][0] }); }]);
  cases.push(
    ["duplicate email", (data) => { data.User[1].email = data.User[0].email; }],
    ["normalized email collision", (data) => { data.User[1].email = `  ${data.User[0].email.toUpperCase()}  `; }],
    ["invalid email", (data) => { data.User[1].email = "not-an-email"; }],
    ["multiple settings per user", (data) => { data.Settings[1].userId = data.Settings[0].userId; }],
    ["multiple briefings per role", (data) => { data.Briefing[1].roleId = data.Briefing[0].roleId; }],
    ["invalid account role", (data) => { data.User[1].role = "superadmin"; }],
    ["invalid candidate stage", (data) => { data.Candidate[0].stage = "unsupported-stage"; }],
    ["invalid role status", (data) => { data.Role[0].status = "unsupported-status"; }],
    ["invalid template kind", (data) => { data.MessageTemplate[0].kind = "unsupported-kind"; }],
    ["unsupported password hash", (data) => { data.User[1].passwordHash = "fixture-unsupported-hash"; }],
    ["invalid timestamp", (data) => { data.Candidate[0].createdAt = "2024-02-31T00:00:00Z"; }],
    ...["activatedAt", "createdAt", "updatedAt"].map((column) => [`invalid extension ${column}`, (data) => { data.ExtensionAccess[0][column] = "2024-02-31T00:00:00Z"; }]),
    ["multiple extension grants per user", (data) => { data.ExtensionAccess[1].userId = data.ExtensionAccess[0].userId; }],
    ["auth version overflow", (data) => { data.User[1].authVersion = 2147483647; }],
  );
  for (const [name, mutate] of cases) await t.test(name, () => {
    const input = structuredClone(source);
    mutate(input);
    assert.throws(() => validateAccounts(input, adminEmail));
  });
});

test("primary admin must exist, be active and activated, and have the admin role", async (t) => {
  await t.test("missing selected admin", () => assert.throws(() => validateAccounts(source, "missing@fixture.invalid")));
  for (const [name, changes] of [["disabled", { active: false }], ["pending activation", { passwordHash: null }], ["unsupported password", { passwordHash: "fixture-invalid-hash" }], ["not an admin", { role: "recruiter" }]]) {
    await t.test(name, () => {
      const input = structuredClone(source);
      Object.assign(input.User.find((row) => row.email === adminEmail), changes);
      assert.throws(() => validateAccounts(input, adminEmail));
    });
  }
});

test("import preserves two workspaces, password hashes, exact dates and audits while invalidating all old authentication", async () => {
  await withTarget(async (db) => {
    await inspectAccountsTarget(db, { provider: "sqlite" });
    const expected = validateAccounts(source, adminEmail);
    const imported = await importAccounts(db, source, adminEmail, { provider: "sqlite", confirmed: true });
    assert.deepEqual(imported.counts ?? imported, expected.counts);
    for (const table of tables.filter((table) => table !== "AuditEvent")) {
      const model = modelFor(table);
      assert.deepEqual(sorted(await db[model].findMany()), sorted(expected.data[model]), table);
    }
    for (const row of expected.data.auditEvent) assert.deepEqual(await db.auditEvent.findUnique({ where: { id: row.id } }), row);
    const importAudits = await db.auditEvent.findMany({ where: { action: "accounts.import" } });
    assert.equal(await db.auditEvent.count(), expected.data.auditEvent.length + 1);
    assert.equal(importAudits.length, 1);
    assert.equal(importAudits[0].actorId, expected.adminId);
    assert.equal(importAudits[0].targetUserId, expected.adminId);
    for (const table of ephemeralTables) assert.equal(await db[modelFor(table)].count(), 0, table);
    await verifyAccounts(db, source, adminEmail);
    const beforeRepeat = await allRows(db);
    await assert.rejects(importAccounts(db, source, adminEmail, { provider: "sqlite", confirmed: true }));
    assert.deepEqual(await allRows(db), beforeRepeat);
  });
  assert.deepEqual(await readFile(sourcePath), sourceBytes);
});

test("import requires explicit confirmation and validates before committing any rows", async () => {
  await withTarget(async (db) => {
    await assert.rejects(importAccounts(db, source, adminEmail, { provider: "sqlite" }), /confirm/i);
    await assertEmpty(db);
    const invalid = structuredClone(source);
    invalid.OutreachLog[0].templateId = "fixture-missing-template";
    await assert.rejects(importAccounts(db, invalid, adminEmail, { provider: "sqlite", confirmed: true }));
    await assertEmpty(db);
  });
});

test("every nonempty target model is refused without modifying existing rows", async (t) => {
  const isolatedRows = {
    ...Object.fromEntries(tables.map((table) => [table, source[table][0]])),
    Session: { tokenHash: sessionHash, userId: "fixture-user-admin", viewUserId: null, authVersion: 4, expiresAt: updatedAt.getTime(), createdAt: createdAt.getTime() },
    ActivationToken: { tokenHash: activationHash, userId: "fixture-user-admin", expiresAt: updatedAt.getTime(), createdAt: createdAt.getTime() },
    LoginThrottle: { key: throttleKey, attempts: 2, resetAt: updatedAt.getTime() },
  };
  for (const table of [...tables, ...ephemeralTables]) await t.test(table, async () => {
    await withTarget(async (db) => {
      const before = await allRows(db);
      assert.equal(before.user.length, table === "User" ? 1 : 0);
      await assert.rejects(inspectAccountsTarget(db, { provider: "sqlite" }));
      assert.deepEqual(await allRows(db), before);
      await assert.rejects(importAccounts(db, source, adminEmail, { provider: "sqlite", confirmed: true }));
      assert.deepEqual(await allRows(db), before);
    }, (sqlite) => insertRaw(sqlite, table, isolatedRows[table]));
  });
});

test("PostgreSQL import requests a transaction-wide lock on all target tables before checking or inserting rows", async () => {
  const operations = [];
  let transactions = 0;
  const stored = Object.fromEntries(models.map((model) => [model, []]));
  const tx = Object.fromEntries(models.map((model) => [model, {
    async count() { operations.push({ kind: "count", model }); return stored[model].length; },
    async create({ data }) {
      operations.push({ kind: "create", model });
      const row = model === "auditEvent" && !data.id ? { id: "fixture-import-audit", createdAt: updatedAt, ...data } : data;
      stored[model].push(row);
      return row;
    },
    async findMany() { return stored[model]; },
  }]));
  tx.$executeRawUnsafe = async (sql) => { operations.push({ kind: "sql", sql }); return 0; };
  const db = {
    async $transaction(callback) {
      transactions++;
      return callback(tx);
    },
  };
  await importAccounts(db, source, adminEmail, { provider: "postgresql", confirmed: true });
  assert.equal(transactions, 1);
  const lockIndex = operations.findIndex((entry) => entry.kind === "sql" && /LOCK TABLE/i.test(entry.sql));
  assert.ok(lockIndex >= 0, "PostgreSQL apply must explicitly lock the target");
  for (const table of [...tables, ...ephemeralTables]) assert.ok(operations[lockIndex].sql.includes(`"${table}"`), `${table} must be locked`);
  assert.match(operations[lockIndex].sql, /IN EXCLUSIVE MODE/i);
  assert.ok(lockIndex < operations.findIndex((entry) => entry.kind === "count"));
  assert.ok(lockIndex < operations.findIndex((entry) => entry.kind === "create"));
});

test("a late database failure rolls back every imported account and business row", async () => {
  await withTarget(async (db) => {
    await db.$executeRawUnsafe(`CREATE TRIGGER fixture_fail_import BEFORE INSERT ON "AuditEvent" WHEN (SELECT COUNT(*) FROM "User") >= 2 BEGIN SELECT RAISE(ABORT, 'fixture-induced-import-failure'); END`);
    await assert.rejects(importAccounts(db, source, adminEmail, { provider: "sqlite", confirmed: true }), /auditEvent\.create/);
    await assertEmpty(db);
    await db.$executeRawUnsafe("DROP TRIGGER fixture_fail_import");
    await importAccounts(db, source, adminEmail, { provider: "sqlite", confirmed: true });
    await verifyAccounts(db, source, adminEmail);
  });
});

test("post-import verification detects content, ownership, audit and authentication tampering", async (t) => {
  const cases = [
    ["candidate content", (db) => db.candidate.update({ where: { id: "fixture-candidate-admin" }, data: { notes: "fixture tampering" } })],
    ["password hash", (db) => db.user.update({ where: { id: "fixture-user-recruiter" }, data: { passwordHash: null } })],
    ["auth version", (db) => db.user.update({ where: { id: "fixture-user-admin" }, data: { authVersion: 99 } })],
    ["template owner", (db) => db.messageTemplate.update({ where: { id: "fixture-template-admin" }, data: { userId: "fixture-user-recruiter" } })],
    ["original audit", (db) => db.auditEvent.update({ where: { id: "fixture-audit-admin" }, data: { action: "fixture.tampered" } })],
    ["missing import audit", (db) => db.auditEvent.deleteMany({ where: { action: "accounts.import" } })],
    ["extra import audit", (db) => db.auditEvent.create({ data: { actorId: "fixture-user-admin", targetUserId: "fixture-user-admin", action: "accounts.import" } })],
    ["wrong import actor", (db) => db.auditEvent.updateMany({ where: { action: "accounts.import" }, data: { actorId: "fixture-user-recruiter" } })],
    ["wrong import target", (db) => db.auditEvent.updateMany({ where: { action: "accounts.import" }, data: { targetUserId: "fixture-user-recruiter" } })],
    ["capture key", (db) => db.settings.update({ where: { userId: "fixture-user-admin" }, data: { captureTokenHash: captureHashes[0] } })],
    ["unauthorized extension activation", (db) => db.extensionAccess.update({ where: { userId: "fixture-user-recruiter" }, data: { activatedAt: updatedAt } })],
    ["revoked extension grant", (db) => db.extensionAccess.update({ where: { userId: "fixture-user-admin" }, data: { activatedAt: null } })],
    ["deleted extension grant", (db) => db.extensionAccess.delete({ where: { userId: "fixture-user-admin" } })],
    ["pending extension code", (db) => db.extensionAccess.update({ where: { userId: "fixture-user-recruiter" }, data: { codeHash: extensionCodeHashes[1] } })],
    ["pending extension expiry", (db) => db.extensionAccess.update({ where: { userId: "fixture-user-recruiter" }, data: { expiresAt: updatedAt } })],
    ...["createdAt", "updatedAt"].map((column) => [`extension ${column}`, (db) => db.extensionAccess.update({ where: { userId: "fixture-user-admin" }, data: { [column]: new Date("2026-01-01T00:00:00Z") } })]),
    ["swapped extension ownership", async (db) => {
      await db.extensionAccess.deleteMany();
      for (const row of validateAccounts(source, adminEmail).data.extensionAccess) await db.extensionAccess.create({ data: { ...row, userId: row.userId === "fixture-user-admin" ? "fixture-user-recruiter" : "fixture-user-admin" } });
    }],
    ["session", (db) => db.session.create({ data: { tokenHash: sessionHash, userId: "fixture-user-admin", expiresAt: updatedAt } })],
    ["activation token", (db) => db.activationToken.create({ data: { tokenHash: activationHash, userId: "fixture-user-admin", expiresAt: updatedAt } })],
    ["login throttle", (db) => db.loginThrottle.create({ data: { key: throttleKey, resetAt: updatedAt } })],
    ["deleted outreach", (db) => db.outreachLog.delete({ where: { id: "fixture-outreach-admin" } })],
    ["extra business row", (db) => db.role.create({ data: { id: "fixture-extra-role", userId: "fixture-user-admin", title: "fixture unexpected role" } })],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    await withTarget(async (db) => {
      await importAccounts(db, source, adminEmail, { provider: "sqlite", confirmed: true });
      await verifyAccounts(db, source, adminEmail);
      await mutate(db);
      const tampered = await allRows(db);
      await assert.rejects(verifyAccounts(db, source, adminEmail));
      assert.deepEqual(await allRows(db), tampered);
    });
  });
});

test("snapshot creates a readable consistent backup and never overwrites an existing destination", async () => {
  const path = join(directory, "snapshot.db");
  const result = await snapshotAccounts(sourcePath, path);
  assert.deepEqual(await readAccounts(path), source);
  assert.deepEqual(await readFile(sourcePath), sourceBytes);
  const snapshotBytes = await readFile(path);
  assert.equal(result.sourceSha256, sha256(sourceBytes));
  assert.equal(result.snapshotSha256, sha256(snapshotBytes));
  await assert.rejects(snapshotAccounts(sourcePath, path));
  assert.deepEqual(await readFile(path), snapshotBytes);
  const sentinelPath = join(directory, "existing-snapshot.db");
  const sentinel = "fixture destination must remain untouched";
  await writeFile(sentinelPath, sentinel, { flag: "wx" });
  await assert.rejects(snapshotAccounts(sourcePath, sentinelPath));
  assert.equal(await readFile(sentinelPath, "utf8"), sentinel);
  await assert.rejects(snapshotAccounts(sourcePath, sourcePath));
  assert.deepEqual(await readFile(sourcePath), sourceBytes);
});

test("snapshot reads committed WAL data consistently without copying an uncommitted writer transaction", async () => {
  const walPath = join(directory, "wal-source.db");
  const snapshotPath = join(directory, "wal-snapshot.db");
  await copyFile(sourcePath, walPath);
  const writer = new DatabaseSync(walPath);
  try {
    writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
    writer.prepare('UPDATE "Candidate" SET "notes" = ? WHERE "id" = ?').run("fixture committed WAL note", "fixture-candidate-admin");
    const committed = await readAccounts(walPath);
    writer.exec("BEGIN IMMEDIATE");
    writer.prepare('UPDATE "Candidate" SET "notes" = ? WHERE "id" = ?').run("fixture uncommitted WAL note", "fixture-candidate-admin");
    await snapshotAccounts(walPath, snapshotPath);
    assert.deepEqual(await readAccounts(snapshotPath), committed);
    const check = new DatabaseSync(snapshotPath, { readOnly: true });
    try {
      assert.deepEqual(check.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(check.prepare("PRAGMA quick_check").get().quick_check, "ok");
    } finally { check.close(); }
    writer.exec("ROLLBACK");
    assert.deepEqual(await readAccounts(walPath), committed);
  } finally {
    if (writer.isTransaction) writer.exec("ROLLBACK");
    writer.close();
  }
});

test("CLI refuses SQLite targets before attempting default dry-run or noninteractive apply writes", { timeout: 150000 }, async () => {
  await withTarget(async (db, path) => {
    const before = await readFile(path);
    for (const flags of [[], ["--apply"]]) {
      const result = spawnSync(process.execPath, [importer, "--source", sourcePath, "--admin-email", adminEmail, ...flags], { encoding: "utf8", timeout: 60000, env: { ...process.env, DATABASE_URL: fileUrl(path) } });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /target must be PostgreSQL/i);
      assert.equal(result.stdout, "");
      for (const secret of [passwordHash, ...captureHashes, ...extensionCodeHashes, sessionHash, activationHash, throttleKey, adminEmail]) assert.equal(result.stderr.includes(secret), false);
      assert.deepEqual(await readFile(path), before);
      assert.deepEqual(await readFile(sourcePath), sourceBytes);
      await assertEmpty(db);
    }
  });
});

test("CLI snapshot reports counts and fingerprints without printing private contents or touching the target", { timeout: 150000 }, async () => {
  await withTarget(async (db, path) => {
    const before = await readFile(path);
    const snapshotPath = join(directory, "cli-snapshot.db");
    const result = spawnSync(process.execPath, [importer, "--source", sourcePath, "--admin-email", adminEmail, "--snapshot", snapshotPath], { encoding: "utf8", timeout: 120000, env: { ...process.env, DATABASE_URL: fileUrl(path) } });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const output = `${result.stdout}\n${result.stderr}`;
    for (const secret of [passwordHash, ...captureHashes, ...extensionCodeHashes, sessionHash, activationHash, throttleKey, adminEmail, "admin private candidate notes", "admin private rendered outreach", "admin private {{first_name}} template"]) assert.equal(output.includes(secret), false);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.counts, validateAccounts(source, adminEmail).counts);
    assert.equal(report.sourceSha256, sha256(sourceBytes));
    assert.equal(report.snapshotSha256, sha256(await readFile(snapshotPath)));
    assert.deepEqual(await readAccounts(snapshotPath), source);
    await assertEmpty(db);
    assert.deepEqual(await readFile(path), before);
    assert.deepEqual(await readFile(sourcePath), sourceBytes);
  });
});
