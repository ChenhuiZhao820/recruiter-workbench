import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db, TEST_ADMIN_ID, skipNoCv } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";
import { newNonce, shortlistToken } from "../lib/shortlist-core.mjs";

// Custom shortlists: any people, for one client, on a link that expires; Basic
// keeps at most three open at once. Fictional people and the disposable test
// database only; guest contexts carry no session.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const SECRET = "test-only-shortlist-link-secret-00000000";
const DAY = 86_400_000;
const tag = randomUUID().slice(0, 8);

async function person(fullName: string, options: { userId?: string; doNotContact?: boolean; consentFor?: string } = {}) {
  const userId = options.userId ?? TEST_ADMIN_ID;
  const created = await db.person.create({ data: {
    userId, fullName, headline: `${fullName.split(" ")[0]} - Data engineer`, searchText: `${fullName} data engineer ${tag}`.toLowerCase(),
    doNotContact: Boolean(options.doNotContact), skillsSummary: "dbt, Snowflake",
  } });
  if (options.consentFor) {
    const role = await db.role.create({ data: { userId, title: `Earlier role ${randomUUID().slice(0, 6)}`, client: options.consentFor } });
    const candidate = await db.candidate.create({ data: { roleId: role.id, fullName, personId: created.id, stage: "screened" } });
    await db.screening.create({ data: { candidateId: candidate.id, status: "confirmed", transcriptSource: "paste", confirmedAt: new Date(), representConsentAt: new Date(Date.now() - DAY) } });
  }
  return created;
}

async function guest(browser: Browser) {
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  return { page: await context.newPage(), close: () => context.close() };
}

async function signedInAs(browser: Browser, userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  return { page: await context.newPage(), close: () => context.close() };
}

async function basicAccount() {
  return db.user.create({ data: {
    email: `shortlists-basic-${randomUUID()}@test.capture.invalid`, name: "Basic Recruiter", role: "recruiter", accountTier: "basic",
    settings: { create: { seenRelease: CURRENT_RELEASE, recruiterName: "Basic Recruiter" } },
  } });
}

async function customShortlist(userId: string, title: string, options: { expiresAt?: Date; revokedAt?: Date | null } = {}) {
  return db.shortlist.create({ data: {
    userId, kind: "custom", title, client: "Elsewhere Ltd", access: "link",
    expiresAt: options.expiresAt ?? new Date(Date.now() + 30 * DAY), revokedAt: options.revokedAt ?? null,
    accesses: { create: { nonce: newNonce() } },
  }, include: { accesses: true } });
}

function linkFor(shortlist: { accesses: { id: string; nonce: string }[] }) {
  return `/s/${shortlistToken(SECRET, shortlist.accesses[0].id, shortlist.accesses[0].nonce)}`;
}

function rowOf(page: Page, title: string | RegExp) {
  return page.locator("details.shortlist-row", { has: page.locator(".shortlist-row-title", { hasText: title }) });
}

