import { createHash, randomBytes } from "node:crypto";
import { open, realpath, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class SafeError extends Error {}

export const businessModels = ["role", "briefing", "savedSearch", "candidate", "messageTemplate", "outreachLog", "settings"];

export function parseArgs(args, allowed, flags = []) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!allowed.includes(key) || Object.hasOwn(result, key)) throw new SafeError("Unknown or repeated argument.");
    if (flags.includes(key)) result[key] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new SafeError("Argument requires a value.");
      result[key] = value;
    }
  }
  return result;
}

export function normalizeEmail(value) {
  if (typeof value !== "string") throw new SafeError("An email is required.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SafeError("A valid email is required.");
  return email;
}

export function validateOrigin(value, production = process.env.NODE_ENV === "production") {
  let url;
  try { url = new URL(value); } catch { throw new SafeError("A valid origin is required."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !(url.protocol === "https:" || (url.protocol === "http:" && local && !production))) {
    throw new SafeError("Origin must be HTTPS, or HTTP loopback in development, with no path or credentials.");
  }
  return url.origin;
}

export function targetProvider(url) {
  if (typeof url !== "string" || !url) throw new SafeError("Set DATABASE_URL explicitly.");
  if (url.startsWith("file:")) return "sqlite";
  try {
    const parsed = new URL(url);
    if (["postgres:", "postgresql:"].includes(parsed.protocol) && parsed.hostname && parsed.pathname.length > 1) return "postgresql";
  } catch {}
  throw new SafeError("DATABASE_URL must identify an initialized SQLite or PostgreSQL database.");
}

export async function sqliteTargetPath(databaseUrl, schemaDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../prisma")) {
  try {
    if (!databaseUrl.startsWith("file:") || /[?#]/.test(databaseUrl) || /:memory:/i.test(databaseUrl)) throw new Error();
    const raw = databaseUrl.slice(5);
    let path = raw.startsWith("//") ? fileURLToPath(databaseUrl) : decodeURIComponent(raw);
    if (!path) throw new Error();
    path = await realpath(isAbsolute(path) ? path : resolve(schemaDirectory, path));
    if (!(await stat(path)).isFile()) throw new Error();
    return path;
  } catch { throw new SafeError("Target SQLite must be an existing initialized file with an unambiguous file URL."); }
}

export async function lockTarget(tx, provider) {
  if (provider === "postgresql") {
    await tx.$executeRawUnsafe('LOCK TABLE "User", "Session", "ActivationToken", "LoginThrottle", "AuditEvent", "Role", "Briefing", "SavedSearch", "Candidate", "MessageTemplate", "OutreachLog", "Settings" IN EXCLUSIVE MODE');
  }
}

export async function requireEmptyBusiness(tx) {
  for (const model of businessModels) {
    if (await tx[model].count()) throw new SafeError("Target business tables must be empty; no merge or overwrite is supported.");
  }
}

export async function bootstrapAdmin(db, { email, name = "Admin", origin, output, provider = "sqlite", now = new Date(), openFile = open }) {
  email = normalizeEmail(email);
  origin = validateOrigin(origin);
  if (!output || typeof output !== "string") throw new SafeError("An explicitly named new activation file is required.");
  if (typeof name !== "string" || !name.trim() || name.length > 200) throw new SafeError("A valid admin name is required.");
  const path = resolve(output);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  let handle;
  let ownsFile = false;
  try {
    handle = await openFile(path, "wx", 0o600);
    ownsFile = true;
    await db.$transaction(async (tx) => {
      await lockTarget(tx, provider);
      if (await tx.user.count()) throw new SafeError("Bootstrap refused: a user already exists.");
      await requireEmptyBusiness(tx);
      for (const model of ["session", "activationToken", "loginThrottle", "auditEvent"]) {
        if (await tx[model].count()) throw new SafeError("Bootstrap requires an empty initialized database.");
      }
      const admin = await tx.user.create({ data: { email, name: name.trim(), role: "admin", active: true, passwordHash: null } });
      await tx.activationToken.create({ data: { userId: admin.id, tokenHash, expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) } });
      await tx.auditEvent.create({ data: { actorId: admin.id, targetUserId: admin.id, action: "admin.bootstrap" } });
      await handle.writeFile(`${origin}/activate#token=${token}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
    }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 });
    return path;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (ownsFile) await unlink(path).catch(() => {});
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["--email", "--name", "--origin", "--output"]);
  normalizeEmail(args["--email"]);
  validateOrigin(args["--origin"]);
  if (!args["--output"]) throw new SafeError("Usage: node scripts/bootstrap-admin.mjs --email EMAIL --origin ORIGIN --output NEW_FILE [--name NAME]");
  const provider = targetProvider(process.env.DATABASE_URL);
  const datasourceUrl = provider === "sqlite" ? `file:${await sqliteTargetPath(process.env.DATABASE_URL)}` : process.env.DATABASE_URL;
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ log: [], datasourceUrl });
  try {
    console.log(await bootstrapAdmin(db, { email: args["--email"], name: args["--name"], origin: args["--origin"], output: args["--output"], provider }));
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof SafeError ? error.message : "Bootstrap failed; no activation link is printed. Check initialization, client provider, and private output-file permissions.");
    process.exitCode = 1;
  });
}
