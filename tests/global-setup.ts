import { execSync } from "node:child_process";
import { closeSync, lstatSync, openSync, rmSync } from "node:fs";
import path from "node:path";
import { db, TEST_ADMIN_ID, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, TEST_DATABASE_URL } from "./helpers";
import { hashPassword, hashToken } from "../lib/auth-crypto";

// Fresh, empty test database for every run.
export default async function globalSetup() {
  const token = process.env.BASANITE_TEST_SESSION_TOKEN;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Missing test session token from Playwright configuration.");
  const dbFile = path.join(__dirname, "..", "prisma", TEST_DATABASE_URL.slice("file:./".length));
  const ownedFiles = [dbFile, `${dbFile}-journal`, `${dbFile}-wal`, `${dbFile}-shm`];
  for (const file of ownedFiles) {
    if (lstatSync(file, { throwIfNoEntry: false })) throw new Error(`Refusing to overwrite an existing test database file: ${file}`);
  }
  closeSync(openSync(dbFile, "wx"));
  const identity = lstatSync(dbFile);
  const teardown = async () => {
    await db.$disconnect();
    const current = lstatSync(dbFile, { throwIfNoEntry: false });
    if (!current) return;
    if (!current.isFile() || current.ino !== identity.ino || current.dev !== identity.dev || current.birthtimeMs !== identity.birthtimeMs) {
      throw new Error(`Refusing to remove a replaced test database: ${dbFile}`);
    }
    for (const file of ownedFiles) {
      const stat = lstatSync(file, { throwIfNoEntry: false });
      if (stat) {
        if (!stat.isFile()) throw new Error(`Refusing to remove an unexpected test database file: ${file}`);
        try {
          rmSync(file);
        } catch (error) {
          if (file === dbFile && (error as NodeJS.ErrnoException).code === "EBUSY") {
            console.warn(`Test database retained because the test server still has it open: ${dbFile}`);
            return;
          }
          throw error;
        }
      }
    }
  };
  try {
    execSync("npx prisma db push --skip-generate", {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, BASANITE_TEST_DATABASE_URL: TEST_DATABASE_URL },
      stdio: "inherit",
    });
    const passwordHash = await hashPassword(TEST_ADMIN_PASSWORD);
    await db.user.create({
      data: {
        id: TEST_ADMIN_ID,
        email: TEST_ADMIN_EMAIL,
        name: "Test Admin",
        role: "admin",
        active: true,
        passwordHash,
        settings: { create: {} },
        sessions: { create: { tokenHash: hashToken(token), authVersion: 0, expiresAt: new Date(Date.now() + 86_400_000) } },
      },
    });
    await db.$disconnect();
    return teardown;
  } catch (error) {
    await teardown();
    throw error;
  }
}
