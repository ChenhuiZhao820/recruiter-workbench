import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { legacyColumns, legacyDate } from "./import-legacy.mjs";
import { normalizeEmail, parseArgs, SafeError, targetProvider } from "./bootstrap-admin.mjs";

const settingsColumns = Object.fromEntries(Object.entries(legacyColumns.Settings).filter(([column]) => column !== "captureToken"));
export const accountColumns = {
  User: { id: "id", email: "email", name: "text", role: "userRole", active: "bool", passwordHash: "password?", authVersion: "int", createdAt: "date", updatedAt: "date" },
  ExtensionAccess: { userId: "id", codeHash: "discard", expiresAt: "date?", activatedAt: "date?", createdAt: "date", updatedAt: "date" },
  Role: { ...legacyColumns.Role, userId: "id", status: "roleStatus" },
  MessageTemplate: { ...legacyColumns.MessageTemplate, userId: "id" },
  Briefing: legacyColumns.Briefing,
  SavedSearch: { ...legacyColumns.SavedSearch, userId: "id" },
  Candidate: { ...legacyColumns.Candidate, stage: "stage" },
  OutreachLog: legacyColumns.OutreachLog,
  Settings: { ...settingsColumns, userId: "id", captureTokenHash: "discard" },
  AuditEvent: { id: "id", actorId: "id", targetUserId: "id?", action: "text", createdAt: "date" },
};
const ephemeralColumns = {
  Session: { tokenHash: "text", userId: "id", viewUserId: "id?", authVersion: "int", expiresAt: "date", createdAt: "date" },
  ActivationToken: { tokenHash: "text", userId: "id", expiresAt: "date", createdAt: "date" },
  LoginThrottle: { key: "text", attempts: "int", resetAt: "date" },
};
const modelFor = (table) => table[0].toLowerCase() + table.slice(1);
const allTables = [...Object.keys(accountColumns), ...Object.keys(ephemeralColumns)];
const allModels = allTables.map(modelFor);
const primaryFor = (table) => table === "ExtensionAccess" ? "userId" : Object.hasOwn(accountColumns, table) ? "id" : table === "LoginThrottle" ? "key" : "tokenHash";
const passwordPattern = /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/;
const stages = ["sourced", "contacted", "replied", "booking_pending", "booked", "rejected", "placed"];
const invalid = (detail) => { throw new SafeError(`Invalid multi-account source: ${detail}. No data values are printed.`); };
const countsFor = (data) => Object.fromEntries(Object.entries(data).map(([model, rows]) => [model, rows.length]));

function convert(value, descriptor) {
  if (descriptor === "discard") return null;
  if (value === null && descriptor.endsWith("?")) return null;
  const type = descriptor.replace("?", "");
  if (type === "date") return legacyDate(value instanceof Date ? value.getTime() : value);
  if (type === "bool") {
    if (![true, false, 0, 1].includes(value)) invalid("invalid boolean");
    return Boolean(value);
  }
  if (type === "int") {
    if (!Number.isInteger(value) || value < 0 || value > 2147483647) invalid("invalid integer");
    return value;
  }
  if (typeof value !== "string" || value.includes("\0")) invalid("invalid text");
  if (type === "id" && !value.trim()) invalid("empty identifier");
  if (type === "email" && normalizeEmail(value) !== value) invalid("email is not normalized");
  if (type === "password" && !passwordPattern.test(value)) invalid("unsupported password hash; upgrade the migration tool before proceeding");
  if (type === "userRole" && !["admin", "recruiter"].includes(value)) invalid("unknown account role");
  if (type === "roleStatus" && !["open", "closed"].includes(value)) invalid("unknown role status");
  if (type === "stage" && !stages.includes(value)) invalid("unknown candidate stage");
  if (type === "kind" && !["message", "connection_note"].includes(value)) invalid("unknown outreach kind");
  return value;
}

