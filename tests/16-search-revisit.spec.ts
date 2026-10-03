import { test, expect, type Browser } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db, TEST_ADMIN_ID } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";

// The talent database at work: a role budget, searching people by what they
// told you, matching people to a role, revisit reminders and the review list.
// Fictional people and the disposable test database only. Names and skill
// words are unique to this spec, because other specs add people to the same
// test account and a shared word would match theirs too.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const DAY = 86_400_000;
let roleId = "";

type Facts = { salaryMin?: number | null; salaryMax?: number | null; noticeWeeks?: number | null; location?: string | null; remotePreference?: string | null; rightToWork?: string | null; confirmedDaysAgo?: number | null; skills?: string; doNotContact?: boolean };

async function person(fullName: string, facts: Facts = {}, userId = TEST_ADMIN_ID) {
  const skills = facts.skills ?? "";
  return db.person.create({ data: {
    userId, fullName, headline: `${fullName.split(" ")[0]}'s headline`, profileUrl: `https://www.linkedin.com/in/test-${randomUUID()}`,
    salaryMin: facts.salaryMin ?? null, salaryMax: facts.salaryMax ?? null, salaryCurrency: facts.salaryMin || facts.salaryMax ? "GBP" : null,
    noticeWeeks: facts.noticeWeeks ?? null, location: facts.location ?? null, remotePreference: facts.remotePreference ?? null, rightToWork: facts.rightToWork ?? null,
    factsConfirmedAt: facts.confirmedDaysAgo === null || facts.confirmedDaysAgo === undefined ? null : new Date(Date.now() - facts.confirmedDaysAgo * DAY),
    skillsSummary: skills || null, doNotContact: Boolean(facts.doNotContact),
    searchText: `${fullName} ${skills} ${facts.location ?? ""}`.toLowerCase(),
  } });
}

