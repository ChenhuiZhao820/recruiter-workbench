import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db, TEST_ADMIN_ID } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { newNonce } from "../lib/shortlist-core.mjs";

// "Only these people": each named person has their own link and opens it by
// typing the address it was sent to, once per browser. Fictional people and
// the disposable test database only; guest contexts carry no session.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const ANA = "ana.ruiz@halden.example";
const BEN = "ben.okoro@halden.example";
let roleId = "";
let shortlistId = "";

async function guest(browser: Browser) {
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  return { page: await context.newPage(), context, close: () => context.close() };
}

async function panel(page: Page) {
  await page.getByRole("tab", { name: /^Client link/ }).click();
  return page.locator("div.client-link");
}

async function linkFor(page: Page, email: string) {
  const row = (await panel(page)).getByRole("list", { name: "People it is shared with" }).locator("li", { hasText: email });
  return row.locator(".client-link-address input").inputValue();
}

async function open(page: Page, link: string, email: string) {
  await page.goto(link);
  await page.getByLabel("Your email address").fill(email);
  await page.getByRole("button", { name: "Open the page" }).click();
}

test.beforeAll(async () => {
  const role = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Named Access Test Lead", client: "Halden Systems" } });
  roleId = role.id;
  await db.settings.update({ where: { userId: TEST_ADMIN_ID }, data: { recruiterName: "Morven Ellis" } });
  const person = await db.person.create({ data: { userId: TEST_ADMIN_ID, fullName: "Ines Valente", headline: "Platform lead", searchText: "ines valente platform lead" } });
  const candidate = await db.candidate.create({ data: { roleId, fullName: "Ines Valente", personId: person.id, stage: "submitted", submittedAt: new Date() } });
  const shortlist = await db.shortlist.create({ data: {
    userId: TEST_ADMIN_ID, kind: "role", roleId, title: role.title, client: role.client, access: "link",
    accesses: { create: { nonce: newNonce() } },
    items: { create: { personId: person.id, candidateId: candidate.id, consentAt: new Date() } },
  } });
  shortlistId = shortlist.id;
});

