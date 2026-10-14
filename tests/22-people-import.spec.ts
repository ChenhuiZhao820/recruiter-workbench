import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./helpers";
import { CURRENT_RELEASE } from "../lib/release";
import { hashToken } from "../lib/auth-crypto";
import { suppressionHashes } from "../lib/person-keys.mjs";
import { xlsx, zip } from "./xlsx-fixture.mjs";

// Importing people from a spreadsheet: a preview that writes nothing, people
// recognised by link and never by name, anyone deleted before skipped, and
// every account kept apart. The flow is three steps with one decision each;
// the columns appear only when Capture cannot tell which holds the name or
// when asked. Only fictional people and disposable accounts.

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
const IMPORT_BUTTON = /^(Import \d|Update people)/;

async function choose(page: Page, buffer: Buffer, name = "leads.xlsx") {
  await page.goto("/people/import");
  await page.locator("#people-file").setInputFiles({ name, mimeType: XLSX, buffer });
}

async function importNow(page: Page) {
  await page.getByLabel(/legitimate reason/).check();
  await page.getByRole("button", { name: IMPORT_BUTTON }).click();
}

test("I1 a spreadsheet is previewed on one screen without writing, then imported with a note saying where it came from", async ({ create }) => {
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

  // One screen: the answer, who, and what else, with no column choices to make.
  await expect(owner.page.getByRole("heading", { name: "3 people will be added" })).toBeVisible();
  await expect(owner.page.getByText("Ana Test, Ben Test, Bad Values")).toBeVisible();
  await expect(owner.page.locator('[data-count="existing"]')).toHaveText("1");
  await expect(owner.page.locator('[data-count="suppressed"]')).toHaveText("1");
  await expect(owner.page.locator('[data-count="duplicate"]')).toHaveText("1");
  await expect(owner.page.locator('[data-count="invalid"]')).toHaveText("1");
  await expect(owner.page.getByLabel(/^Import column/)).toHaveCount(0);
  await expect(owner.page.getByRole("listitem").filter({ hasText: "Review" }).first()).toHaveAttribute("aria-current", "step");
  expect(await db.person.count({ where: { userId: owner.id } }), "a preview writes nothing").toBe(1);
  await expect(owner.page.getByRole("button", { name: IMPORT_BUTTON })).toBeDisabled();
  await expect(owner.page.locator("#import-hint")).toHaveText("Tick the box above to import.");

  await importNow(owner.page);
  await expect(owner.page.getByRole("heading", { name: "Imported 3 people" })).toBeFocused();

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

test("I2 importing the same file again adds nobody and says so", async ({ create }) => {
  const owner = await create();
  const buffer: Buffer = xlsx([HEADER, ["Cal Test", "linkedin.com/in/cal-test", "", "", "", "", "", ""], ["Dee Test", "linkedin.com/in/dee-test", "", "", "", "", "", ""]]);
  await choose(owner.page, buffer);
  await importNow(owner.page);
  await expect(owner.page.getByRole("heading", { name: "Imported 2 people" })).toBeVisible();
  await choose(owner.page, buffer);
  await expect(owner.page.getByRole("heading", { name: "Nobody new in this file" })).toBeVisible();
  await expect(owner.page.locator('[data-count="existing"]')).toHaveText("2");
  await owner.page.getByLabel(/legitimate reason/).check();
  await expect(owner.page.getByRole("button", { name: "Nothing new to import" })).toBeDisabled();
  await expect(owner.page.locator("#import-hint")).toHaveText("Nobody new to add.");
  expect(await db.person.count({ where: { userId: owner.id } })).toBe(2);
});

test("I3 when no column looks like a name it asks, then gaps can be filled without overwriting", async ({ create }) => {
  const owner = await create();
  await db.person.create({ data: { userId: owner.id, fullName: "Eve Test", profileUrl: "https://www.linkedin.com/in/eve-test", headline: "Kept", searchText: "eve test kept" } });
  // Nothing here says "name", and a single word does not look like one.
  const buffer: Buffer = xlsx([["P", "Q", "R", "S"], ["Eve", "linkedin.com/in/eve-test", "Replacement", "Hull"]]);
  await choose(owner.page, buffer, "odd headings.xlsx");
  await expect(owner.page.getByRole("heading", { name: "Which column holds the name?" })).toBeFocused();
  await expect(owner.page.locator("#import-hint")).toHaveText("Answer the question above to import.");
  await expect(owner.page.getByLabel("Import column Q as"), "the link column is still recognised by its contents").toHaveValue("profileUrl");
  await owner.page.getByLabel("Import column P as").selectOption("fullName");
  await expect(owner.page.getByRole("heading", { name: "Nobody new in this file" })).toBeVisible();
  await owner.page.getByLabel("Import column R as").selectOption("headline");
  await owner.page.getByLabel("Import column S as").selectOption("location");
  await owner.page.getByLabel(/Also fill empty headline/).check();
  await importNow(owner.page);
  await expect(owner.page.getByRole("heading", { name: "Imported 0 people" })).toBeVisible();
  await expect(owner.page.getByText("Empty fields filled on 1 record")).toBeVisible();
  const eve = await db.person.findFirstOrThrow({ where: { userId: owner.id, fullName: "Eve Test" } });
  expect(eve).toMatchObject({ headline: "Kept", location: "Hull" });
  expect(eve.searchText).toContain("hull");
});

test("I4 columns can be changed on request and the choice is respected", async ({ create }) => {
  const owner = await create();
  await choose(owner.page, xlsx([HEADER, ["Gus Test", "linkedin.com/in/gus-test", "Analyst", "Leeds", "", "", "", ""]]));
  await expect(owner.page.getByRole("heading", { name: "1 person will be added" })).toBeVisible();
  await expect(owner.page.getByText("Columns read: Full name, Profile link, Current job title, Location")).toBeVisible();
  await owner.page.getByRole("button", { name: "Change columns" }).click();
  await owner.page.getByLabel("Import column Location as").selectOption("");
  await expect(owner.page.getByText("Kept in each person's note: Location")).toBeVisible();
  await owner.page.getByRole("button", { name: "Do not keep" }).click();
  await expect(owner.page.getByText("Not imported: Location")).toBeVisible();
  await importNow(owner.page);
  await expect(owner.page.getByRole("heading", { name: "Imported 1 person" })).toBeVisible();
  const gus = await db.person.findFirstOrThrow({ where: { userId: owner.id }, include: { notes: true } });
  expect(gus).toMatchObject({ fullName: "Gus Test", headline: "Analyst", location: null });
  expect(gus.notes.map((note) => note.body).join("\n")).not.toContain("Leeds");
});

// ---- roles ----------------------------------------------------------------------

test("R1 in a new account a Role column is asked about with nothing chosen, and new roles are created only when picked", async ({ create }) => {
  const owner = await create();
  const file: Buffer = xlsx([
    ["Name", "LinkedIn", "Role"],
    ["Ann Test", "linkedin.com/in/ann-r1", "ML Engineer"],
    ["Bob Test", "linkedin.com/in/bob-r1", "ML Engineer"],
    ["Cy Test", "linkedin.com/in/cy-r1", "Data Lead"],
  ]);
  await choose(owner.page, file, "pipeline.xlsx");
  const question = owner.page.getByRole("group", { name: /What does the .Role. column mean/ });
  await expect(question).toBeVisible();
  for (const radio of await question.getByRole("radio").all()) await expect(radio).not.toBeChecked();
  await expect(owner.page.getByRole("button", { name: "Answer 1 question to import" })).toBeDisabled();
  await question.getByLabel(/role each person is being considered for/).click();
  await expect(owner.page.getByLabel("Role for ML Engineer")).toHaveValue("none");
  await expect(owner.page.getByLabel("Role for Data Lead")).toHaveValue("none");
  await owner.page.getByLabel("Role for ML Engineer").selectOption("create");
  await expect(owner.page.locator('[data-count="roles"]')).toHaveText("2");
  await importNow(owner.page);
  await expect(owner.page.getByRole("heading", { name: "Imported 3 people" })).toBeVisible();
  const roles = await db.role.findMany({ where: { userId: owner.id }, include: { candidates: { orderBy: { fullName: "asc" } } } });
  expect(roles.map((role) => [role.title, role.candidates.map((c) => [c.fullName, c.stage])])).toEqual([["ML Engineer", [["Ann Test", "sourced"], ["Bob Test", "sourced"]]]]);
  expect(roles[0].importBatchId).not.toBeNull();
  expect(await db.person.count({ where: { userId: owner.id, fullName: "Cy Test", candidates: { none: {} } } })).toBe(1);
});

test("R2 role names matching the account's open roles are used without a question, and nobody is put on a role twice", async ({ create }) => {
  const owner = await create();
  const role = await db.role.create({ data: { userId: owner.id, title: "Platform Lead" } });
  await db.role.create({ data: { userId: owner.id, title: "Old Role", status: "closed" } });
  const kim = await db.person.create({ data: { userId: owner.id, fullName: "Kim Test", profileUrl: "https://www.linkedin.com/in/kim-r2", searchText: "kim test" } });
  await db.candidate.create({ data: { roleId: role.id, fullName: "Kim Test", personId: kim.id, profileUrl: kim.profileUrl } });
  const file: Buffer = xlsx([
    ["Name", "LinkedIn", "Role"],
    ["Kim Test", "linkedin.com/in/kim-r2", "platform lead"],
    ["Lou Test", "linkedin.com/in/lou-r2", "Platform  Lead"],
    ["Max Test", "linkedin.com/in/max-r2", "Old Role"],
  ]);
  await choose(owner.page, file);
  await expect(owner.page.getByRole("group", { name: /What does the/ })).toHaveCount(0);
  await expect(owner.page.getByText(/.Role. read as the role each person is considered for/)).toBeVisible();
  await expect(owner.page.getByText("Added to your roles: platform lead (2)")).toBeVisible();
  await expect(owner.page.getByLabel("Role for Old Role")).toHaveValue("none");
  await importNow(owner.page);
  await expect(owner.page.getByRole("heading", { name: "Imported 2 people" })).toBeVisible();
  const onRole = await db.candidate.findMany({ where: { roleId: role.id }, orderBy: { fullName: "asc" } });
  expect(onRole.map((c) => c.fullName)).toEqual(["Kim Test", "Lou Test"]);
  expect(await db.role.count({ where: { userId: owner.id } })).toBe(2);
});

test("R3 a Role column answered as job titles creates no roles and fills the headline", async ({ create }) => {
  const owner = await create();
  await choose(owner.page, xlsx([["Name", "Email", "Role"], ["Nia Test", "nia@example.test", "CTO at Acme"], ["Oz Test", "oz@example.test", "Head of Data"]]));
  await owner.page.getByRole("group", { name: /What does the/ }).getByLabel("Their current job title").click();
  await expect(owner.page.getByText(/.Role. read as their current job title/)).toBeVisible();
  await importNow(owner.page);
  await expect(owner.page.getByRole("heading", { name: "Imported 2 people" })).toBeVisible();
  expect(await db.role.count({ where: { userId: owner.id } })).toBe(0);
  expect((await db.person.findMany({ where: { userId: owner.id }, orderBy: { fullName: "asc" } })).map((p) => p.headline)).toEqual(["CTO at Acme", "Head of Data"]);
});

// ---- the recruiter's own corrections ---------------------------------------------

test("M1 an odd file is read sensibly, each reading can be turned off, and any row can be left out", async ({ create }) => {
  const owner = await create();
  const file = Buffer.from('Our candidates\n\nName,Email,Phone\n"SMITH, Jane",jane@example.test,0777\n"LEE, Tom",tom@example.test,0788\n"WU, Amy",amy@example.test,\n');
  await choose(owner.page, file, "odd.csv");
  await expect(owner.page.getByRole("heading", { name: "3 people will be added" })).toBeVisible();
  await expect(owner.page.getByText("Jane Smith, Tom Lee, Amy Wu")).toBeVisible();
  await expect(owner.page.getByText("Headings found on row 3; the row above was skipped")).toBeVisible();
  await expect(owner.page.getByText("Kept in each person's note: Phone")).toBeVisible();
  await expect(owner.page.getByText(/Names like .SMITH, Jane. are written .Jane Smith./)).toBeVisible();
  await owner.page.getByRole("button", { name: "Keep as written" }).click();
  await expect(owner.page.getByText("SMITH, Jane, LEE, Tom, WU, Amy")).toBeVisible();
  await owner.page.getByRole("button", { name: "Tidy them" }).click();
  await expect(owner.page.getByText("Jane Smith, Tom Lee, Amy Wu")).toBeVisible();
  await owner.page.getByText("Check every row (3)").click();
  await owner.page.getByLabel("Import row 5").uncheck();
  await expect(owner.page.getByRole("heading", { name: "2 people will be added" })).toBeVisible();
  await expect(owner.page.locator('[data-count="excluded"]')).toHaveText("1");
  await importNow(owner.page);
  await expect(owner.page.getByRole("heading", { name: "Imported 2 people" })).toBeVisible();
  const people = await db.person.findMany({ where: { userId: owner.id }, include: { notes: true }, orderBy: { fullName: "asc" } });
  expect(people.map((p) => p.fullName), "row 5 (Tom) was left out").toEqual(["Amy Wu", "Jane Smith"]);
  expect(people[1].notes.map((n) => n.body)).toContain("Also in the file:\nPhone: 0777");
});

// ---- afterwards -------------------------------------------------------------------

test("U1 an import can be undone; people worked on since are kept and named, and do-not-contact stays", async ({ create }) => {
  const owner = await create();
  const existing = await db.person.create({ data: { userId: owner.id, fullName: "Pat Test", profileUrl: "https://www.linkedin.com/in/pat-u1", searchText: "pat test" } });
  const file: Buffer = xlsx([
    ["Name", "LinkedIn", "Vacancy", "Location", "DNC"],
    ["Ray Test", "linkedin.com/in/ray-u1", "Undo Role", "Leeds", ""],
    ["Sue Test", "linkedin.com/in/sue-u1", "Undo Role", "York", ""],
    ["Pat Test", "linkedin.com/in/pat-u1", "", "Hull", "yes"],
  ]);
  await choose(owner.page, file, "undo.xlsx");
  await owner.page.getByLabel("Role for Undo Role").selectOption("create");
  await owner.page.getByLabel(/Also fill empty headline/).check();
  await importNow(owner.page);
  await expect(owner.page.getByRole("heading", { name: "Imported 2 people" })).toBeVisible();
  expect(await db.person.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ location: "Hull", doNotContact: true });

  // Sue is contacted after the import, so undo leaves her where she is.
  const sue = await db.person.findFirstOrThrow({ where: { userId: owner.id, fullName: "Sue Test" }, include: { candidates: true } });
  await db.candidate.update({ where: { id: sue.candidates[0].id }, data: { stage: "contacted" } });

  await owner.page.getByRole("button", { name: "Undo import" }).click();
  await expect(owner.page.getByText(/This removes the 2 people and 1 role this import added/)).toBeVisible();
  await owner.page.getByRole("button", { name: "Undo import" }).click();
  await expect(owner.page.getByText("Import undone.")).toBeVisible();
  await expect(owner.page.getByText("Kept because you have worked with them since: Sue Test.")).toBeVisible();

  expect(await db.person.count({ where: { userId: owner.id, fullName: "Ray Test" } })).toBe(0);
  expect(await db.person.count({ where: { userId: owner.id, fullName: "Sue Test" } })).toBe(1);
  expect(await db.role.count({ where: { userId: owner.id, title: "Undo Role" } }), "the role keeps Sue, so it stays").toBe(1);
  expect(await db.person.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ location: null, doNotContact: true });
  expect(await db.suppression.count({ where: { userId: owner.id } }), "undo is not erasure").toBe(0);
  expect(await db.auditEvent.count({ where: { actorId: owner.id, action: "people.import_undone" } })).toBe(1);
  expect((await db.importBatch.findFirstOrThrow({ where: { userId: owner.id } })).undoneAt).not.toBeNull();
});

