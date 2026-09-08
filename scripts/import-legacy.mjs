import { realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { SafeError, businessModels, lockTarget, normalizeEmail, parseArgs, requireEmptyBusiness, sqliteTargetPath, targetProvider } from "./bootstrap-admin.mjs";

export const legacyColumns = {
  Role: { id: "id", title: "text", client: "text?", jobDesc: "text?", status: "text", createdAt: "date", updatedAt: "date" },
  Briefing: { id: "id", roleId: "id", dayToDay: "text", keySkills: "text", searchTitles: "text", targetCompanies: "text", salaryRange: "text", firstCallQuestions: "text", createdAt: "date" },
  SavedSearch: { id: "id", name: "text", roleId: "id?", groupLabel: "text?", titles: "text", keywords: "text", industries: "text", locations: "text", filterNotes: "text?", lastUsedAt: "date?", createdAt: "date", updatedAt: "date" },
  Candidate: { id: "id", roleId: "id", fullName: "text", profileUrl: "text?", headline: "text?", notes: "text?", stage: "text", lastActivityAt: "date", lastNudgeAt: "date?", nudgeCount: "int", createdAt: "date", updatedAt: "date" },
  MessageTemplate: { id: "id", name: "text", body: "text", kind: "kind", createdAt: "date", updatedAt: "date" },
  OutreachLog: { id: "id", candidateId: "id", templateId: "id?", renderedBody: "text", kind: "kind", sentAt: "date" },
  Settings: { id: "int", recruiterName: "text", calendarLink: "text", bookingChaseDays: "int", quietNudgeDays: "int", captureToken: "text" },
};

const optionalColumn = (table, column) => column === "kind" || (table === "Settings" && column === "captureToken");
const modelFor = (table) => table[0].toLowerCase() + table.slice(1);
const invalid = () => { throw new SafeError("Legacy source has an unsupported schema, invalid values, or broken relationships."); };

export function legacyDate(value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) invalid();
  } else if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
    if (!match) invalid();
    const [, year, month, day, hour, minute, second] = match;
    if (+month < 1 || +month > 12 || +day < 1 || +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate() || +hour > 23 || +minute > 59 || +second > 59) invalid();
    value = value.replace(" ", "T") + (match[8] ? "" : "Z");
  } else invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) invalid();
  return date;
}

function convert(value, descriptor) {
  if (value === null && descriptor.endsWith("?")) return null;
  const type = descriptor.replace("?", "");
  if (type === "date") return legacyDate(value);
  if (type === "int") {
    if (!Number.isInteger(value) || value < 0 || value > 2147483647) invalid();
  } else {
    if (typeof value !== "string" || value.includes("\0") || (type === "id" && !value.trim())) invalid();
    if (type === "kind" && !["message", "connection_note"].includes(value)) invalid();
  }
  return value;
}

export function validateAndTransformLegacy(source, adminId) {
  if (typeof adminId !== "string" || !adminId.trim()) throw new SafeError("An existing admin ID is required.");
  if (!source || Object.keys(source).some((table) => !Object.hasOwn(legacyColumns, table))) invalid();
  const result = {};
  const ids = {};
  for (const [table, columns] of Object.entries(legacyColumns)) {
    if (!Array.isArray(source[table])) invalid();
    ids[table] = new Set();
    result[modelFor(table)] = source[table].map((row) => {
      if (!row || typeof row !== "object" || Object.keys(row).some((column) => !Object.hasOwn(columns, column))) invalid();
      const data = {};
      for (const [column, descriptor] of Object.entries(columns)) {
        let value = row[column];
        if (!Object.hasOwn(row, column)) {
          if (!optionalColumn(table, column)) invalid();
          value = column === "kind" ? "message" : "";
        }
        const converted = convert(value, descriptor);
        if (column !== "captureToken") data[column] = converted;
      }
      if (ids[table].has(data.id)) invalid();
      ids[table].add(data.id);
      if (["Role", "SavedSearch", "MessageTemplate", "Settings"].includes(table)) data.userId = adminId;
      if (table === "Settings") {
        if (data.id < 1 || data.id >= 2147483647) invalid();
        data.captureTokenHash = null;
      }
      return data;
    });
  }
  if (result.settings.length > 1) invalid();
  const reference = (rows, field, table, nullable = false) => {
    for (const row of rows) {
      if (nullable && row[field] === null) continue;
      if (!ids[table].has(row[field])) invalid();
    }
  };
  reference(result.briefing, "roleId", "Role");
  if (new Set(result.briefing.map((row) => row.roleId)).size !== result.briefing.length) invalid();
  reference(result.candidate, "roleId", "Role");
  reference(result.savedSearch, "roleId", "Role", true);
  reference(result.outreachLog, "candidateId", "Candidate");
  reference(result.outreachLog, "templateId", "MessageTemplate", true);
  return result;
}

export async function assertDifferentSource(sourcePath, databaseUrl, sqliteSchemaDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../prisma")) {
  if (!sourcePath || typeof sourcePath !== "string") throw new SafeError("An explicit legacy SQLite source path is required.");
  const source = await realpath(resolve(sourcePath));
  const sourceInfo = await stat(source);
  if (!sourceInfo.isFile()) throw new SafeError("The source must be an existing SQLite file.");
  if (targetProvider(databaseUrl) === "sqlite") {
    const targetPath = await sqliteTargetPath(databaseUrl, sqliteSchemaDirectory);
    const targetInfo = await stat(targetPath);
    const samePath = process.platform === "win32" ? source.toLowerCase() === targetPath.toLowerCase() : source === targetPath;
    if (samePath || (sourceInfo.ino !== 0 && sourceInfo.dev === targetInfo.dev && sourceInfo.ino === targetInfo.ino)) {
      throw new SafeError("Source and target SQLite files must be different, including links and aliases.");
    }
  }
  return source;
}

