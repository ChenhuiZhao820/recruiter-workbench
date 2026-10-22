import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db, TEST_ADMIN_ID, skipNoCv } from "./helpers";
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

// The person behind a name on this role: other specs use the same fictional
// names for the same account, so a lookup by name alone can find theirs.
async function personOnRole(role: string, fullName: string) {
  const candidate = await db.candidate.findFirstOrThrow({ where: { roleId: role, fullName } });
  return db.person.findUniqueOrThrow({ where: { id: candidate.personId! } });
}

function row(page: Page, name: string) {
  return page.locator("li.card", { hasText: name });
}

async function openPanel(page: Page) {
  const panel = page.locator("details.client-link");
  if (!(await panel.getAttribute("open").then((v) => v !== null))) await panel.locator("summary").first().click();
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
  await expect((await openPanel(page)).getByText("A page Halden Systems Ltd opens without signing in, to see who you put forward and choose who to interview.")).toBeVisible();
  await row(page, "Imogen Achterberg").getByRole("button", { name: "Put forward to Halden Systems Ltd" }).click();
  await skipNoCv(page);
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
    await expect(client.page.getByRole("banner").getByRole("img", { name: "Retrivr", exact: true })).toBeVisible();
    expect(await client.page.locator("body").innerText()).not.toMatch(/\bCapture\b/);
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
  expect(await db.shortlistItem.count({ where: { personId: (await personOnRole(roleId, "Sam Okafor")).id } })).toBe(0);
  await sam.getByLabel("Sam Okafor agreed to be put forward to Halden Systems Ltd.").check();
  await sam.getByRole("button", { name: "Put forward", exact: true }).click();
  await skipNoCv(page);
  await expect(sam.getByText("On the client link")).toBeVisible();
  expect(await db.auditEvent.count({ where: { action: "shortlist.put_forward" } })).toBeGreaterThanOrEqual(2);

  // The same person on another role for the same client (spelt differently)
  // is one click: they already agreed to Halden.
  const other = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Client Link Second Role", client: "halden systems" } });
  const person = await personOnRole(roleId, "Sam Okafor");
  await db.candidate.create({ data: { roleId: other.id, fullName: "Sam Okafor", personId: person.id, stage: "contacted" } });
  await page.goto(`/roles/${other.id}`);
  await row(page, "Sam Okafor").getByRole("button", { name: "Put forward to halden systems" }).click();
  await skipNoCv(page);
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
    await row(page, "Sam Okafor").getByRole("button", { name: "Take off" }).click();
    await page.getByRole("dialog", { name: "Take Sam Okafor off the client link?" }).getByRole("button", { name: "Confirm" }).click();
    await expect(row(page, "Sam Okafor").getByText("On the client link")).toHaveCount(0);
    await client.page.reload();
    await expect(client.page.locator(".client-entry")).toHaveCount(1);

    const imogen = await personOnRole(roleId, "Imogen Achterberg");
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
    await expect(panel.getByText("Links are not shown in a read-only view.")).toBeVisible();
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

test("L7a with JavaScript off the client's answer still posts, with its own origin, and is saved", async ({ browser, page }) => {
  // The form posts natively here, as it does for anyone who presses before
  // the page's script has loaded. Under no-referrer that post carried
  // Origin: null and ended in a 500.
  await page.goto(`/roles/${roleId}`);
  const link = await linkOf(page);
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] }, javaScriptEnabled: false });
  const client = await context.newPage();
  try {
    await client.goto(link);
    const imogen = client.locator(".client-entry", { hasText: "Imogen Achterberg" });
    await imogen.getByRole("button", { name: "Interview Imogen" }).click();
    await expect(client.locator(".client-entry", { hasText: "Imogen Achterberg" }).getByText("You asked to meet Imogen.")).toBeVisible();
  } finally {
    await context.close();
  }
  const imogen = await personOnRole(roleId, "Imogen Achterberg");
  const item = await db.shortlistItem.findFirstOrThrow({ where: { personId: imogen.id, shortlist: { roleId } } });
  expect(item.decision).toBe("interview");
  // Undone, so the next test starts with no answers.
  await db.shortlistItem.update({ where: { id: item.id }, data: { decision: null, decisionAt: null, decisionAccessId: null } });
  await db.auditEvent.deleteMany({ where: { action: "shortlist.decision" } });
  await db.usageEvent.deleteMany({ where: { userId: TEST_ADMIN_ID, kind: "client_decision" } });
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