test("U2 People offers the undo for a week, then stops; an undone import cannot be undone again", async ({ create }) => {
  const owner = await create();
  await choose(owner.page, xlsx([HEADER, ["Vic Test", "linkedin.com/in/vic-u2", "", "", "", "", "", ""]]), "week.xlsx");
  await importNow(owner.page);
  await expect(owner.page.getByRole("heading", { name: "Imported 1 person" })).toBeVisible();
  await owner.page.goto("/people");
  await expect(owner.page.getByText(/Imported 1 person from week.xlsx/)).toBeVisible();
  const batch = await db.importBatch.findFirstOrThrow({ where: { userId: owner.id } });
  await db.importBatch.update({ where: { id: batch.id }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
  await owner.page.reload();
  await expect(owner.page.getByText(/Imported 1 person from week.xlsx/)).toHaveCount(0);
  await db.importBatch.update({ where: { id: batch.id }, data: { createdAt: new Date() } });
  await owner.page.reload();
  await owner.page.getByRole("button", { name: "Undo import" }).click();
  await owner.page.getByRole("button", { name: "Undo import" }).click();
  await expect(owner.page.getByText("Import undone.")).toBeVisible();
  expect(await db.person.count({ where: { userId: owner.id } })).toBe(0);
  await owner.page.reload();
  await expect(owner.page.getByRole("button", { name: "Undo import" })).toHaveCount(0);
});

test("U3 another account's import cannot be undone, and a read-only view is offered no undo", async ({ create }) => {
  const owner = await create();
  const other = await create();
  await choose(owner.page, xlsx([HEADER, ["Wes Test", "linkedin.com/in/wes-u3", "", "", "", "", "", ""]]), "mine.xlsx");
  await importNow(owner.page);
  await expect(owner.page.getByRole("heading", { name: "Imported 1 person" })).toBeVisible();
  const batch = await db.importBatch.findFirstOrThrow({ where: { userId: owner.id } });
  // The other account sees no undo for it, and sending the owner's batch id
  // through its own undo form (the real server action) finds nothing.
  await other.page.goto("/people");
  await expect(other.page.getByRole("button", { name: "Undo import" })).toHaveCount(0);
  await choose(other.page, xlsx([HEADER, ["Xia Test", "linkedin.com/in/xia-u3", "", "", "", "", "", ""]]), "theirs.xlsx");
  await importNow(other.page);
  await expect(other.page.getByRole("heading", { name: "Imported 1 person" })).toBeVisible();
  await other.page.getByRole("button", { name: "Undo import" }).click();
  await other.page.locator('input[name="batchId"]').evaluate((input, id) => { (input as HTMLInputElement).value = id; }, batch.id);
  await other.page.getByRole("button", { name: "Undo import" }).click();
  await expect(other.page.locator("p[role=alert]")).toContainText("can no longer be undone");
  expect(await db.person.count({ where: { userId: owner.id } })).toBe(1);
  expect((await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).undoneAt).toBeNull();
  expect(await db.person.count({ where: { userId: other.id } }), "their own import is untouched too").toBe(1);
  const admin = await create("admin");
  await db.session.update({ where: { tokenHash: admin.session }, data: { viewUserId: owner.id } });
  await admin.page.goto("/people");
  await expect(admin.page.getByRole("button", { name: "Undo import" })).toHaveCount(0);
});

test("I5 files that cannot be read are refused with a plain message, focus goes to it, and nothing is written", async ({ create }) => {
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
    await expect(owner.page.locator("p[role=alert]")).toBeFocused();
  }
  expect(await db.person.count({ where: { userId: owner.id } })).toBe(0);
});

test("I6 an imported person is not cleaned up when their only role is removed", async ({ create }) => {
  const owner = await create();
  await choose(owner.page, xlsx([HEADER, ["Fay Test", "linkedin.com/in/fay-test", "", "", "", "", "", ""]]));
  await importNow(owner.page);
  await expect(owner.page.getByRole("heading", { name: "Imported 1 person" })).toBeVisible();
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

test("I7 a read-only view of someone else's workspace cannot import", async ({ create }) => {
  const admin = await create("admin");
  const target = await create();
  await db.session.update({ where: { tokenHash: admin.session }, data: { viewUserId: target.id } });
  await admin.page.goto("/people");
  await expect(admin.page.getByRole("link", { name: "Import people" })).toHaveCount(0);
  await admin.page.goto("/people/import");
  await expect(admin.page.locator("#people-file")).toHaveCount(0);
  await expect(admin.page.getByText("Return to your own workspace")).toBeVisible();
});

test("I8 on a phone the page does not scroll sideways and the import button stays reachable", async ({ create }) => {
  const owner = await create();
  await owner.page.setViewportSize({ width: 375, height: 700 });
  await owner.page.goto("/people");
  await owner.page.getByRole("link", { name: "Import people" }).first().click();
  await expect(owner.page.getByRole("heading", { name: "Import people" })).toBeVisible();
  const rows = Array.from({ length: 40 }, (_, i) => [`Person ${i} Test`, `linkedin.com/in/person-${i}`, "A very long headline that goes on and on to test wrapping", "Leeds", "", "", "", ""]);
  await owner.page.locator("#people-file").setInputFiles({ name: "many.xlsx", mimeType: XLSX, buffer: xlsx([HEADER, ...rows, ["", "", "", "", "", "", "", ""], ["Dup", "linkedin.com/in/person-1", "", "", "", "", "", ""]]) });
  await expect(owner.page.getByRole("heading", { name: "40 people will be added" })).toBeVisible();
  await owner.page.getByRole("button", { name: "Change columns" }).click();
  await expect(owner.page.getByLabel("Import column Name as")).toBeVisible();
  const overflow = await owner.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow, "no sideways scroll").toBe(false);
  const button = owner.page.getByRole("button", { name: IMPORT_BUTTON });
  const box = await button.boundingBox();
  expect(box && box.y + box.height <= 700, "the commit bar sticks to the bottom of the screen").toBe(true);
});

test("I9 the disabled import button is readable", async ({ create }) => {
  const owner = await create();
  await choose(owner.page, xlsx([HEADER, ["Hal Test", "linkedin.com/in/hal-test", "", "", "", "", "", ""]]));
  const button = owner.page.getByRole("button", { name: IMPORT_BUTTON });
  await expect(button).toBeDisabled();
  const ratio = await button.evaluate((el) => {
    const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = ([r, g, b]: number[]) => 0.2126 * ((r / 255) ** 2.2) + 0.7152 * ((g / 255) ** 2.2) + 0.0722 * ((b / 255) ** 2.2);
    const style = getComputedStyle(el);
    const a = lum(channels(style.color));
    const b = lum(channels(style.backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(ratio).toBeGreaterThan(4.5);
});