export async function readLegacy(sourcePath) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(sourcePath, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    db.exec("PRAGMA query_only = ON; BEGIN");
    const objects = db.prepare("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
    const tables = objects.filter((entry) => entry.type === "table").map((entry) => entry.name);
    if (objects.some((entry) => ["view", "trigger"].includes(entry.type)) || tables.some((table) => table !== "_prisma_migrations" && !Object.hasOwn(legacyColumns, table))) invalid();
    if (db.prepare("PRAGMA quick_check").all().some((row) => row.quick_check !== "ok") || db.prepare("PRAGMA foreign_key_check").all().length) invalid();
    const rows = {};
    for (const [table, columns] of Object.entries(legacyColumns)) {
      if (!tables.includes(table)) invalid();
      const actual = db.prepare(`PRAGMA table_info("${table}")`).all();
      if (actual.some((column) => !Object.hasOwn(columns, column.name)) || Object.keys(columns).some((column) => !optionalColumn(table, column) && !actual.some((entry) => entry.name === column))) invalid();
      for (const column of actual) {
        const descriptor = columns[column.name];
        const expectedType = descriptor.startsWith("date") ? "DATETIME" : descriptor === "int" ? "INTEGER" : "TEXT";
        if (column.type.toUpperCase() !== expectedType || column.pk !== (column.name === "id" ? 1 : 0)) invalid();
      }
      const selected = actual.map((column) => column.name).filter((column) => column !== "captureToken");
      rows[table] = db.prepare(`SELECT ${selected.map((column) => `"${column}"`).join(", ")} FROM "${table}"`).all();
    }
    db.exec("COMMIT");
    return rows;
  } finally { db.close(); }
}

export async function requireAdmin(tx, selector) {
  const admin = await tx.user.findUnique({ where: selector });
  if (!admin || !admin.active || admin.role !== "admin") throw new SafeError("Target user must be an existing active admin.");
  return admin;
}

export async function inspectTarget(db, selector) {
  return db.$transaction(async (tx) => {
    const admin = await requireAdmin(tx, selector);
    await requireEmptyBusiness(tx);
    return admin.id;
  }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 });
}

export async function applyLegacy(db, source, selector, { provider = "sqlite", confirmed = false } = {}) {
  if (!confirmed) throw new SafeError("Import requires explicit execution-time confirmation.");
  return db.$transaction(async (tx) => {
    await lockTarget(tx, provider);
    const admin = await requireAdmin(tx, selector);
    await requireEmptyBusiness(tx);
    const data = validateAndTransformLegacy(source, admin.id);
    for (const model of ["role", "messageTemplate", "briefing", "savedSearch", "candidate", "outreachLog", "settings"]) {
      for (const row of data[model]) await tx[model].create({ data: row });
    }
    if (provider === "postgresql" && data.settings.length) {
      await tx.$executeRawUnsafe(`ALTER SEQUENCE "Settings_id_seq" RESTART WITH ${data.settings[0].id + 1}`);
    }
    await tx.auditEvent.create({ data: { actorId: admin.id, targetUserId: admin.id, action: "legacy.import" } });
    return Object.fromEntries(businessModels.map((model) => [model, data[model].length]));
  }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 120000 });
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["--source", "--admin-id", "--admin-email", "--apply", "--dry-run"], ["--apply", "--dry-run"]);
  if (!args["--source"] || Boolean(args["--admin-id"]) === Boolean(args["--admin-email"]) || (args["--apply"] && args["--dry-run"])) {
    throw new SafeError("Usage: node scripts/import-legacy.mjs --source SQLITE_FILE (--admin-id ID | --admin-email EMAIL) [--dry-run | --apply]");
  }
  const selector = args["--admin-id"] ? { id: args["--admin-id"] } : { email: normalizeEmail(args["--admin-email"]) };
  const provider = targetProvider(process.env.DATABASE_URL);
  const path = await assertDifferentSource(args["--source"], process.env.DATABASE_URL);
  const source = await readLegacy(path);
  validateAndTransformLegacy(source, "validation-only");
  const datasourceUrl = provider === "sqlite" ? `file:${await sqliteTargetPath(process.env.DATABASE_URL)}` : process.env.DATABASE_URL;
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ log: [], datasourceUrl });
  try {
    const adminId = await inspectTarget(db, selector);
    const data = validateAndTransformLegacy(source, adminId);
    console.log(JSON.stringify(Object.fromEntries(businessModels.map((model) => [model, data[model].length]))));
    if (!args["--apply"]) return;
    if (!process.stdin.isTTY || !process.stderr.isTTY) throw new SafeError("--apply requires an interactive terminal; run again interactively to confirm.");
    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    let answer;
    try { answer = await prompt.question("Import all validated legacy data into the selected admin workspace? Type IMPORT to apply: "); }
    finally { prompt.close(); }
    if (answer !== "IMPORT") throw new SafeError("Import cancelled; no target data was changed.");
    await applyLegacy(db, source, { id: adminId }, { provider, confirmed: true });
    console.log("Import committed. Legacy capture keys were invalidated.");
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof SafeError ? error.message : "Import failed. No source writes were requested. Check initialization and client provider; inspect target audit state before retrying an interrupted apply.");
    process.exitCode = 1;
  });
}