export function validateAccounts(source, adminEmail) {
  adminEmail = normalizeEmail(adminEmail);
  if (!source || Object.keys(source).some((table) => !Object.hasOwn(accountColumns, table))) invalid("unexpected source table");
  const data = {};
  const byId = {};
  for (const [table, columns] of Object.entries(accountColumns)) {
    const rows = table === "ExtensionAccess" && !Object.hasOwn(source, table) ? [] : source[table];
    if (!Array.isArray(rows)) invalid(`missing ${table} table`);
    const model = modelFor(table);
    const primary = primaryFor(table);
    byId[table] = new Map();
    data[model] = rows.map((row) => {
      if (!row || typeof row !== "object" || Object.keys(row).some((column) => !Object.hasOwn(columns, column))) invalid(`unexpected ${table} column`);
      const result = {};
      for (const [column, descriptor] of Object.entries(columns)) {
        if (!Object.hasOwn(row, column)) invalid(`missing ${table} column`);
        result[column] = convert(row[column], descriptor);
      }
      if (byId[table].has(result[primary])) invalid(`duplicate ${table} identifier`);
      if (table === "ExtensionAccess") result.expiresAt = null;
      if (table === "User") {
        if (result.authVersion >= 2147483647) invalid("account version overflow");
        result.authVersion++;
      }
      if (table === "Settings" && (result.id < 1 || result.id >= 2147483647 || result.bookingChaseDays < 1 || result.quietNudgeDays < 1)) invalid("invalid settings values");
      byId[table].set(result[primary], result);
      return result;
    });
  }
  if (new Set(data.user.map((user) => user.email)).size !== data.user.length) invalid("duplicate email");
  const admin = data.user.find((user) => user.email === adminEmail);
  if (!admin || admin.role !== "admin" || !admin.active || !admin.passwordHash) invalid("selected Admin must be active and have a password set");
  const get = (table, id) => {
    const row = byId[table].get(id);
    if (!row) invalid(`missing ${table} relationship`);
    return row;
  };
  for (const model of ["role", "messageTemplate", "savedSearch", "settings", "extensionAccess"]) {
    for (const row of data[model]) get("User", row.userId);
  }
  if (new Set(data.settings.map((row) => row.userId)).size !== data.settings.length) invalid("multiple settings rows for one account");
  if (new Set(data.briefing.map((row) => row.roleId)).size !== data.briefing.length) invalid("multiple briefings for one role");
  for (const row of [...data.briefing, ...data.candidate]) get("Role", row.roleId);
  for (const search of data.savedSearch) {
    if (search.roleId !== null && get("Role", search.roleId).userId !== search.userId) invalid("search belongs to a different account than its role");
  }
  for (const outreach of data.outreachLog) {
    const candidate = get("Candidate", outreach.candidateId);
    if (outreach.templateId !== null && get("MessageTemplate", outreach.templateId).userId !== get("Role", candidate.roleId).userId) invalid("outreach uses another account's template");
  }
  return { data, adminId: admin.id, counts: countsFor(data) };
}

export async function readAccounts(sourcePath) {
  const path = await realpath(sourcePath);
  if (!(await lstat(path)).isFile()) invalid("source is not a database file");
  const db = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    db.exec("PRAGMA query_only = ON; BEGIN");
    const objects = db.prepare("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
    const tables = objects.filter((entry) => entry.type === "table").map((entry) => entry.name);
    const supported = { ...accountColumns, ...ephemeralColumns };
    if (objects.some((entry) => ["trigger", "view"].includes(entry.type)) || tables.some((table) => table !== "_prisma_migrations" && !Object.hasOwn(supported, table))) invalid("unsupported tables, triggers or views");
    if (db.prepare("PRAGMA quick_check").all().some((row) => row.quick_check !== "ok") || db.prepare("PRAGMA foreign_key_check").all().length) invalid("SQLite integrity or foreign keys");
    const rows = {};
    for (const [table, columns] of Object.entries(supported)) {
      if (!tables.includes(table)) {
        if (table !== "ExtensionAccess") invalid(`missing ${table} table`);
        rows[table] = [];
        continue;
      }
      const actual = db.prepare(`PRAGMA table_info("${table}")`).all();
      if (actual.length !== Object.keys(columns).length || actual.some((column) => !Object.hasOwn(columns, column.name))) invalid(`unsupported ${table} columns`);
      for (const column of actual) {
        const descriptor = columns[column.name];
        const type = descriptor.startsWith("date") ? "DATETIME" : descriptor === "int" ? "INTEGER" : descriptor === "bool" ? "BOOLEAN" : "TEXT";
        const primary = primaryFor(table);
        if (column.type.toUpperCase() !== type || column.pk !== Number(column.name === primary)) invalid(`unsupported ${table} column type or primary key`);
      }
      if (!Object.hasOwn(accountColumns, table)) continue;
      const selected = Object.keys(columns).map((column) => columns[column] === "discard" || (table === "ExtensionAccess" && column === "expiresAt") ? `NULL AS "${column}"` : `"${column}"`);
      rows[table] = db.prepare(`SELECT ${selected.join(", ")} FROM "${table}"`).all();
    }
    db.exec("COMMIT");
    return rows;
  } finally { db.close(); }
}