test("S1 New shortlist on People starts one for a client, with people found by name; consent already given to that client is reused", async ({ browser, page }, testInfo) => {
  await person(`Aoife Brennan ${tag}`, { consentFor: "Marsh and Pike Ltd" });
  await person(`Bilal Rahman ${tag}`);
  await person(`Do Not ${tag}`, { doNotContact: true });

  // People is a list to read: no boxes to tick, one button to start a shortlist.
  await page.goto(`/people?q=${tag}`);
  await expect(page.getByRole("list", { name: "People" }).getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("link", { name: "New shortlist" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "New shortlist" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to People" })).toBeVisible();
  await page.getByLabel("For which client").fill("Marsh & Pike");
  await page.getByLabel("Find people by name or headline").fill(tag);
  await page.getByRole("button", { name: "Find and update" }).click();
  const found = page.getByRole("list", { name: "People found" });
  await expect(found.getByText(`Do Not ${tag}`)).toHaveCount(0);
  await found.locator("li", { hasText: `Aoife Brennan ${tag}` }).getByRole("checkbox").check();
  await found.locator("li", { hasText: `Bilal Rahman ${tag}` }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Add ticked people" }).click();
  const chosen = page.locator(".shortlist-chosen");
  // "Marsh & Pike" and "Marsh and Pike Ltd" are one client.
  await expect(chosen.locator("li", { hasText: "Aoife Brennan" }).getByText("Agreed before to Marsh & Pike")).toBeVisible();
  const bilal = chosen.locator("li", { hasText: "Bilal Rahman" });
  await expect(bilal.getByRole("checkbox")).not.toBeChecked();

  await page.screenshot({ path: testInfo.outputPath("new-shortlist.png"), fullPage: true });
  await page.getByLabel("Name (optional)").fill(`Data people ${tag}`);
  await page.getByRole("button", { name: "Create shortlist" }).click();
  // The browser holds back an unticked required box: nothing is saved.
  expect(await db.shortlist.count({ where: { title: `Data people ${tag}` } })).toBe(0);
  await bilal.getByLabel("Agreed to be put forward to Marsh & Pike").check();
  await page.getByRole("button", { name: "Create shortlist" }).click();
  await skipNoCv(page);

  await expect(page).toHaveURL(/\/shortlists\?open=/);
  const row = rowOf(page, `Data people ${tag}`);
  await expect(row).toHaveAttribute("open", "");
  await expect(row.locator(".shortlist-row-side")).toContainText(/Open\s*Until/);
  await page.screenshot({ path: testInfo.outputPath("shortlists-library.png"), fullPage: true });
  const link = await row.locator(".client-link-address input").inputValue();
  const saved = await db.shortlist.findFirstOrThrow({ where: { title: `Data people ${tag}` }, include: { items: { include: { person: true } } } });
  expect(saved.kind).toBe("custom");
  expect(saved.client).toBe("Marsh & Pike");
  expect(saved.expiresAt!.getTime() - saved.createdAt.getTime()).toBeGreaterThan(59 * DAY);
  expect(saved.items.map((item) => item.person.fullName)).toEqual([`Aoife Brennan ${tag}`, `Bilal Rahman ${tag}`]);
  expect(await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "shortlist_created" } })).toBe(1);

  const client = await guest(browser);
  try {
    await client.page.goto(link);
    await expect(client.page.getByRole("heading", { level: 1, name: `Data people ${tag}` })).toBeVisible();
    await expect(client.page.locator(".client-entry")).toHaveCount(2);
    await expect(client.page.getByText("Put forward by")).toContainText("Marsh & Pike");
  } finally {
    await client.close();
  }
});

test("S2 people are added and removed later, it can be renamed but not moved to another client, and do not contact is refused", async ({ page }) => {
  const shortlist = await db.shortlist.findFirstOrThrow({ where: { title: `Data people ${tag}` } });
  await person(`Chidi Okonkwo ${tag}`);
  await page.goto("/shortlists");
  const row = rowOf(page, `Data people ${tag}`);
  await row.locator("summary").first().click();
  await row.getByRole("link", { name: "Add people" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Add to Data people ${tag}` })).toBeVisible();
  await page.getByLabel("Find people by name or headline").fill(`Chidi Okonkwo ${tag}`);
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("list", { name: "People found" }).getByLabel(/Chidi Okonkwo/).check();
  await page.getByRole("button", { name: "Add ticked people" }).click();
  await page.getByLabel("Agreed to be put forward to Marsh & Pike").check();
  await page.getByRole("button", { name: "Add them" }).click();
  await skipNoCv(page);
  await expect(rowOf(page, `Data people ${tag}`).getByRole("list", { name: /People on/ }).getByText(`Chidi Okonkwo ${tag}`)).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await rowOf(page, `Data people ${tag}`).getByRole("list", { name: /People on/ }).locator("li", { hasText: "Bilal Rahman" }).getByRole("button", { name: "Remove" }).click();
  await expect(rowOf(page, `Data people ${tag}`).getByText(`Bilal Rahman ${tag}`)).toHaveCount(0);

  const open = rowOf(page, `Data people ${tag}`);
  await open.getByText("Rename").click();
  await open.getByLabel("Name", { exact: true }).fill(`Data people renamed ${tag}`);
  await open.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".shortlist-row-title", { hasText: `Data people renamed ${tag}` })).toBeVisible();
  await expect(page.getByLabel("Client", { exact: true })).toHaveCount(0);

  // Someone marked do not contact, sent in the address, cannot be saved.
  const dnc = await db.person.findFirstOrThrow({ where: { fullName: `Do Not ${tag}` } });
  await page.goto(`/shortlists/new?add=${shortlist.id}&p=${dnc.id}`);
  await expect(page.locator(".shortlist-chosen").getByText("Do not contact")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add them" })).toBeDisabled();
});

test("S3 Basic keeps three open at once: the fourth is refused, closing or expiry frees a place, and links already sent keep working", async ({ browser }, testInfo) => {
  const basic = await basicAccount();
  const open = await Promise.all([1, 2, 3].map((n) => customShortlist(basic.id, `Basic open ${n}`)));
  await customShortlist(basic.id, "Basic expired", { expiresAt: new Date(Date.now() - DAY) });
  await customShortlist(basic.id, "Basic closed", { revokedAt: new Date() });
  const someone = await person(`Dana Wilde ${tag}`, { userId: basic.id });
  const recruiter = await signedInAs(browser, basic.id);
  try {
    const page = recruiter.page;
    await page.goto("/shortlists");
    await expect(page.locator(".shortlist-limit")).toContainText("3 of 3");
    // The library manages; starting one is on People.
    await expect(page.getByRole("link", { name: "New shortlist" })).toHaveCount(0);

    await page.goto(`/shortlists/new?client=Elsewhere&p=${someone.id}`);
    await expect(page.getByRole("alert").filter({ hasText: "3 of 3" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create shortlist" })).toBeDisabled();
    // Forcing the button does not get past the server.
    await page.getByLabel("Agreed to be put forward to Elsewhere").check();
    await page.getByRole("button", { name: "Create shortlist" }).evaluate((button) => { button.removeAttribute("disabled"); button.removeAttribute("aria-disabled"); });
    await page.getByRole("button", { name: "Create shortlist" }).click();
    await skipNoCv(page);
    await expect(page.locator('[data-form-message="error"]')).toContainText("You already have 3 active shortlists");
    expect(await db.shortlist.count({ where: { userId: basic.id } })).toBe(5);

    // Reopening needs a place too, and says so before anything is pressed.
    await page.goto("/shortlists");
    const expired = rowOf(page, "Basic expired");
    await expired.locator("summary").first().click();
    await expect(expired.getByRole("button", { name: "Reopen" })).toBeDisabled();
    await expect(expired.locator(".shortlist-reopen-note")).toContainText("3 of 3 open on your plan. Close an open shortlist to reopen this one.");
    const closed = rowOf(page, "Basic closed");
    await closed.locator("summary").first().click();
    await expect(closed.getByRole("button", { name: "Reopen" })).toBeDisabled();
    await closed.screenshot({ path: testInfo.outputPath("shortlist-reopen-at-limit.png") });

    page.once("dialog", (dialog) => dialog.accept());
    const first = rowOf(page, "Basic open 1");
    await first.locator("summary").first().click();
    await first.getByRole("button", { name: "Close the link" }).click();
    await expect(page.locator(".shortlist-limit")).toContainText("2 of 3");
    const freed = rowOf(page, "Basic expired");
    if ((await freed.getAttribute("open")) === null) await freed.locator("summary").first().click();
    await expect(freed.getByRole("button", { name: "Reopen" })).toBeEnabled();
    await expect(freed.locator(".shortlist-reopen-note")).toHaveCount(0);
    await page.goto(`/shortlists/new?client=Elsewhere&p=${someone.id}`);
    await page.getByLabel("Agreed to be put forward to Elsewhere").check();
    await page.getByRole("button", { name: "Create shortlist" }).click();
    await skipNoCv(page);
    await expect(page).toHaveURL(/\/shortlists\?open=/);
    await expect(page.locator(".shortlist-limit")).toContainText("3 of 3");

    // A Pro account with five open, moved to Basic, opens no sixth, and every
    // link it already sent still opens.
    const pro = await db.user.create({ data: { email: `shortlists-pro-${randomUUID()}@test.capture.invalid`, name: "Pro Recruiter", role: "recruiter", accountTier: "pro", settings: { create: { seenRelease: CURRENT_RELEASE } } } });
    const five = await Promise.all([1, 2, 3, 4, 5].map((n) => customShortlist(pro.id, `Pro ${n}`)));
    await db.user.update({ where: { id: pro.id }, data: { accountTier: "basic" } });
    const visitor = await guest(browser);
    try {
      for (const shortlist of five) {
        await visitor.page.goto(linkFor(shortlist));
        await expect(visitor.page.getByRole("heading", { level: 1, name: shortlist.title })).toBeVisible();
      }
      await visitor.page.goto(linkFor(open[0]));
      await expect(visitor.page.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();
    } finally {
      await visitor.close();
    }
  } finally {
    await recruiter.close();
  }
});

test("S4 another account's shortlist is not found, and a read-only view shows shortlists without links or changes", async ({ page }) => {
  const other = await basicAccount();
  const theirs = await customShortlist(other.id, "Their shortlist");
  await page.goto("/shortlists");
  await expect(page.getByText("Their shortlist")).toHaveCount(0);
  expect((await page.goto(`/shortlists/${theirs.id}/preview`))?.status()).toBe(404);
  // Adding to it through the address starts a new shortlist of your own instead.
  await page.goto(`/shortlists/new?add=${theirs.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "New shortlist" })).toBeVisible();

  const token = process.env.CAPTURE_TEST_SESSION_TOKEN!;
  await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: other.id } });
  try {
    await page.goto("/shortlists");
    const row = rowOf(page, "Their shortlist");
    await row.locator("summary").first().click();
    await expect(row.getByText("Links are not shown in a read-only view.")).toBeVisible();
    await expect(row.getByRole("button", { name: "Close the link" })).toBeDisabled();
    await expect(page.getByRole("link", { name: "New shortlist" })).toHaveCount(0);
  } finally {
    await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: null } });
  }
});

