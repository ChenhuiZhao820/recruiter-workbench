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
  if (fields.lastActivityAt) await backdateMessages(candidate.id, fields.lastActivityAt);
}

// Days passing in a test move the messages already logged too: the same text
// logged again on the same day is one message, so a nudge "three days later"
// needs the first message to be three days old.
export async function backdateMessages(candidateId: string, to: Date) {
  await db.outreachLog.updateMany({ where: { candidateId, sentAt: { gt: to } }, data: { sentAt: to } });
}

// Adding a candidate is a button until it is wanted, so a test that fills the
// fields has to ask for them first. Safe to call when it is already open.
export async function openAddCandidate(page: { locator: (selector: string) => any }) {
  // The button above the list opens the fields under the toolbar.
  const fields = page.locator("#new-fullName");
  if ((await fields.count()) && !(await fields.isVisible())) await page.locator('button[aria-controls]:has-text("Add a candidate")').click();
}

// Putting forward someone without a CV asks first; specs about something else
// answer "Skip for now". When no question opens (everyone has a CV, or the
// form stopped at a required tick), this does nothing.
export async function skipNoCv(page: import("@playwright/test").Page) {
  const skip = page.getByRole("dialog").getByRole("button", { name: "Skip for now" });
  try {
    await skip.waitFor({ state: "visible", timeout: 2000 });
  } catch {
    return;
  }
  await skip.click();
}