test("L8 the client answers on the page - interview, or not for us with a reason - and can change it; the role page shows it", async ({ browser, page }, testInfo) => {
  await page.goto(`/roles/${roleId}`);
  const link = await linkOf(page);
  const client = await guest(browser);
  try {
    await client.page.goto(link);
    const imogen = client.page.locator(".client-entry", { hasText: "Imogen Achterberg" });
    await imogen.getByRole("button", { name: "Interview Imogen" }).click();
    await expect(imogen.getByText("You asked to meet Imogen. The recruiter will arrange it.")).toBeVisible();

    const priya = client.page.locator(".client-entry", { hasText: "Priya Raman" });
    await priya.getByRole("button", { name: "Not for us" }).click();
    await priya.getByRole("radio", { name: "Salary" }).check();
    await priya.getByLabel(/Anything else the recruiter should know/).fill("  Above   our band  ");
    await priya.getByRole("button", { name: "Send" }).click();
    await expect(priya.getByText(/Not for you · Salary: Above our band/)).toBeVisible();
    await client.page.screenshot({ path: testInfo.outputPath("client-page-answered.png"), fullPage: true });

    // Changing an answer replaces it.
    await priya.getByRole("button", { name: "Change your answer" }).click();
    await priya.getByRole("button", { name: "Not for us" }).click();
    await priya.getByRole("radio", { name: "Experience" }).check();
    await priya.getByRole("button", { name: "Send" }).click();
    await expect(priya.getByText(/Not for you · Experience/)).toBeVisible();
  } finally {
    await client.close();
  }
  const items = await db.shortlistItem.findMany({ where: { shortlist: { roleId } }, include: { person: { select: { fullName: true } } } });
  const by = Object.fromEntries(items.map((item) => [item.person.fullName, item]));
  expect([by["Imogen Achterberg"].decision, by["Imogen Achterberg"].decisionAccessId]).toEqual(["interview", expect.any(String)]);
  expect([by["Priya Raman"].decision, by["Priya Raman"].decisionReason, by["Priya Raman"].decisionNote]).toEqual(["declined", "experience", null]);
  expect(await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "client_decision" } })).toBe(3);
  expect(await db.auditEvent.count({ where: { action: "shortlist.decision" } })).toBe(3);

  await page.goto(`/roles/${roleId}`);
  await expect(row(page, "Imogen Achterberg").getByText("Halden Systems Ltd wants to meet")).toBeVisible();
  await expect(row(page, "Priya Raman").getByText("Not for Halden Systems Ltd · Experience")).toBeVisible();
  await expect(row(page, "Priya Raman").getByRole("button", { name: "Mark rejected" })).toBeVisible();
  await expect((await openPanel(page)).locator(".client-link-stats").getByText(/Halden Systems Ltd wants to meet/)).toBeVisible();

  // The preview shows the answers and offers nothing to press.
  await (await openPanel(page)).getByRole("link", { name: "See what Halden Systems Ltd sees" }).click();
  await expect(page.getByText("You asked to meet Imogen. The recruiter will arrange it.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Interview|Not for us|Change your answer/ })).toHaveCount(0);
});

test("L9 'Client wants to meet' is a follow-up and a run of its own, and leaves once the candidate is written to", async ({ page }) => {
  await page.goto("/followups");
  const bucket = page.getByRole("region", { name: "Client wants to meet" });
  await expect(bucket.getByText("Imogen Achterberg")).toBeVisible();
  await expect(bucket.getByText(/Halden Systems Ltd wants to meet them/)).toBeVisible();
  await expect(bucket.getByText("Priya Raman")).toHaveCount(0);

  await bucket.getByRole("link", { name: "Go through these one by one" }).click();
  await expect(page.getByRole("heading", { name: /Client wants to meet/ })).toBeVisible();
  await expect(page.getByText(/Halden Systems Ltd asked to meet them today/)).toBeVisible();
  await page.getByRole("button", { name: /^Start \(1\)$/ }).click();
  await expect(page.getByLabel("Message")).toHaveValue(/Good news on the Client Link Test Platform Lead role - they would like to meet you\./);
  await page.getByRole("button", { name: "Mark as sent", exact: true }).click();
  await expect(page.getByRole("heading", { name: "That is everyone." })).toBeVisible();

  await page.goto("/followups");
  await expect(page.getByRole("region", { name: "Client wants to meet" })).toHaveCount(0);
});

test("L10 a forged person, and a link closed while the page was open, take no answer", async ({ browser, page }) => {
  await page.goto(`/roles/${roleId}`);
  const link = await linkOf(page);
  const other = await db.user.findFirstOrThrow({ where: { name: "Other Recruiter", email: { startsWith: "links-other-" } } });
  const theirs = await db.shortlist.findFirstOrThrow({ where: { userId: other.id } });
  const theirPerson = await db.person.create({ data: { userId: other.id, fullName: "Not Yours", searchText: "not yours" } });
  const theirItem = await db.shortlistItem.create({ data: { shortlistId: theirs.id, personId: theirPerson.id, consentAt: new Date() } });

  const client = await guest(browser);
  try {
    await client.page.goto(link);
    const priya = client.page.locator(".client-entry", { hasText: "Priya Raman" });
    await priya.getByRole("button", { name: "Change your answer" }).click();
    await priya.locator('input[name="itemId"]').first().evaluate((input, id) => { (input as HTMLInputElement).value = id; }, theirItem.id);
    await priya.getByRole("button", { name: "Interview Priya" }).click();
    await expect(priya.getByRole("alert")).toContainText("That person is no longer on this page.");
    expect((await db.shortlistItem.findUniqueOrThrow({ where: { id: theirItem.id } })).decision).toBeNull();

    await client.page.reload();
    await priya.getByRole("button", { name: "Change your answer" }).click();
    page.on("dialog", (dialog) => dialog.accept());
    await (await openPanel(page)).getByRole("button", { name: "Close the link" }).click();
    await expect((await openPanel(page)).getByText(/You closed this link/)).toBeVisible();
    await priya.getByRole("button", { name: "Interview Priya" }).click();
    await expect(priya.getByRole("alert")).toContainText("This link is no longer active.");
    expect((await db.shortlistItem.findFirstOrThrow({ where: { shortlist: { roleId }, person: { fullName: "Priya Raman" } } })).decision).toBe("declined");
  } finally {
    await client.close();
  }
});
