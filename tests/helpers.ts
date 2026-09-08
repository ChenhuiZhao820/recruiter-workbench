import { appendFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

export const TEST_ADMIN_ID = "test-only-admin";
export const TEST_ADMIN_EMAIL = "admin@test.capture.invalid";
export const TEST_ADMIN_PASSWORD = "TEST-ONLY-admin-password-3100!";
export const TEST_DATABASE_URL = process.env.CAPTURE_TEST_DATABASE_URL ?? `file:./test-${randomUUID()}.db`;
if (!/^file:\.\/test-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.db$/.test(TEST_DATABASE_URL)) {
  throw new Error("Unsafe test database URL: expected a unique test-<uuid>.db.");
}
process.env.CAPTURE_TEST_DATABASE_URL = TEST_DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;

// One shared client for direct DB access (backdating timestamps, inspecting
// state the UI does not show).
export const db = new PrismaClient();

export const FINDINGS_FILE = path.join(__dirname, "findings.log");

// Suboptimal-behavior journal. Tests call note() when they observe something
// that works-but-shouldn't or is worse than the walkthrough implies. Notes do
// not fail the suite; hard bugs still fail their assertions.
export function note(id: string, text: string) {
  const line = `[${id}] ${text}`;
  appendFileSync(FINDINGS_FILE, line + "\n");
  console.log("FINDING " + line);
}

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function backdateCandidate(fullName: string, fields: { lastActivityAt?: Date; lastNudgeAt?: Date }) {
  const candidate = await db.candidate.findFirst({ where: { fullName, role: { userId: TEST_ADMIN_ID } } });
  if (!candidate) throw new Error(`No candidate named ${fullName}`);
  await db.candidate.update({ where: { id: candidate.id }, data: fields });
}
