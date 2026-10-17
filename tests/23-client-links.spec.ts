import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db, TEST_ADMIN_ID } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { shortlistToken } from "../lib/shortlist-core.mjs";

// Client links: a role's candidates put forward on one page the client opens
// without signing in. Fictional people and the disposable test database only;
// the second browser context plays the client and carries no session.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const SECRET = "test-only-shortlist-link-secret-00000000";
const DAY = 86_400_000;
let roleId = "";

async function personOn(role: string, fullName: string, options: { consent?: boolean; stage?: string; doNotContact?: boolean; facts?: boolean } = {}) {
  const person = await db.person.create({ data: {
    userId: TEST_ADMIN_ID, fullName, profileUrl: `https://www.linkedin.com/in/test-${randomUUID()}`, memberId: `member-${randomUUID()}`,
    headline: `${fullName.split(" ")[0]} - Platform engineer`, email: `${randomUUID()}@private.example`, searchText: fullName.toLowerCase(),
    doNotContact: Boolean(options.doNotContact), revisitNote: "PRIVATE revisit note", revisitOn: new Date(Date.now() + 30 * DAY),
    ...(options.facts === false ? {} : {
      salaryMin: 85000, salaryMax: 95000, salaryCurrency: "GBP", salaryNote: "Base only", noticeWeeks: 12, location: "Manchester",
      remotePreference: "hybrid", rightToWork: "has_right", skillsSummary: "Kubernetes, Terraform", motivation: "Wants a team that owns its roadmap.",
      factsConfirmedAt: new Date(Date.now() - DAY),
    }),
  } });
  await db.personNote.create({ data: { personId: person.id, body: "PRIVATE note about pay expectations" } });
  const candidate = await db.candidate.create({ data: { roleId: role, fullName, personId: person.id, stage: options.stage ?? "screened", notes: "PRIVATE candidate notes" } });
  if (options.consent !== false) {
    await db.screening.create({ data: { candidateId: candidate.id, status: "confirmed", transcriptSource: "paste", confirmedAt: new Date(Date.now() - DAY), representConsentAt: new Date(Date.now() - DAY) } });
  }
  return { person, candidate };
}

function row(page: Page, name: string) {
  return page.locator("li.card", { hasText: name });
}

async function openPanel(page: Page) {
  const panel = page.locator("details.client-link");
  if (!(await panel.getAttribute("open").then((v) => v !== null))) await panel.locator("summary").click();
  return panel;
}

async function linkOf(page: Page) {
  const panel = await openPanel(page);
  return panel.locator(".client-link-address input").inputValue();
}

async function guest(browser: Browser, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] }, ...(viewport ? { viewport } : {}) });
  return { page: await context.newPage(), close: () => context.close() };
}