test("S5 the export carries shortlists and who is on them, never their link secrets", async ({ request }) => {
  const response = await request.get(`${BASE}/api/export?format=json`);
  const text = await response.text();
  const data = JSON.parse(text);
  expect(data.shortlists.some((row: { title: string }) => row.title === `Data people renamed ${tag}`)).toBe(true);
  expect(data.shortlistPeople.length).toBeGreaterThanOrEqual(2);
  const nonces = (await db.shortlistAccess.findMany({ where: { shortlist: { userId: TEST_ADMIN_ID } } })).map((access) => access.nonce);
  for (const nonce of nonces) expect(text).not.toContain(nonce);
  expect(text).not.toContain("Their shortlist");
});

test("S6 closed and expired shortlists can be reopened, or deleted one at a time or ticked together; open ones cannot be deleted", async ({ browser }, testInfo) => {
  const owner = await basicAccount();
  const keep = await customShortlist(owner.id, "Still open");
  const closedOne = await customShortlist(owner.id, "Closed one", { revokedAt: new Date(Date.now() - DAY) });
  const closedTwo = await customShortlist(owner.id, "Closed two", { revokedAt: new Date(Date.now() - 2 * DAY) });
  const expiredOne = await customShortlist(owner.id, "Expired one", { expiresAt: new Date(Date.now() - 3 * DAY) });
  const reopenMe = await customShortlist(owner.id, "Reopen me", { revokedAt: new Date(Date.now() - 4 * DAY) });
  const someone = await person(`Rafa Ostrowski ${tag}`, { userId: owner.id });
  await db.shortlistItem.create({ data: { shortlistId: closedOne.id, personId: someone.id, consentAt: new Date(), position: 0, decision: "interview", decisionAt: new Date() } });
  const recruiter = await signedInAs(browser, owner.id);
  try {
    const page = recruiter.page;
    await page.goto("/shortlists");
    const open = page.getByRole("list", { name: "Open shortlists" });
    const inactive = page.getByRole("list", { name: "Closed and expired shortlists" });
    await expect(open.locator("details.shortlist-row")).toHaveCount(1);
    await expect(inactive.locator("details.shortlist-row")).toHaveCount(4);
    // Only closed and expired rows can be ticked.
    await expect(open.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete selected" })).toBeDisabled();
    await rowOf(page, "Closed one").locator("summary").first().click();
    await page.getByRole("checkbox", { name: "Select Expired one" }).check();
    await page.screenshot({ path: testInfo.outputPath("shortlists-closed-group.png"), fullPage: true });
    await page.getByRole("checkbox", { name: "Select Expired one" }).uncheck();
    await rowOf(page, "Closed one").locator("summary").first().click();

    // Reopening a closed one gives it a new address and moves it to Open.
    const reopen = rowOf(page, "Reopen me");
    await reopen.locator("summary").first().click();
    await expect(reopen).toContainText("Reopening gives it a new address with the same people; the old link stays closed.");
    await reopen.getByRole("button", { name: "Reopen" }).click();
    await expect(open.locator("details.shortlist-row")).toHaveCount(2);
    const reopened = await db.shortlist.findUniqueOrThrow({ where: { id: reopenMe.id }, include: { accesses: true } });
    expect(reopened.revokedAt).toBeNull();
    // Same access, new nonce: the address sent before the close stays dead.
    expect(reopened.accesses.find((access) => access.id === reopenMe.accesses[0].id)?.nonce).not.toBe(reopenMe.accesses[0].nonce);

    // One at a time, from inside the row.
    const single = rowOf(page, "Closed two");
    await single.locator("summary").first().click();
    page.once("dialog", (dialog) => { expect(dialog.message()).toContain('Delete "Closed two" for good?'); dialog.accept(); });
    await single.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(rowOf(page, "Closed two")).toHaveCount(0);
    expect(await db.shortlist.count({ where: { id: closedTwo.id } })).toBe(0);

    // Ticked together: select all, then the count is on the button.
    await page.getByLabel("Select all").check();
    await expect(page.getByRole("button", { name: "Delete 2 selected" })).toBeEnabled();
    await page.getByRole("checkbox", { name: "Select Expired one" }).uncheck();
    await expect(page.getByLabel("Select all")).not.toBeChecked();
    // Declining the confirmation deletes nothing.
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Delete 1 selected" }).click();
    expect(await db.shortlist.count({ where: { id: closedOne.id } })).toBe(1);
    await page.getByRole("checkbox", { name: "Select Expired one" }).check();
    page.once("dialog", (dialog) => { expect(dialog.message()).toContain("Delete 2 shortlists for good?"); dialog.accept(); });
    await page.getByRole("button", { name: "Delete 2 selected" }).click();
    await expect(page.getByRole("list", { name: "Closed and expired shortlists" })).toHaveCount(0);
    expect(await db.shortlist.count({ where: { id: { in: [closedOne.id, expiredOne.id] } } })).toBe(0);
    // The client's answer went with it; the person did not.
    expect(await db.shortlistItem.count({ where: { shortlistId: closedOne.id } })).toBe(0);
    expect(await db.person.count({ where: { id: someone.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { actorId: owner.id, action: "shortlist.deleted" } })).toBe(3);

    // A forged delete naming an open shortlist and another account's closed one removes nothing.
    const other = await basicAccount();
    const theirs = await customShortlist(other.id, "Theirs closed", { revokedAt: new Date() });
    await customShortlist(owner.id, "Bait closed", { revokedAt: new Date() });
    await page.goto("/shortlists");
    await page.evaluate(({ ids }) => {
      for (const id of ids) {
        const input = document.createElement("input");
        input.type = "hidden"; input.name = "id"; input.value = id;
        document.getElementById("delete-shortlists")?.append(input);
      }
    }, { ids: [keep.id, theirs.id] });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("checkbox", { name: "Select Bait closed" }).check();
    await page.getByRole("button", { name: "Delete 1 selected" }).click();
    await expect(rowOf(page, "Bait closed")).toHaveCount(0);
    expect(await db.shortlist.count({ where: { id: { in: [keep.id, theirs.id] } } })).toBe(2);
  } finally {
    await recruiter.close();
  }
});
