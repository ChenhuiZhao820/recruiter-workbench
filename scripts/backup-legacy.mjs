import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { legacyColumns, legacyDate, readLegacy, validateAndTransformLegacy } from "./import-legacy.mjs";
import { normalizeEmail, parseArgs, SafeError } from "./bootstrap-admin.mjs";

export async function fingerprint(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function preflight(source, target) {
  source = await realpath(source);
  if (!(await lstat(source)).isFile()) throw new SafeError("Source must be an existing database file.");
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    try {
      await lstat(`${target}${suffix}`);
      throw new SafeError("Target database or sidecar already exists. Nothing will be overwritten.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const data = validateAndTransformLegacy(await readLegacy(source), "preflight-only");
  return Object.fromEntries(Object.entries(data).map(([model, rows]) => [model, rows.length]));
}

export async function backupLegacy(source, output) {
  source = await realpath(source);
  const before = await fingerprint(source);
  const file = await open(output, "wx", 0o600);
  await file.close();
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.prepare("VACUUM INTO ?").run(output);
  } finally {
    db.close();
  }
  if (await fingerprint(source) !== before) throw new SafeError("Source changed during backup. Stop and review before importing anything.");
  const snapshot = await readLegacy(output);
  const original = await readLegacy(source);
  const expected = validateAndTransformLegacy(original, "verification-only");
  const actual = validateAndTransformLegacy(snapshot, "verification-only");
  const canonical = (value) => JSON.stringify(Object.fromEntries(Object.entries(value).map(([model, rows]) => [model, [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))])));
  if (canonical(expected) !== canonical(actual)) throw new SafeError("Backup content differs from source. Nothing may be imported.");
  return { sourceSha256: before, backupSha256: await fingerprint(output), counts: Object.fromEntries(Object.entries(actual).map(([model, rows]) => [model, rows.length])) };
}

export async function verifyImported(reportPath, email) {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if (await fingerprint(report.source) !== report.sourceSha256 || await fingerprint(report.backup) !== report.backupSha256) {
    throw new SafeError("Source or backup checksum changed. Review before switching the application.");
  }
  const target = new DatabaseSync(report.target, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    target.exec("PRAGMA query_only = ON; BEGIN");
    if (target.prepare("PRAGMA quick_check").all().some((row) => row.quick_check !== "ok") || target.prepare("PRAGMA foreign_key_check").all().length) {
      throw new SafeError("Target integrity check failed.");
    }
    const admin = target.prepare('SELECT id, email, name, role, active, passwordHash IS NOT NULL AS passwordSet FROM "User" WHERE email = ?').get(normalizeEmail(email));
    if (!admin || admin.role !== "admin" || !admin.active || target.prepare('SELECT COUNT(*) AS n FROM "User"').get().n !== 1) {
      throw new SafeError("Expected only the initialized active Admin account.");
    }
    const expected = validateAndTransformLegacy(await readLegacy(report.backup), admin.id);
    const counts = {};
    for (const [table, descriptors] of Object.entries(legacyColumns)) {
      const model = table[0].toLowerCase() + table.slice(1);
      const columns = Object.keys(descriptors).filter((column) => column !== "captureToken");
      if (["Role", "SavedSearch", "MessageTemplate", "Settings"].includes(table)) columns.push("userId");
      if (table === "Settings") columns.push("captureTokenHash");
      const rows = target.prepare(`SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM "${table}"`).all().map((row) => {
        for (const [column, descriptor] of Object.entries(descriptors)) {
          if (descriptor.startsWith("date") && row[column] !== null) row[column] = legacyDate(row[column]);
        }
        return row;
      });
      const canonical = (data) => JSON.stringify([...data].sort((a, b) => String(a.id).localeCompare(String(b.id))).map((row) => columns.map((column) => row[column])));
      if (rows.length !== report.counts[model] || canonical(rows) !== canonical(expected[model])) {
        throw new SafeError(`Imported ${model} records differ from the verified backup.`);
      }
      counts[model] = rows.length;
    }
    for (const action of ["admin.bootstrap", "legacy.import"]) {
      if (target.prepare('SELECT COUNT(*) AS n FROM "AuditEvent" WHERE actorId = ? AND targetUserId = ? AND action = ?').get(admin.id, admin.id, action).n !== 1) {
        throw new SafeError("Expected bootstrap and import audit records were not found.");
      }
    }
    const activation = target.prepare('SELECT expiresAt FROM "ActivationToken" WHERE userId = ?').get(admin.id);
    target.exec("COMMIT");
    return { verified: true, email: admin.email, name: admin.name, passwordSet: Boolean(admin.passwordSet), activationUsable: Boolean(activation && legacyDate(activation.expiresAt) > new Date()), counts, sourceUnchanged: true };
  } finally {
    target.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["--source", "--target", "--directory", "--check", "--verify", "--admin-email"], ["--check"]);
  if (args["--verify"]) {
    console.log(JSON.stringify(await verifyImported(args["--verify"], args["--admin-email"])));
    return;
  }
  if (!args["--source"] || !args["--target"] || (!args["--check"] && !args["--directory"])) throw new SafeError("Specify --source, --target and either --check or --directory.");
  const source = resolve(args["--source"]);
  const target = resolve(args["--target"]);
  const counts = await preflight(source, target);
  if (args["--check"]) {
    console.log(JSON.stringify({ source, target, counts }));
    return;
  }
  const directory = resolve(args["--directory"]);
  await realpath(dirname(directory));
  try {
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new SafeError("Backup directory must be a real directory.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(directory, { mode: 0o700 });
  }
  const runDirectory = await mkdtemp(join(directory, "migration-"));
  const backup = join(runDirectory, "legacy.db");
  const report = await backupLegacy(source, backup);
  const record = { source, target, backup, activationFile: join(runDirectory, "admin-setup.txt"), ...report };
  const file = await open(join(runDirectory, "verification.json"), "wx", 0o600);
  try { await file.writeFile(JSON.stringify(record, null, 2) + "\n"); } finally { await file.close(); }
  console.log(JSON.stringify(record));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof SafeError ? error.message : "Backup failed. Source is opened read-only; do not proceed with initialization or import.");
    process.exitCode = 1;
  });
}
