import { createHash, randomBytes } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeEmail, parseArgs, SafeError, sqliteTargetPath, targetProvider, validateOrigin } from "./bootstrap-admin.mjs";

// A demo workspace for walking partners and Paul through every screen with no
// real data: three fictional roles and fifteen fictional candidates, one or two
// in each state, dated from the day it runs so "today" and "this week" stay
// true. It creates one Pro account with no password and writes a one-time
// sign-in link to a new private file, never to the console.
//
// Local SQLite only (a fresh database from `npm run db:init:local`, or a copy):
// demo people must never sit beside real ones on the hosted service.
//
//   DATABASE_URL=file:/abs/path/demo.db node scripts/seed-demo.mjs \
//     --origin http://localhost:3000 --output <NEW_PRIVATE_FILE> [--email demo@capture.invalid]

const DAY = 86_400_000;
const DEFAULT_EMAIL = "demo@capture.invalid";

const at = (now, days, hour = 10, minute = 0) => {
  const date = new Date(now.getTime() + days * DAY);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
};

const fact = (value, extra = {}) => ({ value, not_discussed: false, confirmed: true, ...extra });

function summary({ salary, notice, location, rightToWork, skills, motivation, quoteMissing = [] }) {
  const fields = {
    salary: fact({ min: salary[0], max: salary[1], currency: "GBP", note: null }),
    notice: fact({ weeks: notice, available_from: null, note: null }),
    location: fact({ location: location[0], remote: location[1], note: null }),
    right_to_work: fact({ status: rightToWork, note: null }),
  };
  const ai = Object.fromEntries(Object.entries(fields).map(([key, entry]) => [key, {
    value: entry.value,
    evidence: quoteMissing.includes(key) ? null : "(demo quote)",
    not_discussed: false,
    quote_missing: quoteMissing.includes(key),
  }]));
  return { version: 1, ai: { ...ai, skills, motivation, reason_for_leaving: null, concerns: [], revisit_hint: null }, fields };
}