test("N1 a page shared with named people: the public link stops, each person opens their own by confirming the address", async ({ browser, page }, testInfo) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`/roles/${roleId}`);
  const publicLink = await (await panel(page)).locator(".client-link-address input").inputValue();

  await (await panel(page)).getByRole("button", { name: "Only these people" }).click();
  await expect((await panel(page)).getByText("No one yet. Add the people at Halden Systems who should see it.")).toBeVisible();
  const add = (await panel(page)).getByLabel(/Add people by email/);
  await add.fill(`${ANA}, not-an-email`);
  await (await panel(page)).getByRole("button", { name: "Add", exact: true }).click();
  await expect((await panel(page)).locator('[data-form-message="error"]')).toContainText("not-an-email is not an email address");
  await add.fill(`${ANA}\n${BEN}`);
  await (await panel(page)).getByRole("button", { name: "Add", exact: true }).click();
  await expect((await panel(page)).getByText(BEN, { exact: true })).toBeVisible();
  await expect((await panel(page)).getByRole("link", { name: `Open in email to ${ANA}` })).toHaveAttribute("href", new RegExp(`^mailto:${ANA.replace(/\./g, "\\.")}\\?subject=`));
  const anaLink = await linkFor(page, ANA);
  const benLink = await linkFor(page, BEN);
  expect(anaLink).not.toBe(benLink);
  await (await panel(page)).screenshot({ path: testInfo.outputPath("named-panel.png") });

  const client = await guest(browser);
  try {
    await client.page.goto(publicLink);
    await expect(client.page.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();

    // Nothing about the candidates or the client before the address is confirmed.
    await client.page.goto(anaLink);
    await expect(client.page.getByRole("heading", { name: "Confirm it is you" })).toBeVisible();
    await client.page.screenshot({ path: testInfo.outputPath("named-gate.png"), fullPage: true });
    const gate = await client.page.content();
    for (const hidden of ["Ines Valente", "Halden", "Named Access Test Lead"]) expect(gate).not.toContain(hidden);

    await client.page.getByLabel("Your email address").fill(BEN);
    await client.page.getByRole("button", { name: "Open the page" }).click();
    await expect(client.page.locator('[data-form-message="error"]')).toContainText("That is not the address this link was sent to");
    await client.page.getByLabel("Your email address").fill(` ${ANA.toUpperCase()} `);
    await client.page.getByRole("button", { name: "Open the page" }).click();
    await expect(client.page.getByRole("heading", { level: 2, name: "Ines Valente" })).toBeVisible();
    await client.page.reload();
    await expect(client.page.getByRole("heading", { level: 2, name: "Ines Valente" })).toBeVisible();

    // The cookie belongs to Ana's link only: Ben's asks again in the same browser.
    await client.page.goto(benLink);
    await expect(client.page.getByRole("heading", { name: "Confirm it is you" })).toBeVisible();
    const cookies = await client.context.cookies();
    expect(cookies.filter((cookie) => cookie.name === "capture_shortlist_gate").map((cookie) => cookie.path)).toEqual([new URL(anaLink).pathname]);

    // Her answer is credited to her on the role page.
    await client.page.goto(anaLink);
    await client.page.getByRole("button", { name: "Interview Ines" }).click();
    await expect(client.page.getByText("You asked to meet Ines.")).toBeVisible();
  } finally {
    await client.close();
  }
  await page.goto(`/roles/${roleId}`);
  await expect(page.locator("li.card", { hasText: "Ines Valente" }).getByText(`Halden Systems wants to meet · ${ANA}`)).toBeVisible();
  const anaRow = (await panel(page)).getByRole("list", { name: "People it is shared with" }).locator("li", { hasText: ANA });
  await expect(anaRow.getByText(/Opened/)).toBeVisible();
  await expect((await panel(page)).getByRole("list", { name: "People it is shared with" }).locator("li", { hasText: BEN }).getByText("Not opened yet")).toBeVisible();
  // Recipients are never exported.
  expect(await (await page.request.get(`${BASE}/api/export?format=json`)).text()).not.toContain(ANA);
});