test.beforeAll(async () => {
  roleId = (await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Client Link Test Platform Lead", client: "Halden Systems Ltd" } })).id;
  await db.settings.update({ where: { userId: TEST_ADMIN_ID }, data: { recruiterName: "Morven Ellis" } });
});

test("L1 a consented candidate is put forward in one click, and the client reads them without signing in - and nothing private", async ({ browser, page }, testInfo) => {
  const { candidate } = await personOn(roleId, "Imogen Achterberg");
  await page.goto(`/roles/${roleId}`);
  await expect((await openPanel(page)).getByText(/Put someone forward and they appear on one page Halden Systems Ltd opens without signing in/)).toBeVisible();
  await row(page, "Imogen Achterberg").getByRole("button", { name: "Put forward to Halden Systems Ltd" }).click();
  await expect(row(page, "Imogen Achterberg").getByText("On the client link")).toBeVisible();
  const after = await db.candidate.findUniqueOrThrow({ where: { id: candidate.id } });
  expect(after.stage).toBe("submitted");
  expect(after.submittedAt).not.toBeNull();

  const link = await linkOf(page);
  expect(link).toMatch(/^http:\/\/localhost:3100\/s\/[a-z0-9]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  const share = await openPanel(page);
  await share.getByLabel(/Client.s email address/).fill("hiring@halden.example");
  await expect(share.getByRole("link", { name: "Open in email" })).toHaveAttribute("href", /^mailto:hiring@halden\.example\?subject=Candidates%20for%20Client%20Link%20Test%20Platform%20Lead&body=/);
  await expect(share.getByText("Not opened yet")).toBeVisible();
  await share.screenshot({ path: testInfo.outputPath("client-link-panel.png") });

  // The recruiter opening their own link is not the client reading it.
  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1, name: "Client Link Test Platform Lead" })).toBeVisible();
  const access = await db.shortlistAccess.findFirstOrThrow({ where: { shortlist: { roleId } } });
  expect((await db.shortlistAccess.findUniqueOrThrow({ where: { id: access.id } })).viewCount).toBe(0);

  const client = await guest(browser);
  try {
    await client.page.goto(link);
    const entry = client.page.locator(".client-entry", { hasText: "Imogen Achterberg" });
    await expect(entry.getByRole("heading", { name: "Imogen Achterberg" })).toBeVisible();
    await expect(entry).toContainText("Imogen - Platform engineer");
    await expect(entry).toContainText("£85,000 to £95,000 a year");
    await expect(entry).toContainText("Base only");
    await expect(entry).toContainText("12 weeks");
    await expect(entry).toContainText("Manchester, Hybrid");
    await expect(entry).toContainText("Has the right to work");
    await expect(entry).toContainText("Kubernetes, Terraform");
    await expect(entry).toContainText("Wants a team that owns its roadmap.");
    await expect(client.page.getByText("Put forward by Morven Ellis for Halden Systems Ltd")).toBeVisible();
    const html = await client.page.content();
    for (const hidden of ["linkedin.com", "member-", "@private.example", "PRIVATE", "Sign out", "Roles"]) expect(html).not.toContain(hidden);
    expect(await client.page.locator('meta[name="robots"]').getAttribute("content")).toMatch(/noindex/);
    await client.page.screenshot({ path: testInfo.outputPath("client-page-desktop.png"), fullPage: true });
    await client.page.reload();
  } finally {
    await client.close();
  }
  // One visit, however many reloads.
  expect((await db.shortlistAccess.findUniqueOrThrow({ where: { id: access.id } })).viewCount).toBe(1);
  await page.goto(`/roles/${roleId}`);
  await expect((await openPanel(page)).getByText(/Last opened/)).toBeVisible();
});

test("L2 without known consent the recruiter confirms it, and consent for the same client on another role is reused", async ({ page }) => {
  await personOn(roleId, "Sam Okafor", { consent: false });
  await page.goto(`/roles/${roleId}`);
  const sam = row(page, "Sam Okafor");
  await sam.getByText("Put forward to Halden Systems Ltd", { exact: true }).click();
  await sam.getByRole("button", { name: "Put forward", exact: true }).click();
  // The browser refuses an unticked required box; nothing is written.
  expect(await db.shortlistItem.count({ where: { person: { fullName: "Sam Okafor" } } })).toBe(0);
  await sam.getByLabel("Sam Okafor agreed to be put forward to Halden Systems Ltd.").check();
  await sam.getByRole("button", { name: "Put forward", exact: true }).click();
  await expect(sam.getByText("On the client link")).toBeVisible();
  expect(await db.auditEvent.count({ where: { action: "shortlist.put_forward" } })).toBeGreaterThanOrEqual(2);

  // The same person on another role for the same client (spelt differently)
  // is one click: they already agreed to Halden.
  const other = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Client Link Second Role", client: "halden systems" } });
  const person = await db.person.findFirstOrThrow({ where: { fullName: "Sam Okafor", userId: TEST_ADMIN_ID } });
  await db.candidate.create({ data: { roleId: other.id, fullName: "Sam Okafor", personId: person.id, stage: "contacted" } });
  await page.goto(`/roles/${other.id}`);
  await row(page, "Sam Okafor").getByRole("button", { name: "Put forward to halden systems" }).click();
  await expect(row(page, "Sam Okafor").getByText("On the client link")).toBeVisible();

  // Do not contact, rejected and placed people are never offered.
  await personOn(roleId, "Dana Marsh", { doNotContact: true });
  await personOn(roleId, "Rory Quill", { stage: "rejected" });
  await page.goto(`/roles/${roleId}`);
  await expect(row(page, "Dana Marsh").getByText(/Put forward/)).toHaveCount(0);
  await expect(row(page, "Rory Quill").getByText(/Put forward/)).toHaveCount(0);
});

