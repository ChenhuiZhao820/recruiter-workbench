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
  User: { id: "id", email: "email", name: "text", role: "userRole", accountTier: "accountTier", trialExpiresAt: "date?", active: "bool", passwordHash: "password?", authVersion: "int", createdAt: "date", updatedAt: "date" },
  ExtensionAccess: { userId: "id", codeHash: "discard", expiresAt: "date?", activatedAt: "date?", createdAt: "date", updatedAt: "date" },
  Role: { ...legacyColumns.Role, userId: "id", status: "roleStatus", budgetMin: "int?", budgetMax: "int?", budgetCurrency: "text?" },
  Person: {
    id: "id", userId: "id", fullName: "text", profileUrl: "text?", memberId: "text?", headline: "text?",
    email: "text?", emailSource: "text?", emailConsentAt: "date?", salaryMin: "int?", salaryMax: "int?",
    salaryCurrency: "text?", salaryNote: "text?", noticeWeeks: "int?", availableFrom: "date?", location: "text?",
    remotePreference: "text?", rightToWork: "text?", rightToWorkNote: "text?", skillsSummary: "text?",
    motivation: "text?", factsConfirmedAt: "date?", revisitOn: "date?", revisitNote: "text?",
    doNotContact: "bool", searchText: "text", lastContactAt: "date?", createdAt: "date", updatedAt: "date",
  },
  MessageTemplate: { ...legacyColumns.MessageTemplate, userId: "id" },
  Briefing: legacyColumns.Briefing,
  SavedSearch: { ...legacyColumns.SavedSearch, userId: "id", searchUrl: "text?" },
  Candidate: { ...legacyColumns.Candidate, stage: "stage", memberId: "text?", personId: "id?" },
  OutreachLog: legacyColumns.OutreachLog,
  PersonNote: { id: "id", personId: "id", candidateId: "id?", body: "text", createdAt: "date", updatedAt: "date" },
  Screening: {
    id: "id", candidateId: "id", status: "text", transcript: "text?", transcriptSource: "text?",
    transcriptDeleteAfter: "date?", summaryJson: "text?", summaryModel: "text?", generatedAt: "date?",
    confirmedAt: "date?", representConsentAt: "date?", clientEmailSentAt: "date?", createdAt: "date", updatedAt: "date",
  },
  Booking: {
    id: "id", candidateId: "id", userId: "id", startsAt: "date", endsAt: "date", mode: "text", meetingUrl: "text?",
    phone: "text?", email: "text", consentAt: "date", noticeVersion: "text", status: "text", createdAt: "date",
  },
  Settings: {
    ...settingsColumns, userId: "id", captureTokenHash: "discard", seenRelease: "text?",
    bookingWindows: "text", bookingTimezone: "text", bookingDurationMins: "int", bookingMinNoticeHours: "int",
    bookingHorizonDays: "int", meetingLink: "text", offerPhone: "bool", privacyNotice: "text", privacyContactEmail: "text",
  },
  AuditEvent: { id: "id", actorId: "id", targetUserId: "id?", action: "text", createdAt: "date" },
  UsageEvent: { id: "id", userId: "id", kind: "text", value: "int?", at: "date" },
  Suppression: { userId: "id", keyHash: "text", createdAt: "date" },
};
// Tables a source may not have yet: it was written before they existed.
const optionalTables = new Set(["ExtensionAccess", "Person", "Screening", "Booking", "UsageEvent", "Suppression", "CalendarConnection", "AiUsage", "BookedSlot", "PersonNote", "IntegrationConnection"]);
// Accepted in a source but never copied. Calendar and integration tokens are
// encrypted with the source deployment's key and must be reconnected; monthly
// AI counters start again; booked-slot locks are rebuilt from the bookings.
const notImportedColumns = {
  CalendarConnection: { userId: "id", provider: "text", tokenCipher: "text", scope: "text", connectedAt: "date", lastErrorAt: "date?" },
  IntegrationConnection: { userId: "id", provider: "text", tokenCipher: "text", label: "text", connectedAt: "date", lastErrorAt: "date?" },
  AiUsage: { userId: "id", month: "text", generations: "int" },
  BookedSlot: { userId: "id", startsAt: "date", bookingId: "id" },
};
const ephemeralColumns = {
  Session: { tokenHash: "text", userId: "id", viewUserId: "id?", authVersion: "int", expiresAt: "date", createdAt: "date" },
  ActivationToken: { tokenHash: "text", userId: "id", expiresAt: "date", createdAt: "date" },
  LoginThrottle: { key: "text", attempts: "int", resetAt: "date" },
};
const modelFor = (table) => table[0].toLowerCase() + table.slice(1);
const allTables = [...Object.keys(accountColumns), ...Object.keys(ephemeralColumns), ...Object.keys(notImportedColumns)];
const allModels = allTables.map(modelFor);
const primaryKeys = {
  ExtensionAccess: ["userId"], Suppression: ["userId", "keyHash"], CalendarConnection: ["userId"], IntegrationConnection: ["userId", "provider"],
  AiUsage: ["userId", "month"], BookedSlot: ["userId", "startsAt"], LoginThrottle: ["key"],
  Session: ["tokenHash"], ActivationToken: ["tokenHash"],
};
const primaryFor = (table) => primaryKeys[table] ?? ["id"];
const keyPart = (value) => value instanceof Date ? value.toISOString() : String(value);
const keyOf = (table, row) => primaryFor(table).map((column) => keyPart(row[column])).join("|");
const passwordPattern = /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/;
const stages = ["sourced", "contacted", "replied", "booking_pending", "booked", "screened", "submitted", "rejected", "placed"];
// Columns added after the first multi-account databases were written. A source
// made before one of these groups existed has none of that group's columns and
// imports with the defaults below; a source with some of a group but not all of
// it is refused rather than guessed at. The SQL literal is what the reader
// selects in place of a column that is not there.
const lateColumns = {
  User: [{ accountTier: { value: "basic", sql: "'basic'" }, trialExpiresAt: { value: null, sql: "NULL" } }],
  Role: [{ budgetMin: { value: null, sql: "NULL" }, budgetMax: { value: null, sql: "NULL" }, budgetCurrency: { value: null, sql: "NULL" } }],
  SavedSearch: [{ searchUrl: { value: null, sql: "NULL" } }],
  Candidate: [{ memberId: { value: null, sql: "NULL" } }, { personId: { value: null, sql: "NULL" } }],
  Settings: [
    { seenRelease: { value: null, sql: "NULL" } },
    {
      bookingWindows: { value: "[]", sql: "'[]'" }, bookingTimezone: { value: "Europe/London", sql: "'Europe/London'" },
      bookingDurationMins: { value: 30, sql: "30" }, bookingMinNoticeHours: { value: 12, sql: "12" },
      bookingHorizonDays: { value: 14, sql: "14" }, meetingLink: { value: "", sql: "''" }, offerPhone: { value: false, sql: "0" },
      privacyNotice: { value: "", sql: "''" }, privacyContactEmail: { value: "", sql: "''" },
    },
  ],
};
const lateFor = (table) => lateColumns[table] ?? [];
const lateDefault = (table, column) => lateFor(table).find((group) => Object.hasOwn(group, column))[column];
// Columns of every group that is wholly missing; a group that is only partly
// present is refused by the column checks rather than guessed at.
const absentLate = (table, hasColumn) => new Set(lateFor(table).filter((group) => Object.keys(group).every((column) => !hasColumn(column))).flatMap(Object.keys));
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
  if (type === "accountTier" && !["basic", "pro", "trial"].includes(value)) invalid("unknown account tier");
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
    const rows = optionalTables.has(table) && !Object.hasOwn(source, table) ? [] : source[table];
    if (!Array.isArray(rows)) invalid(`missing ${table} table`);
    const absent = absentLate(table, (column) => rows.some((row) => row && typeof row === "object" && Object.hasOwn(row, column)));
    const model = modelFor(table);
    byId[table] = new Map();
    data[model] = rows.map((row) => {
      if (!row || typeof row !== "object" || Object.keys(row).some((column) => !Object.hasOwn(columns, column))) invalid(`unexpected ${table} column`);
      const result = {};
      for (const [column, descriptor] of Object.entries(columns)) {
        if (absent.has(column)) {
          result[column] = lateDefault(table, column).value;
          continue;
        }
        if (!Object.hasOwn(row, column)) invalid(`missing ${table} column`);
        result[column] = convert(row[column], descriptor);
      }
      if (byId[table].has(keyOf(table, result))) invalid(`duplicate ${table} identifier`);
      if (table === "ExtensionAccess") result.expiresAt = null;
      if (table === "User") {
        if (result.accountTier === "trial" && result.trialExpiresAt === null) invalid("trial account requires an expiry");
        if (result.authVersion >= 2147483647) invalid("account version overflow");
        result.authVersion++;
      }
      if (table === "Settings" && (result.id < 1 || result.id >= 2147483647 || result.bookingChaseDays < 1 || result.quietNudgeDays < 1 ||
        result.bookingDurationMins < 1 || result.bookingHorizonDays < 1)) invalid("invalid settings values");
      byId[table].set(keyOf(table, result), result);
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
  for (const model of ["role", "messageTemplate", "savedSearch", "settings", "extensionAccess", "person", "usageEvent", "suppression"]) {
    for (const row of data[model]) get("User", row.userId);
  }
  if (new Set(data.settings.map((row) => row.userId)).size !== data.settings.length) invalid("multiple settings rows for one account");
  if (new Set(data.briefing.map((row) => row.roleId)).size !== data.briefing.length) invalid("multiple briefings for one role");
  for (const row of [...data.briefing, ...data.candidate]) get("Role", row.roleId);
  for (const search of data.savedSearch) {
    if (search.roleId !== null && get("Role", search.roleId).userId !== search.userId) invalid("search belongs to a different account than its role");
  }
  for (const candidate of data.candidate) {
    if (candidate.personId !== null && get("Person", candidate.personId).userId !== get("Role", candidate.roleId).userId) invalid("candidate belongs to a different account than its person");
  }
  for (const note of data.personNote) {
    const person = get("Person", note.personId);
    if (note.candidateId !== null && get("Role", get("Candidate", note.candidateId).roleId).userId !== person.userId) invalid("note belongs to a different account than its candidate");
  }
  for (const screening of data.screening) get("Candidate", screening.candidateId);
  const heldSlots = new Set();
  for (const booking of data.booking) {
    if (get("Role", get("Candidate", booking.candidateId).roleId).userId !== booking.userId) invalid("booking belongs to a different account than its candidate");
    if (booking.status === "booked") {
      const slot = `${booking.userId}|${booking.startsAt.toISOString()}`;
      if (heldSlots.has(slot)) invalid("two bookings hold the same time");
      heldSlots.add(slot);
    }
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
    const supported = { ...accountColumns, ...ephemeralColumns, ...notImportedColumns };
    if (objects.some((entry) => ["trigger", "view"].includes(entry.type)) || tables.some((table) => table !== "_prisma_migrations" && !Object.hasOwn(supported, table))) invalid("unsupported tables, triggers or views");
    if (db.prepare("PRAGMA quick_check").all().some((row) => row.quick_check !== "ok") || db.prepare("PRAGMA foreign_key_check").all().length) invalid("SQLite integrity or foreign keys");
    const rows = {};
    for (const [table, columns] of Object.entries(supported)) {
      if (!tables.includes(table)) {
        if (!optionalTables.has(table)) invalid(`missing ${table} table`);
        if (Object.hasOwn(accountColumns, table)) rows[table] = [];
        continue;
      }
      const actual = db.prepare(`PRAGMA table_info("${table}")`).all();
      const absent = absentLate(table, (name) => actual.some((column) => column.name === name));
      if (actual.length !== Object.keys(columns).length - absent.size || actual.some((column) => !Object.hasOwn(columns, column.name))) invalid(`unsupported ${table} columns`);
      for (const column of actual) {
        const base = columns[column.name].replace("?", "");
        const type = base === "date" ? "DATETIME" : base === "int" ? "INTEGER" : base === "bool" ? "BOOLEAN" : "TEXT";
        if (column.type.toUpperCase() !== type || column.pk !== primaryFor(table).indexOf(column.name) + 1) invalid(`unsupported ${table} column type or primary key`);
      }
      if (!Object.hasOwn(accountColumns, table)) continue;
      const selected = Object.keys(columns).map((column) => {
        if (absent.has(column)) return `${lateDefault(table, column).sql} AS "${column}"`;
        return columns[column] === "discard" || (table === "ExtensionAccess" && column === "expiresAt") ? `NULL AS "${column}"` : `"${column}"`;
      });
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

const canonical = (rows, columns, table) => JSON.stringify([...rows].sort((a, b) => keyOf(table, a).localeCompare(keyOf(table, b))).map((row) => columns.map((column) => row[column])));

function assertSameSnapshot(expected, actual) {
  for (const [table, columns] of Object.entries(accountColumns)) {
    const model = modelFor(table);
    if (canonical(expected.data[model], Object.keys(columns), table) !== canonical(actual.data[model], Object.keys(columns), table)) {
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
    if (canonical(actual, Object.keys(columns), table) !== canonical(expected, Object.keys(columns), table)) throw new SafeError(`Imported ${model} content or ownership does not match the snapshot.`);
  }
  for (const table of [...Object.keys(ephemeralColumns), "CalendarConnection", "IntegrationConnection", "AiUsage"]) {
    if (await db[modelFor(table)].count()) throw new SafeError("Unexpected session, activation, throttle, calendar or usage-counter state in target.");
  }
  const expectedSlots = validated.data.booking.filter((booking) => booking.status === "booked").map((booking) => `${booking.userId}|${booking.startsAt.toISOString()}|${booking.id}`).sort();
  const actualSlots = (await db.bookedSlot.findMany()).map((slot) => `${slot.userId}|${slot.startsAt.toISOString()}|${slot.bookingId}`).sort();
  if (JSON.stringify(expectedSlots) !== JSON.stringify(actualSlots)) throw new SafeError("Booked-slot verification failed.");
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
    for (const booking of validated.data.booking) {
      if (booking.status === "booked") await tx.bookedSlot.create({ data: { userId: booking.userId, startsAt: booking.startsAt, bookingId: booking.id } });
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
