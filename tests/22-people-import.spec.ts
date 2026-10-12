import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./helpers";
import { CURRENT_RELEASE } from "../lib/release";
import { hashToken } from "../lib/auth-crypto";
import { suppressionHashes } from "../lib/person-keys.mjs";
import { xlsx, zip } from "./xlsx-fixture.mjs";

// Importing people from a spreadsheet: a preview that writes nothing, people
// recognised by link and never by name, anyone deleted before skipped, and
// every account kept apart. Only fictional people and disposable accounts.

const BASE = "http://localhost:3100";
const EMPTY_STATE = { cookies: [], origins: [] };
type Actor = { id: string; email: string; page: Page; session: string };

const test = base.extend<{ create: (role?: "admin" | "recruiter") => Promise<Actor> }>({
  create: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (role = "recruiter") => {
      const suffix = randomUUID();
      const user = await db.user.create({ data: {
        email: `imp-${role}-${suffix}@test.capture.invalid`, name: `Imp ${role} ${suffix}`, role,
        settings: { create: { seenRelease: CURRENT_RELEASE } },
      } });
      const token = randomBytes(32).toString("base64url");
      await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
      const context = await browser.newContext({ baseURL: BASE, storageState: EMPTY_STATE, serviceWorkers: "block" });
      contexts.push(context);
      await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
      return { id: user.id, email: user.email, page: await context.newPage(), session: hashToken(token) };
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

test.use({ storageState: EMPTY_STATE });
test.setTimeout(120_000);
test.afterAll(async () => { await db.$disconnect(); });

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const HEADER = ["Name", "LinkedIn URL", "Job Title", "Location", "Skills", "Email", "Notes", "Do not contact"];

async function choose(page: Page, buffer: Buffer, name = "leads.xlsx") {
  await page.goto("/people/import");
  await page.locator("#people-file").setInputFiles({ name, mimeType: XLSX, buffer });
}

async function importNow(page: Page) {
  await page.getByLabel(/legitimate reason/).check();
  await page.getByRole("button", { name: /^Import \d/ }).click();
}

test("I1 a spreadsheet is previewed without writing, then imported with a note saying where it came from", async ({ create }) => {
  const owner = await create();
  const stranger = await create();
  await db.person.create({ data: { userId: owner.id, fullName: "Already Here", profileUrl: "https://www.linkedin.com/in/already-here", headline: "Kept headline", searchText: "already here" } });
  await db.person.create({ data: { userId: stranger.id, fullName: "Other Account", profileUrl: "https://www.linkedin.com/in/ana-test", searchText: "other account" } });
  await db.suppression.create({ data: { userId: owner.id, keyHash: suppressionHashes({ email: "erased@example.test" })[0] } });

  const buffer: Buffer = xlsx([
    HEADER,
    ["Ana Test", "linkedin.com/in/Ana-Test/", "Staff Engineer", "Leeds", "Go, SQL", "Ana@Example.Test", "Met at a meetup", ""],
    ["Ben Test", "", "Designer", "York", "", "ben@example.test", "", "yes"],
    ["Already Here", "https://uk.linkedin.com/in/already-here", "Ignored headline", "", "", "", "", "yes"],
    ["Erased Person", "", "", "", "", "erased@example.test", "", ""],
    ["Ana Again", "https://www.linkedin.com/in/ana-test", "", "", "", "", "", ""],
    ["", "https://www.linkedin.com/in/no-name", "", "", "", "", "", ""],
    ["Bad Values", "javascript:alert(1)", "", "", "", "not-an-email", "", ""],
  ]);
  await choose(owner.page, buffer);

  await expect(owner.page.locator('[data-count="new"]')).toHaveText("3");
  await expect(owner.page.locator('[data-count="existing"]')).toHaveText("1");
  await expect(owner.page.locator('[data-count="suppressed"]')).toHaveText("1");
  await expect(owner.page.locator('[data-count="duplicate"]')).toHaveText("1");
  await expect(owner.page.locator('[data-count="invalid"]')).toHaveText("1");
  expect(await db.person.count({ where: { userId: owner.id } }), "a preview writes nothing").toBe(1);
  await expect(owner.page.getByRole("button", { name: /^Import \d/ })).toBeDisabled();

  await importNow(owner.page);
  await expect(owner.page.getByRole("status")).toContainText("Imported 3 people");

  const people = await db.person.findMany({ where: { userId: owner.id }, include: { notes: true, candidates: true }, orderBy: { fullName: "asc" } });
  expect(people.map((person) => person.fullName)).toEqual(["Already Here", "Ana Test", "Bad Values", "Ben Test"]);
  const byName = Object.fromEntries(people.map((person) => [person.fullName, person]));
  expect(byName["Ana Test"]).toMatchObject({ profileUrl: "https://www.linkedin.com/in/ana-test", headline: "Staff Engineer", location: "Leeds", skillsSummary: "Go, SQL", email: "ana@example.test", emailSource: "import", emailConsentAt: null, doNotContact: false, factsConfirmedAt: null, salaryMin: null });
  expect(byName["Ana Test"].searchText).toContain("leeds");
  expect(byName["Ana Test"].candidates).toHaveLength(0);
  expect(byName["Ana Test"].notes.map((note) => note.body).sort()).toEqual(['Imported from "leads.xlsx" on ' + new Date().toISOString().slice(0, 10) + ".", "Met at a meetup"]);
  expect(byName["Ben Test"].doNotContact).toBe(true);
  expect(byName["Bad Values"]).toMatchObject({ profileUrl: null, email: null });
  expect(byName["Already Here"]).toMatchObject({ headline: "Kept headline", doNotContact: true });
  expect(await db.person.count({ where: { userId: owner.id, fullName: "Erased Person" } })).toBe(0);
  expect(await db.person.findFirstOrThrow({ where: { userId: stranger.id } })).toMatchObject({ fullName: "Other Account", doNotContact: false });
  expect(await db.person.count({ where: { userId: stranger.id } })).toBe(1);
  expect(await db.auditEvent.count({ where: { actorId: owner.id, action: "people.imported" } })).toBe(1);
  expect(await db.usageEvent.count({ where: { userId: owner.id, kind: "people_imported" } })).toBe(1);

  await owner.page.goto("/people");
  await expect(owner.page.getByRole("link", { name: "Ana Test" })).toBeVisible();
});

test("I2 importing the same file again adds nobody", async ({ create }) => {
  const owner = await create();
  const buffer: Buffer = xlsx([HEADER, ["Cal Test", "linkedin.com/in/cal-test", "", "", "", "", "", ""], ["Dee Test", "linkedin.com/in/dee-test", "", "", "", "", "", ""]]);
  await choose(owner.page, buffer);
  await importNow(owner.page);
  await expect(owner.page.getByRole("status")).toContainText("Imported 2 people");
  await choose(owner.page, buffer);
  await expect(owner.page.locator('[data-count="new"]')).toHaveText("0");
  await expect(owner.page.locator('[data-count="existing"]')).toHaveText("2");
  await expect(owner.page.getByRole("button", { name: /^Import \d/ })).toBeDisabled();
  expect(await db.person.count({ where: { userId: owner.id } })).toBe(2);
});

test("I3 unfamiliar headings are matched by hand, and gaps can be filled without overwriting", async ({ create }) => {
  const owner = await create();
  await db.person.create({ data: { userId: owner.id, fullName: "Eve Test", profileUrl: "https://www.linkedin.com/in/eve-test", headline: "Kept", searchText: "eve test kept" } });
  const buffer: Buffer = xlsx([["Who", "Page", "Role now", "Town"], ["Eve Test", "linkedin.com/in/eve-test", "Replacement", "Hull"]]);
  await choose(owner.page, buffer, "odd headings.xlsx");
  await expect(owner.page.getByRole("alert").filter({ hasText: "Choose which column holds the name" })).toBeVisible();
  await owner.page.getByLabel("Import column Who as").selectOption("fullName");
  await expect(owner.page.locator('[data-count="new"]')).toHaveText("1");
  await owner.page.getByLabel("Import column Page as").selectOption("profileUrl");
  await expect(owner.page.locator('[data-count="existing"]')).toHaveText("1");
  await owner.page.getByLabel("Import column Role now as").selectOption("headline");
  await owner.page.getByLabel("Import column Town as").selectOption("location");
  await owner.page.getByLabel(/Fill empty headline/).check();
  await importNow(owner.page);
  await expect(owner.page.getByRole("status")).toContainText("Filled gaps on 1 record");
  const eve = await db.person.findFirstOrThrow({ where: { userId: owner.id, fullName: "Eve Test" } });
  expect(eve).toMatchObject({ headline: "Kept", location: "Hull" });
  expect(eve.searchText).toContain("hull");
});

test("I4 files that cannot be read are refused with a plain message and nothing is written", async ({ create }) => {
  const owner = await create();
  const cases: [Buffer, string, RegExp][] = [
    [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), "old.xls", /old \.xls/],
    [zip({ "notes.txt": "hello" }), "fake.xlsx", /not an Excel workbook/],
    [Buffer.alloc(4 * 1024 * 1024 + 1, 65), "huge.csv", /larger than 4 MB/],
    [Buffer.from("Name\n"), "empty.csv", /nothing to import/],
  ];
  for (const [buffer, name, message] of cases) {
    await choose(owner.page, buffer, name);
    await expect(owner.page.locator("p[role=alert]")).toContainText(message);
  }
  expect(await db.person.count({ where: { userId: owner.id } })).toBe(0);
});

test("I5 an imported person is not cleaned up when their only role is removed", async ({ create }) => {
  const owner = await create();
  await choose(owner.page, xlsx([HEADER, ["Fay Test", "linkedin.com/in/fay-test", "", "", "", "", "", ""]]));
  await importNow(owner.page);
  await expect(owner.page.getByRole("status")).toContainText("Imported 1 person");
  const fay = await db.person.findFirstOrThrow({ where: { userId: owner.id } });
  const role = await db.role.create({ data: { userId: owner.id, title: "Import Orphan Test" } });
  await db.candidate.create({ data: { roleId: role.id, fullName: "Fay Test", personId: fay.id } });
  await owner.page.goto(`/roles/${role.id}`);
  await owner.page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
  owner.page.once("dialog", (dialog) => dialog.accept());
  await owner.page.getByRole("button", { name: "Remove" }).first().click();
  await expect.poll(() => db.candidate.count({ where: { roleId: role.id } })).toBe(0);
  expect(await db.person.count({ where: { id: fay.id } })).toBe(1);
});

test("I6 a read-only view of someone else's workspace cannot import", async ({ create }) => {
  const admin = await create("admin");
  const target = await create();
  await db.session.update({ where: { tokenHash: admin.session }, data: { viewUserId: target.id } });
  await admin.page.goto("/people");
  await expect(admin.page.getByRole("link", { name: "Import people" })).toHaveCount(0);
  await admin.page.goto("/people/import");
  await expect(admin.page.locator("#people-file")).toHaveCount(0);
  await expect(admin.page.getByText("Return to your own workspace")).toBeVisible();
});

test("I7 import is offered on a Basic account and on a phone-width screen", async ({ create }) => {
  const owner = await create();
  await owner.page.setViewportSize({ width: 375, height: 800 });
  await owner.page.goto("/people");
  await owner.page.getByRole("link", { name: "Import people" }).first().click();
  await expect(owner.page.getByRole("heading", { name: "Import people" })).toBeVisible();
  const overflow = await owner.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