async function basicPage(browser: Browser) {
  const user = await db.user.create({ data: { email: `talent-basic-${randomUUID()}@test.capture.invalid`, name: "Basic Recruiter", role: "recruiter", accountTier: "basic", settings: { create: { seenRelease: CURRENT_RELEASE } } } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  return { user, page: await context.newPage(), close: () => context.close() };
}

test("T1 a role carries an optional budget, read the way recruiters type it", async ({ page }) => {
  await page.goto("/roles/new");
  await page.getByLabel("Job title").fill("Talent Test Platform Lead");
  await page.getByLabel("Client (optional)").fill("Halden Systems");
  await page.getByLabel("Budget from").fill("95k");
  await page.getByLabel("Budget up to").fill("£80,000");
  await page.getByRole("button", { name: "Create role" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Talent Test Platform Lead" })).toBeVisible();
  await expect(page.getByText("Budget £80,000 to £95,000 a year")).toBeVisible();
  roleId = page.url().split("/roles/")[1];
  expect(await db.role.findUniqueOrThrow({ where: { id: roleId } })).toMatchObject({ budgetMin: 80000, budgetMax: 95000, budgetCurrency: "GBP" });

  await page.goto(`/roles/${roleId}/edit`);
  await page.getByLabel("Budget up to").fill("about ninety");
  await page.getByRole("button", { name: "Save role" }).click();
  await expect(page.locator('[data-form-message="error"]')).toContainText("whole amounts");
  expect((await db.role.findUniqueOrThrow({ where: { id: roleId } })).budgetMax).toBe(95000);
});

test("T2 people search filters on confirmed details, shows the facts, and flags old ones", async ({ page }) => {
  await person("Ilse Vandermeer", { salaryMin: 85000, salaryMax: 95000, noticeWeeks: 4, location: "Manchester", remotePreference: "hybrid", rightToWork: "has_right", confirmedDaysAgo: 10, skills: "quarkslate helmforge" });
  await person("Rosalind Achebe-Moss", { salaryMin: 110000, noticeWeeks: 12, location: "Leeds", remotePreference: "remote", rightToWork: "needs_sponsorship", confirmedDaysAgo: 400, skills: "kafka flink" });
  await person("Dorian Kettleworth", { skills: "quarkslate" });

  await page.goto("/people?q=quarkslate");
  await expect(page.locator(".person-row")).toHaveCount(2);
  const imogen = page.locator(".person-row", { hasText: "Ilse Vandermeer" });
  await expect(imogen.getByText("£85,000 to £95,000 a year / 4 weeks notice / Manchester, Hybrid / Has the right to work")).toBeVisible();

  await page.goto("/people");
  await page.getByText("Filter by confirmed details").click();
  await page.getByLabel("Salary up to (a year)").fill("90k");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/salary=90k/);
  await expect(page.locator(".person-row", { hasText: "Ilse Vandermeer" })).toBeVisible();
  await expect(page.locator(".person-row", { hasText: "Rosalind Achebe-Moss" })).toHaveCount(0);
  // Nothing confirmed means left out of a fact filter.
  await expect(page.locator(".person-row", { hasText: "Dorian Kettleworth" })).toHaveCount(0);

  await page.goto("/people?remote=remote&rtw=needs_sponsorship");
  await expect(page.locator(".person-row")).toHaveCount(1);
  const ewa = page.locator(".person-row", { hasText: "Rosalind Achebe-Moss" });
  await expect(ewa.getByText("May be out of date")).toBeVisible();
  await page.goto("/people?remote=remote&fresh=6");
  await expect(page.getByRole("heading", { name: "No one matches that search" })).toBeVisible();
  await page.goto("/people?notice=4");
  await expect(page.locator(".person-row")).toHaveCount(1);
});

test("T3 a role is matched against your database: best first, budget kept, labelled, and one click to add", async ({ page }) => {
  await db.briefing.create({ data: {
    roleId, dayToDay: "Runs the platform.", salaryRange: "£80k to £95k", targetCompanies: "[]", firstCallQuestions: "[]",
    keySkills: JSON.stringify([{ skill: "Quarkslate", real_vs_buzzword: "" }, { skill: "Helmforge", real_vs_buzzword: "" }]),
    searchTitles: JSON.stringify(["Lattice Reliability Engineer"]),
  } });
  await person("Bram Oyelaran", { salaryMin: 140000, confirmedDaysAgo: 5, skills: "quarkslate helmforge lattice reliability engineer" });
  await person("Cerys Lindqvist-Obi", { skills: "helmforge lattice reliability engineer" });
  await person("Tavish Morrow-Iqbal", { skills: "quarkslate helmforge", doNotContact: true });
  const already = await person("Noor Halloran", { skills: "quarkslate helmforge" });
  await db.candidate.create({ data: { roleId, personId: already.id, fullName: already.fullName } });

  await page.goto(`/roles/${roleId}`);
  await page.getByText(/From your database \(\d+\)/).click();
  const matches = page.locator(".match-row");
  const names = await matches.locator(".person-row-name").allTextContents();
  expect(names[0]).toBe("Ilse Vandermeer");
  expect(names).toContain("Cerys Lindqvist-Obi");
  expect(names).toContain("Dorian Kettleworth");
  for (const absent of ["Bram Oyelaran", "Tavish Morrow-Iqbal", "Noor Halloran", "Rosalind Achebe-Moss"]) expect(names).not.toContain(absent);
  await expect(matches.filter({ hasText: "Cerys Lindqvist-Obi" }).getByText("Salary unknown")).toBeVisible();
  await expect(matches.filter({ hasText: "Ilse Vandermeer" }).getByRole("list", { name: "Matched on" })).toContainText("quarkslate");

  await matches.filter({ hasText: "Ilse Vandermeer" }).getByRole("button", { name: "Add to this role" }).click();
  // Added, she leaves the matches and appears among the candidates as sourced.
  await expect(page.locator("li.card", { hasText: "Ilse Vandermeer" })).toBeVisible();
  const imogen = await db.person.findFirstOrThrow({ where: { userId: TEST_ADMIN_ID, fullName: "Ilse Vandermeer" } });
  const candidate = await db.candidate.findFirstOrThrow({ where: { roleId, personId: imogen.id } });
  expect(candidate.stage).toBe("sourced");
  await page.reload();
  await expect(page.locator("li.card", { hasText: "Ilse Vandermeer" })).toBeVisible();
  await page.getByText(/From your database \(\d+\)/).click();
  await expect(page.locator(".match-row", { hasText: "Ilse Vandermeer" })).toHaveCount(0);
});

test("T4 a revisit reminder is set on the person, shows in Follow-ups the week it is due, and clears", async ({ page }) => {
  const ewa = await db.person.findFirstOrThrow({ where: { userId: TEST_ADMIN_ID, fullName: "Rosalind Achebe-Moss" } });
  await page.goto(`/people/${ewa.id}`);
  await page.getByRole("button", { name: "Save reminder" }).click();
  await expect(page.locator('[data-form-message="error"]')).toContainText("Choose the date");
  const soon = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10);
  await page.locator("#revisitOn").fill(soon);
  await page.locator("#revisitNote").fill("Bonus pays out this month");
  await page.getByRole("button", { name: "Save reminder" }).click();
  await expect(page.locator('[data-form-message="notice"]')).toContainText("Reminder saved");
  expect((await db.person.findUniqueOrThrow({ where: { id: ewa.id } })).revisitNote).toBe("Bonus pays out this month");

  const later = await person("Wren Castellanos");
  await db.person.update({ where: { id: later.id }, data: { revisitOn: new Date(Date.now() + 30 * DAY) } });
  await page.goto("/followups");
  const due = page.getByRole("region", { name: "Due to revisit" });
  await expect(due.getByText("Rosalind Achebe-Moss")).toBeVisible();
  await expect(due.getByText("Bonus pays out this month")).toBeVisible();
  await expect(due.getByText("Wren Castellanos")).toHaveCount(0);
  await due.getByRole("button", { name: "Done, clear reminder" }).click();
  await expect(due.getByText("Rosalind Achebe-Moss")).toHaveCount(0);
  expect((await db.person.findUniqueOrThrow({ where: { id: ewa.id } })).revisitOn).toBeNull();
});

test("T5 saving a screening offers the date the candidate named, and it becomes the reminder", async ({ page }) => {
  const target = await person("Ottilie Brannock");
  const candidate = await db.candidate.create({ data: { roleId, personId: target.id, fullName: target.fullName, stage: "booked" } });
  const fields = {
    salary: { value: { min: 80000, max: 85000, currency: "GBP", note: null }, not_discussed: false, confirmed: true },
    notice: { value: { weeks: 4, available_from: null, note: null }, not_discussed: false, confirmed: true },
    location: { value: { location: "York", remote: "hybrid", note: null }, not_discussed: false, confirmed: true },
    right_to_work: { value: { status: "has_right", note: null }, not_discussed: false, confirmed: true },
  };
  const ai = { ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v.value, evidence: null, not_discussed: false, quote_missing: true }])), skills: ["Go"], motivation: null, reason_for_leaving: null, concerns: [], revisit_hint: "Try me again in 3 weeks" };
  await db.screening.create({ data: { candidateId: candidate.id, status: "summarized", transcriptSource: "paste", summaryJson: JSON.stringify({ version: 1, ai, fields }) } });

  await page.goto(`/candidates/${candidate.id}/screening`);
  const expected = new Date(Date.now() + 21 * DAY).toISOString().slice(0, 10);
  await expect(page.getByLabel("Get back in touch on (optional)")).toHaveValue(expected);
  await expect(page.getByLabel("Why", { exact: true })).toHaveValue("Try me again in 3 weeks");
  await page.getByRole("button", { name: "Save to their record" }).click();
  await expect(page.getByRole("heading", { name: /^Confirmed / })).toBeVisible();
  const saved = await db.person.findUniqueOrThrow({ where: { id: target.id } });
  expect(saved.revisitOn?.toISOString().slice(0, 10)).toBe(expected);
  expect(saved.revisitNote).toBe("Try me again in 3 weeks");
});