test("L3 the page reads live: taking someone off, do not contact and rejection all remove them at once", async ({ browser, page }) => {
  await page.goto(`/roles/${roleId}`);
  const link = await linkOf(page);
  const client = await guest(browser);
  try {
    await client.page.goto(link);
    await expect(client.page.locator(".client-entry")).toHaveCount(2);
    page.once("dialog", (dialog) => dialog.accept());
    await row(page, "Sam Okafor").getByRole("button", { name: "Take off" }).click();
    await expect(row(page, "Sam Okafor").getByText("On the client link")).toHaveCount(0);
    await client.page.reload();
    await expect(client.page.locator(".client-entry")).toHaveCount(1);

    const imogen = await db.person.findFirstOrThrow({ where: { fullName: "Imogen Achterberg", userId: TEST_ADMIN_ID } });
    await db.person.update({ where: { id: imogen.id }, data: { doNotContact: true } });
    await client.page.reload();
    await expect(client.page.getByRole("heading", { name: "No one here yet" })).toBeVisible();
    await db.person.update({ where: { id: imogen.id }, data: { doNotContact: false } });
    await db.candidate.updateMany({ where: { roleId, personId: imogen.id }, data: { stage: "rejected" } });
    await client.page.reload();
    await expect(client.page.locator(".client-entry")).toHaveCount(0);
    await db.candidate.updateMany({ where: { roleId, personId: imogen.id }, data: { stage: "submitted" } });
  } finally {
    await client.close();
  }
});

