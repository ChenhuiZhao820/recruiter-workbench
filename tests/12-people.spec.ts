import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { db, TEST_ADMIN_ID, TEST_DATABASE_URL, openAddCandidate } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { randomBytes } from "node:crypto";
import { CURRENT_RELEASE } from "../lib/release";

// People: one record per person across roles, matched by member id or the
// canonical profile link and never by name, with do-not-contact and erasure.
// Only fictional people and the disposable test database are used.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const TOKEN = "test-people-capture-token-aaaaaaaaaaaa";
const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
let firstRole = "";
let secondRole = "";
let thirdRole = "";

async function addOnRole(page: import("@playwright/test").Page, roleId: string, name: string, url: string, headline = "") {
  await page.goto(`/roles/${roleId}`);
  await openAddCandidate(page);
  await page.locator("#new-fullName").fill(name);
  await page.locator("#new-profileUrl").fill(url);
  if (headline) await page.locator("#new-headline").fill(headline);
  await page.getByRole("button", { name: "Add candidate" }).click();
}

test.beforeAll(async () => {
  await db.settings.upsert({
    where: { userId: TEST_ADMIN_ID },
    update: { captureTokenHash: hashToken(TOKEN) },
    create: { userId: TEST_ADMIN_ID, captureTokenHash: hashToken(TOKEN) },
  });
  firstRole = (await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "People Test Platform Lead", client: "Halden Systems" } })).id;
  secondRole = (await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "People Test Staff Engineer", client: "Orrin Labs" } })).id;
  thirdRole = (await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "People Test Data Lead", client: "Kestrel Freight" } })).id;
});