// Everything the demo contains, as plain data, so a test can check it matches
// the plan without a database.
export function demoPlan(now = new Date()) {
  const roles = [
    { key: "platform", title: "Senior Platform Engineer", client: "Halden Systems", budget: [80000, 95000], skills: ["Kubernetes", "Terraform", "Incident response"], titles: ["Site Reliability Engineer", "Platform Engineer"] },
    { key: "data", title: "Lead Data Engineer", client: "Kestrel Freight", budget: [85000, 100000], skills: ["Kafka", "dbt", "Data modelling"], titles: ["Analytics Engineer", "Data Platform Engineer"] },
    { key: "product", title: "Product Designer", client: "Orrin Labs", budget: [60000, 72000], skills: ["Figma", "User research", "Design systems"], titles: ["UX Designer", "Product Designer"] },
  ];
  const facts = (salary, notice, location, rightToWork, ageDays = 5) => ({ salary, notice, location, rightToWork, ageDays });
  const people = [
    { key: "imogen", name: "Imogen Achterberg", headline: "Platform engineer, payments", skills: "kubernetes terraform incident response", roles: [["platform", "sourced"]] },
    { key: "ewa", name: "Ewa Szczepanska", headline: "Data engineer, streaming", skills: "kafka flink", roles: [["data", "contacted"]], message: true },
    { key: "callum", name: "Callum O'Driscoll", headline: "Site reliability engineer", skills: "site reliability engineer terraform", roles: [["platform", "contacted"]], message: true },
    { key: "saoirse", name: "Saoirse Pemberton-Ade", headline: "UX designer, health", skills: "user research figma", roles: [["product", "replied"]], message: true },
    { key: "odhran", name: "Odhran Vasquez-Beale", headline: "Analytics engineer", skills: "dbt data modelling", roles: [["data", "booked"]], booking: 0 },
    { key: "ines", name: "Ines Caetano-Lowe", headline: "Platform engineer, logistics", skills: "kubernetes aws", roles: [["platform", "booked"]], booking: 7 },
    { key: "priya", name: "Priya Venkataraman", headline: "Senior platform engineer", skills: "kubernetes terraform go", roles: [["platform", "screened"]],
      facts: facts([88000, 95000], 12, ["Manchester", "hybrid"], "has_right"), screening: "confirmed" },
    { key: "declan", name: "Declan Moriarty-Hughes", headline: "Data platform engineer", skills: "kafka dbt python", roles: [["data", "screened"]],
      facts: facts([90000, 98000], 4, ["Leeds", "remote"], "needs_sponsorship"), screening: "summarized", quoteMissing: ["right_to_work"] },
    { key: "grace", name: "Grace Adeyemi-Clarke", headline: "Product designer, marketplaces", skills: "figma design systems user research", roles: [["product", "submitted"]],
      facts: facts([65000, 70000], 4, ["London", "hybrid"], "has_right"), screening: "submitted" },
    { key: "rhys", name: "Rhys Llewellyn", headline: "Platform lead", skills: "kubernetes incident response", roles: [["platform", "submitted"]],
      facts: facts([92000, 95000], 8, ["Cardiff", "remote"], "has_right"), screening: "submitted" },
    { key: "zara", name: "Zara Qureshi", headline: "Data engineer, retail", skills: "kafka data modelling", roles: [["data", "rejected"]],
      facts: facts([80000, 85000], 12, ["Birmingham", "flexible"], "has_right", 40), revisitDays: 3, revisitNote: "Bonus pays out this month; open to moving after" },
    { key: "hamish", name: "Hamish Ferguson", headline: "SRE, gaming", skills: "site reliability engineer kubernetes", roles: [["platform", "rejected"]],
      facts: facts([85000, 90000], 4, ["Edinburgh", "hybrid"], "has_right", 210) },
    { key: "mei", name: "Mei Lin Thornbury", headline: "Product designer", skills: "figma", roles: [["product", "contacted"]], doNotContact: true, message: true },
    // The same person filed against two roles: one record, two candidacies.
    { key: "aisling", name: "Aisling Brennan", headline: "Data and platform engineer", skills: "kafka kubernetes terraform", roles: [["data", "sourced"], ["platform", "contacted"]], message: true },
  ];
  return {
    settings: {
      recruiterName: "Morven Ellis",
      bookingWindows: JSON.stringify([1, 2, 3, 4, 5].map((day) => ({ day, startMin: 9 * 60 + 30, endMin: 17 * 60 }))),
      meetingLink: "https://meet.example/morven-demo",
      offerPhone: true,
      bookingMinNoticeHours: 2,
    },
    templates: [
      { name: "First message", kind: "message", body: "Hi {{first_name}}, I'm working on a {{role_title}} role and your background stood out. Open to a quick call? Pick a time here: {{booking_link}}\n\n{{recruiter_name}}" },
      { name: "Connection note", kind: "connection_note", body: "Hi {{first_name}}, I'm hiring for a {{role_title}} and would love to connect." },
    ],
    roles,
    people: people.map((person) => ({
      ...person,
      factsConfirmedAt: person.facts ? new Date(now.getTime() - person.facts.ageDays * DAY) : null,
      revisitOn: person.revisitDays ? at(now, person.revisitDays) : null,
      // Today's call an hour or two from now, so it is still ahead; the other
      // a week out at 11:00.
      bookingAt: person.booking === undefined ? null : person.booking === 0 ? new Date(Math.ceil((now.getTime() + 2 * 3_600_000) / 1_800_000) * 1_800_000) : at(now, person.booking, 11),
    })),
  };
}