test("L4 replacing, closing and forging a link, and closing the role, leave nothing open", async ({ browser, page }) => {
  await page.goto(`/roles/${roleId}`);
  const first = await linkOf(page);
  page.on("dialog", (dialog) => dialog.accept());
  await (await openPanel(page)).getByRole("button", { name: "Replace the link" }).click();
  await expect.poll(() => linkOf(page)).not.toBe(first);
  const second = await linkOf(page);

  const client = await guest(browser);
  try {
    await client.page.goto(first);
    await expect(client.page.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();
    await expect(client.page.getByText("Ask Morven Ellis for an up-to-date link.")).toBeVisible();
    await client.page.goto(second);
    await expect(client.page.getByRole("heading", { level: 1, name: "Client Link Test Platform Lead" })).toBeVisible();

    // A link signed with another secret, or for a made-up access, names nobody.
    const access = await db.shortlistAccess.findFirstOrThrow({ where: { shortlist: { roleId }, revokedAt: null } });
    await client.page.goto(`/s/${shortlistToken("x".repeat(40), access.id, access.nonce)}`);
    await expect(client.page.getByText("Ask the recruiter who sent it for an up-to-date link.")).toBeVisible();
    await client.page.goto(`/s/${shortlistToken(SECRET, "cm0000000000000000000000", access.nonce)}`);
    await expect(client.page.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();

    await (await openPanel(page)).getByRole("button", { name: "Close the link" }).click();
    await expect((await openPanel(page)).getByText(/You closed this link/)).toBeVisible();
    await client.page.goto(second);
    await expect(client.page.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();

    await (await openPanel(page)).getByRole("button", { name: "Make a new link" }).click();
    const third = await linkOf(page);
    await client.page.goto(third);
    await expect(client.page.locator(".client-entry")).toHaveCount(1);

    await db.role.update({ where: { id: roleId }, data: { status: "closed" } });
    await client.page.goto(third);
    await expect(client.page.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();
    await db.role.update({ where: { id: roleId }, data: { status: "open" } });
  } finally {
    await client.close();
  }
});

test("L5 the preview shows the client's page in the app, and is never counted; another account's is not found", async ({ page }) => {
  const shortlist = await db.shortlist.findUniqueOrThrow({ where: { roleId } });
  const before = await db.shortlistAccess.aggregate({ where: { shortlistId: shortlist.id }, _sum: { viewCount: true } });
  await page.goto(`/roles/${roleId}`);
  await (await openPanel(page)).getByRole("link", { name: "See what Halden Systems Ltd sees" }).click();
  await expect(page.getByText(/This is what Halden Systems Ltd sees on their link/)).toBeVisible();
  await expect(page.locator(".client-entry", { hasText: "Imogen Achterberg" })).toBeVisible();
  const after = await db.shortlistAccess.aggregate({ where: { shortlistId: shortlist.id }, _sum: { viewCount: true } });
  expect(after._sum.viewCount).toBe(before._sum.viewCount);

  const other = await db.user.create({ data: { email: `links-other-${randomUUID()}@test.capture.invalid`, name: "Other Recruiter", role: "recruiter", accountTier: "basic", settings: { create: {} } } });
  const theirRole = await db.role.create({ data: { userId: other.id, title: "Their Role", client: "Elsewhere" } });
  const theirs = await db.shortlist.create({ data: { userId: other.id, kind: "role", roleId: theirRole.id, title: "Their Role", client: "Elsewhere", accesses: { create: { nonce: "n".repeat(22) } } } });
  expect((await page.goto(`/shortlists/${theirs.id}/preview`))?.status()).toBe(404);

  // A read-only view of that account previews its page but shows no link and
  // offers nothing to change.
  const token = process.env.CAPTURE_TEST_SESSION_TOKEN!;
  await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: other.id } });
  try {
    expect((await page.goto(`/shortlists/${theirs.id}/preview`))?.status()).toBe(200);
    await page.goto(`/roles/${theirRole.id}`);
    const panel = await openPanel(page);
    await expect(panel.getByText("The link is not shown in a read-only view.")).toBeVisible();
    await expect(panel.locator(".client-link-address")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Close the link" })).toBeDisabled();
  } finally {
    await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: null } });
  }
});

test("L6 marking a client email as sent puts the candidate on the role's client link too", async ({ page }) => {
  const fields = Object.fromEntries(["salary", "notice", "location", "right_to_work"].map((field) => [field, { value: {}, not_discussed: true, confirmed: true }]));
  const { candidate } = await personOn(roleId, "Priya Raman");
  await db.screening.updateMany({ where: { candidateId: candidate.id }, data: { summaryJson: JSON.stringify({ version: 1, ai: { salary: {}, notice: {}, location: {}, right_to_work: {}, skills: [], concerns: [] }, fields }) } });
  await page.goto(`/candidates/${candidate.id}/screening`);
  await page.getByRole("region", { name: "Email the client" }).getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByText(/Marked as sent to the client on/)).toBeVisible();
  const item = await db.shortlistItem.findFirst({ where: { candidateId: candidate.id, shortlist: { roleId } } });
  expect(item).not.toBeNull();
  expect((await db.candidate.findUniqueOrThrow({ where: { id: candidate.id } })).stage).toBe("submitted");
});

test("L7 the client's page fits a phone without sideways scrolling", async ({ browser, page }, testInfo) => {
  await page.goto(`/roles/${roleId}`);
  const link = await linkOf(page);
  const client = await guest(browser, { width: 375, height: 812 });
  try {
    await client.page.goto(link);
    await expect(client.page.locator(".client-entry").first()).toBeVisible();
    expect(await client.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await client.page.screenshot({ path: testInfo.outputPath("client-page-phone.png"), fullPage: true });
  } finally {
    await client.close();
  }
});