export async function fileHash(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function snapshotAccounts(sourcePath, outputPath) {
  const source = await realpath(sourcePath);
  await readAccounts(source);
  const before = await fileHash(source);
  const file = await open(outputPath, "wx", 0o600);
  await file.close();
  const db = new DatabaseSync(source, { readOnly: true });
  try { db.prepare("VACUUM INTO ?").run(resolve(outputPath)); } finally { db.close(); }
  await readAccounts(outputPath);
  if (await fileHash(source) !== before) throw new SafeError("Source changed while snapshotting. Stop the local app and take a fresh snapshot before migration.");
  return { sourceSha256: before, snapshotSha256: await fileHash(outputPath) };
}

async function requireEmptyTarget(db) {
  for (const model of allModels) {
    if (await db[model].count()) throw new SafeError("Target must be completely empty, including accounts, audit and authentication tables. Nothing will be merged or cleared.");
  }
}

export async function inspectAccountsTarget(db, { provider = "postgresql" } = {}) {
  if (!["sqlite", "postgresql"].includes(provider)) throw new SafeError("Unsupported target provider.");
  return db.$transaction(async (tx) => {
    await requireEmptyTarget(tx);
    return { empty: true };
  }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 });
}

const canonical = (rows, columns, primary) => JSON.stringify([...rows].sort((a, b) => String(a[primary]).localeCompare(String(b[primary]))).map((row) => columns.map((column) => row[column])));

function assertSameSnapshot(expected, actual) {
  for (const [table, columns] of Object.entries(accountColumns)) {
    const model = modelFor(table);
    if (canonical(expected.data[model], Object.keys(columns), primaryFor(table)) !== canonical(actual.data[model], Object.keys(columns), primaryFor(table))) {
      throw new SafeError("Snapshot content changed after preflight; do not import it.");
    }
  }
}

async function verifyData(db, validated) {
  for (const [table, columns] of Object.entries(accountColumns)) {
    const model = modelFor(table);
    const expected = validated.data[model];
    let actual = await db[model].findMany();
    if (model === "auditEvent") {
      const originalIds = new Set(expected.map((row) => row.id));
      const extra = actual.filter((row) => !originalIds.has(row.id));
      if (extra.length !== 1 || extra[0].action !== "accounts.import" || extra[0].actorId !== validated.adminId || extra[0].targetUserId !== validated.adminId) throw new SafeError("Import audit verification failed.");
      actual = actual.filter((row) => originalIds.has(row.id));
    }
    if (canonical(actual, Object.keys(columns), primaryFor(table)) !== canonical(expected, Object.keys(columns), primaryFor(table))) throw new SafeError(`Imported ${model} content or ownership does not match the snapshot.`);
  }
  for (const table of Object.keys(ephemeralColumns)) {
    if (await db[modelFor(table)].count()) throw new SafeError("Unexpected session, activation or throttle state in target.");
  }
  return { verified: true, counts: validated.counts };
}