test("T6 people with no activity for a year are listed for review, and keeping one takes them off for a year", async ({ page }) => {
  const old = new Date(Date.now() - 400 * DAY);
  const stale = await person("Mairead Okonkwo-Hale");
  const staleRole = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Old Role" } });
  await db.candidate.create({ data: { roleId: staleRole.id, personId: stale.id, fullName: stale.fullName, lastActivityAt: old } });
  const stale2 = await person("Ruairi Fenwick-Obi");
  // Recent activity on any role keeps someone off the list.
  const active = await person("Hollis Adebayo-Grant");
  await db.candidate.create({ data: { roleId: staleRole.id, personId: active.id, fullName: active.fullName, lastActivityAt: new Date() } });
  for (const id of [stale.id, stale2.id, active.id]) await db.$executeRawUnsafe(`UPDATE "Person" SET "updatedAt" = ${old.getTime()} WHERE "id" = '${id}'`);

  await page.goto("/people");
  await page.getByRole("link", { name: /Review old records/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Review old records" })).toBeVisible();
  const list = page.getByRole("list", { name: "People to review" });
  await expect(list.getByText("Mairead Okonkwo-Hale")).toBeVisible();
  await expect(list.getByText("Ruairi Fenwick-Obi")).toBeVisible();
  await expect(list.getByText("Hollis Adebayo-Grant")).toHaveCount(0);

  await list.locator(".match-row", { hasText: "Ruairi Fenwick-Obi" }).getByRole("button", { name: "Keep for another year" }).click();
  await expect(list.getByText("Ruairi Fenwick-Obi")).toHaveCount(0);
  expect(await db.auditEvent.count({ where: { actorId: TEST_ADMIN_ID, action: "person.kept" } })).toBe(1);
  await list.locator(".match-row", { hasText: "Mairead Okonkwo-Hale" }).getByRole("link", { name: "Open to erase" }).click();
  await expect(page.getByRole("button", { name: "Erase this person" })).toBeVisible();
});

test("T7 a Basic account keeps the review list and loses matches, filters and reminders", async ({ browser }) => {
  const basic = await basicPage(browser);
  try {
    const role = await db.role.create({ data: { userId: basic.user.id, title: "Basic Talent Role" } });
    await db.briefing.create({ data: { roleId: role.id, dayToDay: "x", salaryRange: "x", targetCompanies: "[]", firstCallQuestions: "[]", keySkills: JSON.stringify([{ skill: "Quarkslate", real_vs_buzzword: "" }]), searchTitles: "[]" } });
    const someone = await person("Basic Person Quarkslate", { skills: "quarkslate" }, basic.user.id);
    await basic.page.goto(`/roles/${role.id}`);
    await expect(basic.page.getByText(/From your database/)).toHaveCount(0);
    await basic.page.goto(`/people/${someone.id}`);
    await expect(basic.page.getByRole("heading", { name: "Get back in touch" })).toHaveCount(0);
    await expect(basic.page.getByRole("button", { name: "Erase this person" })).toBeVisible();
    await basic.page.goto("/followups");
    await expect(basic.page.getByRole("region", { name: "Due to revisit" })).toHaveCount(0);
    await basic.page.goto("/people/review");
    await expect(basic.page.getByRole("heading", { level: 1, name: "Review old records" })).toBeVisible();
    await basic.page.goto("/roles/new");
    await expect(basic.page.getByLabel("Budget up to")).toBeVisible();
  } finally {
    await basic.close();
  }
});

test("T8 a read-only Admin view shows the review list and matches but cannot act on them", async ({ page }) => {
  const other = await db.user.create({ data: { email: `talent-pro-${randomUUID()}@test.capture.invalid`, name: "Pro Recruiter", role: "recruiter", accountTier: "pro", settings: { create: {} } } });
  const role = await db.role.create({ data: { userId: other.id, title: "Viewed Role" } });
  await db.briefing.create({ data: { roleId: role.id, dayToDay: "x", salaryRange: "x", targetCompanies: "[]", firstCallQuestions: "[]", keySkills: JSON.stringify([{ skill: "Quarkslate", real_vs_buzzword: "" }]), searchTitles: "[]" } });
  await person("Viewed Match", { skills: "quarkslate" }, other.id);
  const token = process.env.CAPTURE_TEST_SESSION_TOKEN!;
  await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: other.id } });
  try {
    await page.goto(`/roles/${role.id}`);
    await page.getByText(/From your database \(1\)/).click();
    await expect(page.getByRole("button", { name: "Add to this role" })).toBeDisabled();
  } finally {
    await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: null } });
  }
});
