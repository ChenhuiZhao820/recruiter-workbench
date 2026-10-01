import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { parseArgs, SafeError } from "./bootstrap-admin.mjs";
import { buildSearchText, canonicalProfileUrl, cleanMemberId } from "../lib/person-keys.mjs";

// Links candidates saved before people existed to a person each. The same
// rules as the app: member id first, then the canonical profile link, never
// the name. Additive and repeatable: candidates that already have a person
// are left alone, and running it twice links nothing the second time.
// Prints counts only, never names or links.

// Pure planning step, so it can be tested without a database.
// candidates: [{ id, ownerId, fullName, profileUrl, memberId, headline }] in creation order
// people: existing [{ id, ownerId, profileUrl, memberId }]
export function planBackfill(candidates, people) {
  const byMember = new Map();
  const byUrl = new Map();
  const remember = (person) => {
    if (person.memberId) byMember.set(`${person.ownerId}|${person.memberId}`, person);
    if (person.profileUrl) byUrl.set(`${person.ownerId}|${person.profileUrl}`, person);
  };
  people.forEach(remember);

  const creates = [];
  const links = [];
  for (const candidate of candidates) {
    const memberId = cleanMemberId(candidate.memberId);
    const profileUrl = canonicalProfileUrl(candidate.profileUrl);
    let person =
      (memberId && byMember.get(`${candidate.ownerId}|${memberId}`)) ||
      (profileUrl && byUrl.get(`${candidate.ownerId}|${profileUrl}`)) ||
      null;
    if (!person) {
      person = {
        key: `new-${creates.length}`,
        ownerId: candidate.ownerId,
        fullName: candidate.fullName.trim(),
        headline: candidate.headline?.trim() || null,
        memberId,
        profileUrl,
      };
      creates.push(person);
      if (memberId || profileUrl) remember(person);
    } else {
      // Fill an identifier the person does not have yet, as the app does.
      if (!person.memberId && memberId && !byMember.has(`${candidate.ownerId}|${memberId}`)) {
        person.memberId = memberId;
        byMember.set(`${candidate.ownerId}|${memberId}`, person);
      }
      if (!person.profileUrl && profileUrl && !byUrl.has(`${candidate.ownerId}|${profileUrl}`)) {
        person.profileUrl = profileUrl;
        byUrl.set(`${candidate.ownerId}|${profileUrl}`, person);
      }
    }
    links.push({ candidateId: candidate.id, person });
  }
  return { creates, links };
}

async function loadState(db) {
  const rows = await db.candidate.findMany({
    where: { personId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, fullName: true, profileUrl: true, memberId: true, headline: true, role: { select: { userId: true } } },
  });
  const candidates = rows.map((row) => ({ ...row, ownerId: row.role.userId }));
  const owners = [...new Set(candidates.map((candidate) => candidate.ownerId))];
  const people = (await db.person.findMany({
    where: { userId: { in: owners } },
    select: { id: true, userId: true, profileUrl: true, memberId: true },
  })).map((person) => ({ ...person, ownerId: person.userId }));
  return { candidates, people };
}

async function applyPlan(db, plan) {
  // One transaction for the whole run: either every candidate is linked or
  // none is.
  return db.$transaction(async (tx) => {
    const ids = new Map();
    for (const person of plan.creates) {
      const created = await tx.person.create({
        data: {
          userId: person.ownerId,
          fullName: person.fullName,
          headline: person.headline,
          memberId: person.memberId,
          profileUrl: person.profileUrl,
          searchText: buildSearchText([person.fullName, person.headline]),
        },
        select: { id: true },
      });
      ids.set(person.key, created.id);
    }
    for (const person of new Set(plan.links.map((link) => link.person))) {
      // Existing people may have gained an identifier from a candidate.
      if (person.id) await tx.person.update({ where: { id: person.id }, data: { memberId: person.memberId ?? undefined, profileUrl: person.profileUrl ?? undefined } });
    }
    for (const link of plan.links) {
      const personId = link.person.id ?? ids.get(link.person.key);
      const updated = await tx.candidate.updateMany({ where: { id: link.candidateId, personId: null }, data: { personId } });
      if (updated.count !== 1) throw new SafeError("A candidate changed while backfilling. Nothing was written; run it again.");
    }
    return { peopleCreated: plan.creates.length, candidatesLinked: plan.links.length };
  }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 120000 });
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["--dry-run", "--apply"], ["--dry-run", "--apply"]);
  if (Boolean(args["--dry-run"]) === Boolean(args["--apply"])) throw new SafeError("Usage: node scripts/backfill-people.mjs --dry-run | --apply  (set DATABASE_URL explicitly)");
  if (!process.env.DATABASE_URL) throw new SafeError("Set DATABASE_URL explicitly; this script does not read .env.");
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: [] });
  try {
    const plan = planBackfill(...Object.values(await loadState(db)));
    const preview = { candidatesWithoutPerson: plan.links.length, peopleToCreate: plan.creates.length, linkedToExisting: plan.links.length - plan.links.filter((link) => !link.person.id).length };
    console.log(JSON.stringify(preview));
    if (args["--dry-run"]) return;
    if (plan.links.length === 0) return;
    if (!process.stdin.isTTY || !process.stderr.isTTY) throw new SafeError("--apply requires an interactive terminal; nothing was written.");
    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    let answer;
    try { answer = await prompt.question("Link these candidates to people? Type LINK PEOPLE to apply: "); }
    finally { prompt.close(); }
    if (answer !== "LINK PEOPLE") throw new SafeError("Cancelled; nothing was written.");
    console.log(JSON.stringify(await applyPlan(db, plan)));
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof SafeError ? error.message : "Backfill failed. Nothing was committed.");
    process.exitCode = 1;
  });
}