export async function importAccounts(db, source, adminEmail, { provider = "postgresql", confirmed = false } = {}) {
  if (!confirmed) throw new SafeError("Account import requires explicit execution-time confirmation.");
  if (!["sqlite", "postgresql"].includes(provider)) throw new SafeError("Unsupported target provider.");
  const validated = validateAccounts(source, adminEmail);
  return db.$transaction(async (tx) => {
    if (provider === "postgresql") await tx.$executeRawUnsafe(`LOCK TABLE ${allTables.map((table) => `"${table}"`).join(", ")} IN EXCLUSIVE MODE`);
    await requireEmptyTarget(tx);
    for (const [model, rows] of Object.entries(validated.data)) {
      for (const row of rows) await tx[model].create({ data: row });
    }
    if (provider === "postgresql" && validated.data.settings.length) {
      const next = Math.max(...validated.data.settings.map((row) => row.id)) + 1;
      await tx.$executeRawUnsafe(`ALTER SEQUENCE "Settings_id_seq" RESTART WITH ${next}`);
    }
    await tx.auditEvent.create({ data: { actorId: validated.adminId, targetUserId: validated.adminId, action: "accounts.import" } });
    return verifyData(tx, validated);
  }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 120000 });
}

export async function verifyAccounts(db, source, adminEmail) {
  const validated = validateAccounts(source, adminEmail);
  return db.$transaction((tx) => verifyData(tx, validated), { isolationLevel: "Serializable", maxWait: 10000, timeout: 120000 });
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["--source", "--admin-email", "--snapshot", "--apply", "--dry-run", "--verify"], ["--apply", "--dry-run", "--verify"]);
  if (!args["--source"] || !args["--admin-email"] || [args["--snapshot"], args["--apply"], args["--dry-run"], args["--verify"]].filter(Boolean).length > 1) {
    throw new SafeError("Usage: node scripts/import-accounts.mjs --source SQLITE_SNAPSHOT --admin-email EMAIL [--snapshot NEW_FILE | --dry-run | --apply | --verify]");
  }
  const sourcePath = await realpath(resolve(args["--source"]));
  const initialHash = await fileHash(sourcePath);
  const source = await readAccounts(sourcePath);
  const validated = validateAccounts(source, args["--admin-email"]);
  if (await fileHash(sourcePath) !== initialHash) throw new SafeError("Source changed while reading. Use an offline snapshot.");
  if (args["--snapshot"]) {
    const output = resolve(args["--snapshot"]);
    const hashes = await snapshotAccounts(sourcePath, output);
    const copied = validateAccounts(await readAccounts(output), args["--admin-email"]);
    assertSameSnapshot(validated, copied);
    console.log(JSON.stringify({ snapshot: output, counts: copied.counts, ...hashes }));
    return;
  }
  if (targetProvider(process.env.DATABASE_URL) !== "postgresql") throw new SafeError("The command-line target must be PostgreSQL. Set its DATABASE_URL privately; do not overwrite the local application configuration.");
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: [] });
  try {
    if (args["--verify"]) {
      console.log(JSON.stringify(await verifyAccounts(db, source, args["--admin-email"])));
      return;
    }
    await inspectAccountsTarget(db);
    console.log(JSON.stringify({ counts: validated.counts, sourceSha256: initialHash, credentials: "Password hashes and activated extension grants preserved; pending extension code hashes and expiries cleared; sessions, activation links, capture keys and throttles are not imported." }));
    if (!args["--apply"]) return;
    if (!process.stdin.isTTY || !process.stderr.isTTY) throw new SafeError("--apply requires an interactive terminal; no target data has been written.");
    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    let answer;
    try { answer = await prompt.question("Import all accounts and data into this empty PostgreSQL database? Type IMPORT ACCOUNTS to apply: "); }
    finally { prompt.close(); }
    if (answer !== "IMPORT ACCOUNTS") throw new SafeError("Import cancelled; no target data has been changed.");
    if (await fileHash(sourcePath) !== initialHash) throw new SafeError("Snapshot changed after preflight. Import cancelled.");
    assertSameSnapshot(validated, validateAccounts(await readAccounts(sourcePath), args["--admin-email"]));
    console.log(JSON.stringify(await importAccounts(db, source, args["--admin-email"], { confirmed: true })));
    console.log("Account import committed and verified. Use existing passwords to sign in; generate new capture keys on the hosted workbench.");
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof SafeError ? error.message : "Multi-account migration failed. No source writes are requested. Check schema/client provider and target access; inspect target audit state before retrying an interrupted apply.");
    process.exitCode = 1;
  });
}
