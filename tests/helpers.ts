import { appendFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL = "file:./test.db";

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
  const candidate = await db.candidate.findFirst({ where: { fullName } });
  if (!candidate) throw new Error(`No candidate named ${fullName}`);
  await db.candidate.update({ where: { id: candidate.id }, data: fields });
}