test("N2 removing a person closes their link even in a browser that had confirmed it; going public closes every named link", async ({ browser, page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`/roles/${roleId}`);
  const anaLink = await linkFor(page, ANA);
  const benLink = await linkFor(page, BEN);
  const client = await guest(browser);
  try {
    await open(client.page, benLink, BEN);
    await expect(client.page.getByRole("heading", { level: 2, name: "Ines Valente" })).toBeVisible();

    const benRow = (await panel(page)).getByRole("list", { name: "People it is shared with" }).locator("li", { hasText: BEN });
    await benRow.getByRole("button", { name: "Remove" }).click();
    await expect((await panel(page)).getByText(BEN, { exact: true })).toHaveCount(0);
    await client.page.reload();
    await expect(client.page.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();

    await (await panel(page)).getByRole("button", { name: "Anyone with the link" }).click();
    await expect((await panel(page)).getByRole("list", { name: "People it is shared with" })).toHaveCount(0);
    const publicLink = await (await panel(page)).locator(".client-link-address input").inputValue();
    await client.page.goto(anaLink);
    await expect(client.page.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();
    await client.page.goto(publicLink);
    await expect(client.page.getByRole("heading", { level: 2, name: "Ines Valente" })).toBeVisible();
  } finally {
    await client.close();
  }
  expect(await db.shortlistAccess.count({ where: { shortlistId, email: { not: null }, revokedAt: null } })).toBe(0);
});

test("N3 wrong addresses are throttled per link", async ({ browser, page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`/roles/${roleId}`);
  await (await panel(page)).getByRole("button", { name: "Only these people" }).click();
  await (await panel(page)).getByLabel(/Add people by email/).fill(BEN);
  await (await panel(page)).getByRole("button", { name: "Add", exact: true }).click();
  const benLink = await linkFor(page, BEN);
  const client = await guest(browser);
  try {
    await client.page.goto(benLink);
    for (let attempt = 0; attempt < 10; attempt++) {
      await client.page.getByLabel("Your email address").fill(`guess${attempt}@halden.example`);
      await client.page.getByRole("button", { name: "Open the page" }).click();
      await expect(client.page.locator('[data-form-message="error"]')).toContainText("That is not the address");
    }
    await client.page.getByLabel("Your email address").fill(BEN);
    await client.page.getByRole("button", { name: "Open the page" }).click();
    await expect(client.page.locator('[data-form-message="error"]')).toContainText("Too many tries");
  } finally {
    await client.close();
  }
});

test("N4 a named-only shortlist never grows a public link: closing and reopening replaces each person's link", async ({ browser, page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  const person = await db.person.findFirstOrThrow({ where: { fullName: "Ines Valente", userId: TEST_ADMIN_ID } });
  const custom = await db.shortlist.create({ data: {
    userId: TEST_ADMIN_ID, kind: "custom", title: `Named custom ${randomUUID().slice(0, 6)}`, client: "Halden Systems", access: "people",
    expiresAt: new Date(Date.now() + 30 * 86_400_000), accesses: { create: { email: ANA, nonce: newNonce() } },
    items: { create: { personId: person.id, consentAt: new Date() } },
  } });
  await page.goto(`/shortlists?open=${custom.id}`);
  const row = page.locator("details.shortlist-row", { has: page.locator(".shortlist-row-title", { hasText: custom.title }) });
  const before = await row.getByRole("list", { name: "People it is shared with" }).locator(".client-link-address input").inputValue();
  await row.getByRole("button", { name: "Close the link" }).click();
  await row.locator("summary").first().click().catch(() => {});
  await page.goto(`/shortlists?open=${custom.id}`);
  await row.getByRole("button", { name: "Reopen" }).click();
  await expect(row.getByRole("list", { name: "People it is shared with" }).locator(".client-link-address input")).not.toHaveValue(before);
  const after = await row.getByRole("list", { name: "People it is shared with" }).locator(".client-link-address input").inputValue();
  expect(await db.shortlistAccess.count({ where: { shortlistId: custom.id, email: null } })).toBe(0);

  const client = await guest(browser);
  try {
    await client.page.goto(before);
    await expect(client.page.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();
    await open(client.page, after, ANA);
    await expect(client.page.getByRole("heading", { level: 1, name: custom.title })).toBeVisible();
  } finally {
    await client.close();
  }
});

test("N5 a read-only view shows who it is shared with, but no links and nothing to change", async ({ page }) => {
  const other = await db.user.create({ data: { email: `named-other-${randomUUID()}@test.capture.invalid`, name: "Other Recruiter", role: "recruiter", accountTier: "basic", settings: { create: {} } } });
  const role = await db.role.create({ data: { userId: other.id, title: "Their Named Role", client: "Elsewhere" } });
  await db.shortlist.create({ data: { userId: other.id, kind: "role", roleId: role.id, title: role.title, client: role.client, access: "people", accesses: { create: { email: "someone@elsewhere.example", nonce: newNonce() } } } });
  const token = process.env.CAPTURE_TEST_SESSION_TOKEN!;
  await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: other.id } });
  try {
    await page.goto(`/roles/${role.id}`);
    const details = await panel(page);
    await expect(details.getByText("someone@elsewhere.example", { exact: true })).toBeVisible();
    await expect(details.locator(".client-link-address")).toHaveCount(0);
    await expect(details.getByRole("button", { name: "Anyone with the link" })).toBeDisabled();
    await expect(details.getByRole("button", { name: "Remove" })).toBeDisabled();
  } finally {
    await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: null } });
  }
});