test("P1 the same profile on two roles is one person, whichever way the link was pasted", async ({ page }) => {
  await addOnRole(page, firstRole, "Imogen Achterberg", "linkedin.com/in/Imogen-Achterberg/", "Platform engineer at Halden");
  await expect(page.locator("li.card", { hasText: "Imogen Achterberg" })).toBeVisible();
  await addOnRole(page, secondRole, "Imogen A.", "https://uk.linkedin.com/in/imogen-achterberg?trk=public");
  await expect(page.locator("li.card", { hasText: "Imogen A." })).toBeVisible();

  const people = await db.person.findMany({ where: { userId: TEST_ADMIN_ID, fullName: { startsWith: "Imogen" } } });
  expect(people).toHaveLength(1);
  expect(people[0].profileUrl).toBe("https://www.linkedin.com/in/imogen-achterberg");
  expect(await db.candidate.count({ where: { personId: people[0].id } })).toBe(2);

  // Same name, no link: someone else.
  await addOnRole(page, thirdRole, "Imogen Achterberg", "");
  await expect(page.locator("li.card", { hasText: "Imogen Achterberg" })).toBeVisible();
  expect(await db.person.count({ where: { userId: TEST_ADMIN_ID, fullName: "Imogen Achterberg" } })).toBe(2);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL(/\/people$/);
  // Two people share the name; the list shows both, each with their own roles.
  await expect(page.getByRole("link", { name: "Imogen Achterberg", exact: true })).toHaveCount(2);
  await page.locator(".person-row", { hasText: "People Test Platform Lead" }).getByRole("link", { name: "Imogen Achterberg" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Imogen Achterberg" })).toBeVisible();
  const roles = page.getByRole("region", { name: /Roles/ });
  await expect(roles.getByRole("link", { name: "People Test Platform Lead" })).toBeVisible();
  await expect(roles.getByRole("link", { name: "People Test Staff Engineer" })).toBeVisible();
});

test("P2 a capture with LinkedIn's member id joins the existing person and the lookup reports it", async ({ request }) => {
  const person = await db.person.findFirstOrThrow({ where: { userId: TEST_ADMIN_ID, profileUrl: "https://www.linkedin.com/in/imogen-achterberg" } });
  const saved = await request.post(`${BASE}/api/capture`, {
    headers: { "X-Capture-Token": TOKEN, Origin: EXT_ORIGIN },
    data: { roleId: thirdRole, fullName: "Imogen Achterberg", profileUrl: "https://www.linkedin.com/in/imogen-achterberg/", memberId: "ACoAAImogen01" },
  });
  expect(saved.status()).toBe(201);
  const candidate = await db.candidate.findUniqueOrThrow({ where: { id: (await saved.json()).candidateId } });
  expect(candidate.personId).toBe(person.id);
  expect((await db.person.findUniqueOrThrow({ where: { id: person.id } })).memberId).toBe("ACoAAImogen01");

  const lookup = await request.get(`${BASE}/api/capture?profileUrl=${encodeURIComponent("linkedin.com/in/IMOGEN-achterberg")}`, {
    headers: { "X-Capture-Token": TOKEN, Origin: EXT_ORIGIN },
  });
  const body = await lookup.json();
  expect(body.person.id).toBe(person.id);
  expect(body.person.roles).toHaveLength(3);
  expect(body.suppressed).toBe(false);
});

test("P3 with people search the words reach recorded facts; on Basic the search stays on name and headline", async ({ page, browser }) => {
  const person = await db.person.findFirstOrThrow({ where: { userId: TEST_ADMIN_ID, memberId: "ACoAAImogen01" } });
  await db.person.update({ where: { id: person.id }, data: { skillsSummary: "kubernetes", searchText: `${person.searchText} kubernetes` } });
  await page.goto("/people?q=imogen");
  await expect(page.getByRole("heading", { name: /Matching people/ })).toContainText("2");
  await page.goto("/people?q=halden");
  await expect(page.locator(".person-row")).toHaveCount(1);
  await page.goto("/people?q=kubernetes");
  await expect(page.locator(".person-row")).toHaveCount(1);
  await page.goto("/people?q=nobody-has-this");
  await expect(page.getByRole("heading", { name: "No one matches that search" })).toBeVisible();
  await page.getByRole("link", { name: "Clear search" }).click();
  await expect(page).toHaveURL(/\/people$/);

  // A Basic account searching its own people never reaches what they said.
  const basic = await db.user.create({ data: { email: `people-basic-${Date.now()}@test.capture.invalid`, name: "Basic Recruiter", role: "recruiter", accountTier: "basic", settings: { create: { seenRelease: CURRENT_RELEASE } } } });
  await db.person.create({ data: { userId: basic.id, fullName: "Odile Brannagh", headline: "Platform engineer", skillsSummary: "kubernetes", searchText: "odile brannagh platform engineer kubernetes" } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId: basic.id, authVersion: basic.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  const basicPage = await context.newPage();
  try {
    await basicPage.goto("/people?q=kubernetes");
    await expect(basicPage.getByRole("heading", { name: "No one matches that search" })).toBeVisible();
    await expect(basicPage.getByText("Filter by confirmed details")).toHaveCount(0);
    await basicPage.goto("/people?q=platform");
    await expect(basicPage.locator(".person-row")).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test("P4 another account's people are invisible and their pages are not found", async ({ page }) => {
  const other = await db.user.create({ data: { email: "people-other@test.capture.invalid", name: "Other Recruiter", role: "recruiter", settings: { create: {} } } });
  const foreign = await db.person.create({ data: { userId: other.id, fullName: "Tamsin Okoro-Lindqvist", searchText: "tamsin okoro-lindqvist" } });
  await page.goto("/people");
  await expect(page.getByText("Tamsin Okoro-Lindqvist")).toHaveCount(0);
  const response = await page.goto(`/people/${foreign.id}`);
  expect(response?.status()).toBe(404);
});

test("P5 do not contact is shown wherever the person appears and can be lifted", async ({ page }) => {
  const person = await db.person.findFirstOrThrow({ where: { userId: TEST_ADMIN_ID, memberId: "ACoAAImogen01" } });
  await page.goto(`/people/${person.id}`);
  await page.getByRole("button", { name: "Mark do not contact" }).click();
  await expect(page.locator("header").getByText("Do not contact")).toBeVisible();
  await expect(page.getByRole("link", { name: "Write a message" })).toHaveCount(0);
  await page.goto(`/roles/${firstRole}`);
  await expect(page.locator("li.card", { hasText: "Imogen Achterberg" }).getByText("Do not contact")).toBeVisible();
  await page.goto(`/people/${person.id}`);
  await page.getByRole("button", { name: "Allow contact again" }).click();
  await expect(page.locator("header").getByText("Do not contact")).toHaveCount(0);
  expect(await db.auditEvent.count({ where: { actorId: TEST_ADMIN_ID, action: "person.do_not_contact" } })).toBe(1);
});

test("P6 erasing needs DELETE typed, removes every candidacy and is recognised on a later save", async ({ page, request }) => {
  const person = await db.person.findFirstOrThrow({ where: { userId: TEST_ADMIN_ID, memberId: "ACoAAImogen01" } });
  await page.goto(`/people/${person.id}`);
  await page.getByLabel("Type DELETE to confirm").fill("delete");
  await page.getByRole("button", { name: "Erase this person" }).click();
  // The browser refuses the form: the pattern does not match.
  expect(await db.person.count({ where: { id: person.id } })).toBe(1);

  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Erase this person" }).click();
  await expect(page).toHaveURL(/\/people\?deleted=1$/);
  await expect(page.getByRole("status")).toContainText("deleted");
  expect(await db.person.count({ where: { id: person.id } })).toBe(0);
  expect(await db.candidate.count({ where: { personId: person.id } })).toBe(0);
  expect(await db.candidate.count({ where: { role: { userId: TEST_ADMIN_ID }, memberId: "ACoAAImogen01" } })).toBe(0);
  expect(await db.suppression.count({ where: { userId: TEST_ADMIN_ID } })).toBeGreaterThanOrEqual(2);
  const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "person.erased" } });
  expect(JSON.stringify(audit)).not.toContain("Imogen");

  const lookup = await request.get(`${BASE}/api/capture?profileUrl=${encodeURIComponent("https://www.linkedin.com/in/imogen-achterberg")}`, {
    headers: { "X-Capture-Token": TOKEN, Origin: EXT_ORIGIN },
  });
  expect((await lookup.json()).suppressed).toBe(true);

  await addOnRole(page, firstRole, "Imogen Achterberg", "https://www.linkedin.com/in/imogen-achterberg");
  await expect(page.getByText("This profile was deleted from your workspace before")).toBeVisible();
});

test("P7 the backfill dry run counts candidates without a person and writes nothing", async () => {
  const role = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Backfill Test Role" } });
  await db.candidate.createMany({
    data: [
      { roleId: role.id, fullName: "Odhran Vasquez-Beale", profileUrl: "https://www.linkedin.com/in/odhran-vb" },
      { roleId: role.id, fullName: "Odhran V.", profileUrl: "linkedin.com/in/Odhran-VB/" },
      { roleId: role.id, fullName: "No Link Person" },
    ],
  });
  const before = await db.person.count();
  const output = execFileSync(process.execPath, ["scripts/backfill-people.mjs", "--dry-run"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    encoding: "utf8",
  });
  const preview = JSON.parse(output.trim().split("\n").pop()!);
  expect(preview.candidatesWithoutPerson).toBeGreaterThanOrEqual(3);
  expect(preview.peopleToCreate).toBeGreaterThanOrEqual(2);
  expect(output).not.toContain("Odhran");
  expect(await db.person.count()).toBe(before);
});