export async function seedDemo(db, { email = DEFAULT_EMAIL, origin, output, now = new Date(), openFile = open }) {
  email = normalizeEmail(email);
  origin = validateOrigin(origin);
  if (!output || typeof output !== "string") throw new SafeError("An explicitly named new file for the sign-in link is required.");
  const plan = demoPlan(now);
  const path = resolve(output);
  const token = randomBytes(32).toString("base64url");
  let handle;
  let ownsFile = false;
  try {
    handle = await openFile(path, "wx", 0o600);
    ownsFile = true;
    await db.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { email } })) throw new SafeError("A demo account with that email already exists; nothing was added.");
      const user = await tx.user.create({ data: { email, name: plan.settings.recruiterName, role: "recruiter", accountTier: "pro", active: true, passwordHash: null } });
      await tx.settings.create({ data: { userId: user.id, ...plan.settings } });
      await tx.activationToken.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(now.getTime() + DAY) } });
      for (const template of plan.templates) await tx.messageTemplate.create({ data: { userId: user.id, ...template } });

      const roleIds = {};
      for (const role of plan.roles) {
        const created = await tx.role.create({ data: { userId: user.id, title: role.title, client: role.client, budgetMin: role.budget[0], budgetMax: role.budget[1], budgetCurrency: "GBP" } });
        await tx.briefing.create({ data: {
          roleId: created.id, dayToDay: `Demo briefing for ${role.title}.`, salaryRange: `£${role.budget[0] / 1000}k to £${role.budget[1] / 1000}k`,
          keySkills: JSON.stringify(role.skills.map((skill) => ({ skill, real_vs_buzzword: "" }))), searchTitles: JSON.stringify(role.titles),
          targetCompanies: "[]", firstCallQuestions: "[]",
        } });
        roleIds[role.key] = created.id;
      }

      let index = 0;
      for (const person of plan.people) {
        index += 1;
        const f = person.facts;
        const created = await tx.person.create({ data: {
          userId: user.id, fullName: person.name, headline: person.headline,
          profileUrl: `https://www.linkedin.com/in/demo-${person.key}`,
          skillsSummary: person.skills, doNotContact: Boolean(person.doNotContact),
          searchText: `${person.name} ${person.headline} ${person.skills} ${f?.location[0] ?? ""}`.toLowerCase(),
          ...(f ? { salaryMin: f.salary[0], salaryMax: f.salary[1], salaryCurrency: "GBP", noticeWeeks: f.notice, location: f.location[0], remotePreference: f.location[1], rightToWork: f.rightToWork, factsConfirmedAt: person.factsConfirmedAt } : {}),
          ...(person.revisitOn ? { revisitOn: person.revisitOn, revisitNote: person.revisitNote } : {}),
        } });
        for (const [roleKey, stage] of person.roles) {
          const candidate = await tx.candidate.create({ data: {
            roleId: roleIds[roleKey], personId: created.id, fullName: person.name, headline: person.headline,
            profileUrl: `https://www.linkedin.com/in/demo-${person.key}`, stage, lastActivityAt: new Date(now.getTime() - index * DAY / 2),
          } });
          if (person.message) {
            await tx.outreachLog.create({ data: { candidateId: candidate.id, kind: "message", renderedBody: `Hi ${person.name.split(" ")[0]}, I'm working on a role your background fits. Open to a quick call?\n\nMorven`, sentAt: new Date(now.getTime() - (index + 1) * DAY) } });
          }
          if (person.bookingAt) {
            const booking = await tx.booking.create({ data: {
              candidateId: candidate.id, userId: user.id, startsAt: person.bookingAt, endsAt: new Date(person.bookingAt.getTime() + 30 * 60_000),
              mode: "video", meetingUrl: plan.settings.meetingLink, email: `${person.key}@example.test`, consentAt: now, noticeVersion: "demo",
            } });
            await tx.bookedSlot.create({ data: { userId: user.id, startsAt: person.bookingAt, bookingId: booking.id } });
          }
          if (person.screening && f) {
            const data = summary({ salary: f.salary, notice: f.notice, location: f.location, rightToWork: f.rightToWork, skills: person.skills.split(" "), motivation: "Wants a team that owns its roadmap.", quoteMissing: person.quoteMissing });
            const confirmed = person.screening !== "summarized";
            await tx.screening.create({ data: {
              candidateId: candidate.id, status: confirmed ? "confirmed" : "summarized", transcriptSource: "manual",
              summaryJson: JSON.stringify(confirmed ? data : { ...data, fields: Object.fromEntries(Object.entries(data.fields).map(([k, v]) => [k, { ...v, confirmed: false }])) }),
              summaryModel: "demo", generatedAt: person.factsConfirmedAt, confirmedAt: confirmed ? person.factsConfirmedAt : null,
              representConsentAt: person.screening === "submitted" ? person.factsConfirmedAt : null,
              clientEmailSentAt: person.screening === "submitted" ? new Date(now.getTime() - DAY) : null,
            } });
          }
        }
      }
      await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "demo.seeded" } });
      await handle.writeFile(`${origin}/activate#token=${token}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
    }, { maxWait: 10000, timeout: 60000 });
    return path;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (ownsFile) await unlink(path).catch(() => {});
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["--email", "--origin", "--output"]);
  if (!args["--origin"] || !args["--output"]) throw new SafeError("Usage: node scripts/seed-demo.mjs --origin ORIGIN --output NEW_FILE [--email EMAIL]  (DATABASE_URL must be a local SQLite file)");
  if (targetProvider(process.env.DATABASE_URL) !== "sqlite") throw new SafeError("The demo is for a local SQLite database only, never the hosted one.");
  const datasourceUrl = `file:${await sqliteTargetPath(process.env.DATABASE_URL)}`;
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ log: [], datasourceUrl });
  try {
    console.log(await seedDemo(db, { email: args["--email"] ?? DEFAULT_EMAIL, origin: args["--origin"], output: args["--output"] }));
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof SafeError ? error.message : "The demo could not be created; nothing was added and no sign-in link was written.");
    process.exitCode = 1;
  });
}
