import { test, expect, type Browser } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db, TEST_ADMIN_ID } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";

// Notes kept on a person for good, written on their page or saved from a
// screening call; and importing a meeting note from Notion through OAuth.
// Notion is the local stub (tests/anthropic-stub.mjs); fictional people and
// the disposable database only.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const STUB = "http://localhost:8766";
const PAGE_ID = "11111111-1111-4111-8111-111111111111";
let roleId = "";

async function stub(state: Record<string, unknown>) {
  return (await fetch(`${STUB}/__notion`, { method: "POST", body: JSON.stringify(state) })).json();
}

async function makeCandidate(fullName: string, withPerson = true) {
  const person = withPerson ? await db.person.create({ data: { userId: TEST_ADMIN_ID, fullName, searchText: fullName.toLowerCase() } }) : null;
  return db.candidate.create({ data: { roleId, fullName, personId: person?.id ?? null, stage: "booked" } });
}

async function basicPage(browser: Browser) {
  const user = await db.user.create({ data: {
    email: `notes-basic-${randomUUID()}@test.capture.invalid`, name: "Basic Recruiter", role: "recruiter", accountTier: "basic",
    settings: { create: { seenRelease: CURRENT_RELEASE } },
  } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  return { user, page: await context.newPage(), close: () => context.close() };
}

test.beforeAll(async () => {
  await stub({ decline: false, expireAccess: false, fail: false, tokenRequests: [], versions: [] });
  await db.integrationConnection.deleteMany({ where: { userId: TEST_ADMIN_ID } });
  roleId = (await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Notes Test Lead", client: "Halden Systems" } })).id;
});

test.afterAll(async () => {
  await db.integrationConnection.deleteMany({ where: { userId: TEST_ADMIN_ID } });
});

test("N1 a note written on a person's page stays, newest first, and can be deleted", async ({ page }) => {
  const candidate = await makeCandidate("Perpetua Langridge");
  await page.goto(`/people/${candidate.personId}`, { timeout: 90_000 });
  const notes = page.getByRole("region", { name: /Notes/ });
  await expect(notes.getByText("No notes yet.")).toBeVisible();
  await notes.getByRole("button", { name: "Save note" }).click();
  await expect(notes.locator('[data-form-message="error"]')).toContainText("Write the note first");

  await notes.getByLabel("New note").fill("Prefers calls after 4pm.");
  await notes.getByRole("button", { name: "Save note" }).click();
  await expect(notes.locator('[data-form-message="notice"]')).toContainText("Note saved");
  await expect(notes.getByLabel("New note")).toHaveValue("");
  await notes.getByLabel("New note").fill("Has a counter-offer from her current employer.\n\n  Ask about it next time.  ");
  await notes.getByRole("button", { name: "Save note" }).click();
  await expect(notes.locator("ol.person-notes > li")).toHaveCount(2);
  await expect(notes.locator("ol.person-notes > li").first()).toContainText("Has a counter-offer");
  const stored = await db.personNote.findMany({ where: { personId: candidate.personId! }, orderBy: { createdAt: "asc" } });
  expect(stored.map((note) => note.body)).toEqual(["Prefers calls after 4pm.", "Has a counter-offer from her current employer.\n\n  Ask about it next time."]);

  page.once("dialog", (dialog) => dialog.accept());
  await notes.locator("ol.person-notes > li").first().getByRole("button", { name: "Delete" }).click();
  await expect(notes.locator("ol.person-notes > li")).toHaveCount(1);
  expect(await db.personNote.count({ where: { personId: candidate.personId! } })).toBe(1);
});

test("N2 a screening note saved to their record is kept on the person, with the role, and no screening is made", async ({ page }) => {
  const candidate = await makeCandidate("Octavian Fairweather");
  await page.goto(`/candidates/${candidate.id}/screening`);
  await page.getByRole("button", { name: "Add meeting note or transcript" }).click();
  await page.getByLabel("Transcript or notes").fill("Quick call. Not looking until the new year.");
  await page.getByLabel(/Don.t keep the transcript in Capture/).check();
  await expect(page.getByRole("button", { name: "Save to their record" })).toBeDisabled();
  await page.getByLabel(/Don.t keep the transcript in Capture/).uncheck();
  await page.getByRole("button", { name: "Save to their record" }).click();
  await expect(page.locator('[data-form-message="notice"]')).toContainText("Saved to Octavian's record. It stays there until you delete it.");
  await expect(page.getByLabel("Transcript or notes")).toBeHidden();
  await expect(page.getByRole("button", { name: "Add meeting note or transcript" })).toBeVisible();
  expect(await db.screening.count({ where: { candidateId: candidate.id } })).toBe(0);
  const note = await db.personNote.findFirstOrThrow({ where: { personId: candidate.personId! } });
  expect(note).toMatchObject({ body: "Quick call. Not looking until the new year.", candidateId: candidate.id });

  await page.goto(`/people/${candidate.personId}`);
  const kept = page.getByRole("region", { name: /Notes/ }).locator("ol.person-notes > li");
  await expect(kept).toHaveCount(1);
  await expect(kept).toContainText("Notes Test Lead");

  // Someone saved before people existed has nowhere to keep it.
  const orphan = await makeCandidate("Unlinked Candidate", false);
  await page.goto(`/candidates/${orphan.id}/screening`);
  await page.getByRole("button", { name: "Add meeting note or transcript" }).click();
  await page.getByLabel("Transcript or notes").fill("A note with nowhere to go.");
  await page.getByRole("button", { name: "Save to their record" }).click();
  await expect(page.locator('[data-form-message="error"]')).toContainText("no person record yet");
});

test("N3 Notion is connected with its own logo, a refusal connects nothing, and a page imports as text", async ({ page }) => {
  const candidate = await makeCandidate("Imogen Achterberg-Vale");
  await page.goto(`/candidates/${candidate.id}/screening`);
  const connect = page.getByRole("link", { name: "Connect Notion" });
  await expect(connect).toBeVisible();
  await expect(connect.locator(".notion-logo svg")).toBeVisible();

  await stub({ decline: true });
  await connect.click();
  await expect(page).toHaveURL(new RegExp(`/candidates/${candidate.id}/screening\\?notion=declined$`));
  await expect(page.getByText("Notion was not connected.")).toBeVisible();
  expect(await db.integrationConnection.count({ where: { userId: TEST_ADMIN_ID } })).toBe(0);

  await stub({ decline: false });
  await page.getByRole("link", { name: "Connect Notion" }).click();
  await expect(page).toHaveURL(/notion=connected$/);
  const connection = await db.integrationConnection.findUniqueOrThrow({ where: { userId_provider: { userId: TEST_ADMIN_ID, provider: "notion" } } });
  expect(connection.label).toBe("Morven's Notion");
  expect(connection.tokenCipher).not.toContain("stub-notion");
  expect(await db.auditEvent.count({ where: { actorId: TEST_ADMIN_ID, action: "notion.connected" } })).toBe(1);

  // Coming back from Notion opens the picker on the pages it shared.
  const picker = page.locator("#notion-picker");
  await expect(picker.getByText("Your Notion pages in Morven's Notion")).toBeVisible();
  await expect(picker.getByRole("button", { name: /Weekly planning/ })).toBeVisible();
  await picker.getByLabel(/Your Notion pages/).fill("imogen");
  await expect(picker.getByRole("button", { name: /Weekly planning/ })).toHaveCount(0);
  await picker.getByRole("button", { name: /Call with Imogen Achterberg/ }).click();

  const box = page.getByLabel("Transcript or notes");
  await expect(box).toBeVisible();
  await expect(page.getByText('Imported "Call with Imogen Achterberg" from Notion.')).toBeVisible();
  const imported = await box.inputValue();
  expect(imported).toBe([
    "Call with Imogen Achterberg",
    "",
    "## Screening call",
    "Spoke for twenty minutes.",
    "- Open to hybrid in Leeds",
    "[x] Send the job spec",
    "More detail",
    "  Four weeks notice.",
    "# Imogen call",
    "",
    "## Summary",
    "Wants around 90k.",
    "",
    "## Transcript",
    "Morven Ellis: What are you looking for on salary?",
    "Imogen Achterberg: I'd be looking for something around 85 to 95 thousand base.",
  ].join("\n"));
  const state = await stub({});
  expect(state.versions.every((version: string) => version === "2026-03-11")).toBe(true);
  expect(state.tokenRequests.every((request: { basicOk: boolean }) => request.basicOk)).toBe(true);
});

test("N4 an expired Notion token is refreshed once and kept encrypted", async ({ page }) => {
  const before = (await db.integrationConnection.findUniqueOrThrow({ where: { userId_provider: { userId: TEST_ADMIN_ID, provider: "notion" } } })).tokenCipher;
  await stub({ expireAccess: true, tokenRequests: [] });
  const response = await page.request.get(`${BASE}/api/notion/pages?q=`);
  expect(response.status()).toBe(200);
  expect((await response.json()).pages).toHaveLength(2);
  expect((await stub({})).tokenRequests.map((request: { grant: string }) => request.grant)).toEqual(["refresh_token"]);
  const after = (await db.integrationConnection.findUniqueOrThrow({ where: { userId_provider: { userId: TEST_ADMIN_ID, provider: "notion" } } })).tokenCipher;
  expect(after).not.toBe(before);
  expect(after).not.toContain("stub-notion");
  await stub({ expireAccess: false });
});

test("N5 forged replies, read-only views, Basic accounts and odd ids get nothing; Settings disconnects", async ({ page, browser }) => {
  await page.goto("/api/notion/callback?code=stub-notion-code&state=forged.notion.1.x.y");
  await expect(page).toHaveURL(/notion=failed/);
  expect((await page.request.get(`${BASE}/api/notion/pages/not-a-page-id`)).status()).toBe(404);

  const basic = await basicPage(browser);
  try {
    expect((await basic.page.request.get(`${BASE}/api/notion/pages?q=`)).status()).toBe(404);
    expect((await basic.page.request.get(`${BASE}/api/notion/connect`, { maxRedirects: 0 })).status()).toBe(404);
    // A Basic account still keeps notes on its own people.
    const person = await db.person.create({ data: { userId: basic.user.id, fullName: "Basil Notekeeper", searchText: "basil" } });
    await basic.page.goto(`/people/${person.id}`, { timeout: 90_000 });
    await basic.page.getByLabel("New note").fill("Met at the meetup.");
    await basic.page.getByRole("button", { name: "Save note" }).click();
    await expect(basic.page.locator('[data-form-message="notice"]')).toContainText("Note saved");
    // ...and cannot reach the admin's notes.
    const adminNote = await db.personNote.findFirstOrThrow({ where: { person: { userId: TEST_ADMIN_ID } } });
    expect((await basic.page.goto(`/people/${adminNote.personId}`))?.status()).toBe(404);
  } finally {
    await basic.close();
  }

  const other = await db.user.create({ data: { email: `notes-other-${randomUUID()}@test.capture.invalid`, name: "Other Recruiter", role: "recruiter", accountTier: "pro", settings: { create: {} } } });
  const otherPerson = await db.person.create({ data: { userId: other.id, fullName: "Viewed Person", searchText: "viewed" } });
  await db.personNote.create({ data: { personId: otherPerson.id, body: "Their own note." } });
  const session = process.env.CAPTURE_TEST_SESSION_TOKEN!;
  await db.session.update({ where: { tokenHash: hashToken(session) }, data: { viewUserId: other.id } });
  try {
    await page.goto(`/people/${otherPerson.id}`);
    await expect(page.getByText("Their own note.")).toBeVisible();
    await expect(page.getByLabel("New note")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
    expect((await page.request.get(`${BASE}/api/notion/pages?q=`)).status()).toBe(403);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /Connected apps/ })).toHaveCount(0);
  } finally {
    await db.session.update({ where: { tokenHash: hashToken(session) }, data: { viewUserId: null } });
  }

  await page.goto("/settings");
  const apps = page.getByRole("region", { name: /Connected apps/ });
  await expect(apps.getByText("Connected to Morven's Notion on")).toBeVisible();
  await expect(apps.locator(".notion-logo svg").first()).toBeVisible();
  await apps.getByRole("button", { name: "Disconnect" }).click();
  await expect(apps.getByText("Not connected.")).toBeVisible();
  expect(await db.integrationConnection.count({ where: { userId: TEST_ADMIN_ID } })).toBe(0);
  expect(await db.auditEvent.count({ where: { actorId: TEST_ADMIN_ID, action: "notion.disconnected" } })).toBe(1);
});
