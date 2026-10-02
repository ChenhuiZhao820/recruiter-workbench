import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { parseArgs, SafeError } from "./bootstrap-admin.mjs";

// Removes every screening transcript past its retention date, across all
// accounts. The app already does this per account at sign-in and on each
// screening action, and hides an expired transcript in the meantime; this is
// for an operator who wants it done now. Confirmed facts and summaries stay.
// Prints counts only.

async function main() {
  const args = parseArgs(process.argv.slice(2), ["--dry-run", "--apply"], ["--dry-run", "--apply"]);
  if (Boolean(args["--dry-run"]) === Boolean(args["--apply"])) throw new SafeError("Usage: node scripts/purge-transcripts.mjs --dry-run | --apply  (set DATABASE_URL explicitly)");
  if (!process.env.DATABASE_URL) throw new SafeError("Set DATABASE_URL explicitly; this script does not read .env.");
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: [] });
  try {
    const now = new Date();
    const where = { transcript: { not: null }, transcriptDeleteAfter: { lte: now } };
    const expired = await db.screening.count({ where });
    console.log(JSON.stringify({ expiredTranscripts: expired }));
    if (args["--dry-run"] || expired === 0) return;
    if (!process.stdin.isTTY || !process.stderr.isTTY) throw new SafeError("--apply requires an interactive terminal; nothing was deleted.");
    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    let answer;
    try { answer = await prompt.question("Delete these expired transcripts? Type PURGE TRANSCRIPTS to apply: "); }
    finally { prompt.close(); }
    if (answer !== "PURGE TRANSCRIPTS") throw new SafeError("Cancelled; nothing was deleted.");
    const { count } = await db.screening.updateMany({ where, data: { transcript: null } });
    console.log(JSON.stringify({ transcriptsDeleted: count }));
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof SafeError ? error.message : "Purge failed. Nothing further was deleted.");
    process.exitCode = 1;
  });
}
