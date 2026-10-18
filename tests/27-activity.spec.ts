import { test, expect, type Browser } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";
import { newNonce, shortlistToken } from "../lib/shortlist-core.mjs";

// Activity: what a client does on a link reaches the recruiter as a red count
// on the bell, a New mark on the row, and a line on /activity. A fresh account
// of its own keeps the counts exact; fictional people, disposable database.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const SECRET = "test-only-shortlist-link-secret-00000000";
const DAY = 86_400_000;
let userId = "";
let roleId = "";
let roleLink = "";

async function guest(browser: Browser) {
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  return { page: await context.newPage(), close: () => context.close() };
}

async function recruiter(browser: Browser) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  return { page: await context.newPage(), close: () => context.close() };
}

async function candidateOn(fullName: string) {
  const person = await db.person.create({ data: { userId, fullName, headline: `${fullName.split(" ")[0]} - Data engineer`, searchText: fullName.toLowerCase(), skillsSummary: "dbt, Snowflake" } });
  const candidate = await db.candidate.create({ data: { roleId, fullName, personId: person.id, stage: "screened" } });
  return { person, candidate };
}

test.beforeAll(async () => {
  userId = (await db.user.create({ data: {
    email: `activity-${randomUUID()}@test.capture.invalid`, name: "Activity Recruiter", role: "recruiter", accountTier: "basic",
    settings: { create: { seenRelease: CURRENT_RELEASE, recruiterName: "Activity Recruiter" } },
  } })).id;
  roleId = (await db.role.create({ data: { userId, title: "Activity Test Analytics Lead", client: "Brightwater Group Ltd" } })).id;
  const { person, candidate } = await candidateOn("Saoirse Okonkwo");
  const shortlist = await db.shortlist.create({ data: {
    userId, kind: "role", roleId, title: "Activity Test Analytics Lead", client: "Brightwater Group Ltd", access: "link",
    accesses: { create: { nonce: newNonce() } },
    items: { create: { personId: person.id, candidateId: candidate.id, consentAt: new Date(Date.now() - DAY), position: 0 } },
  }, include: { accesses: true } });
  roleLink = `/s/${shortlistToken(SECRET, shortlist.accesses[0].id, shortlist.accesses[0].nonce)}`;
});

test("A1 a client opening the link and answering shows on the bell, the row and Activity; opening the role reads it", async ({ browser }, testInfo) => {
  const me = await recruiter(browser);
  try {
    await me.page.goto("/");
    const bell = me.page.locator(".activity-bell");
    await expect(bell).toHaveAttribute("data-unread", "0");
    await expect(bell.locator(".unread-badge")).toHaveCount(0);

    const client = await guest(browser);
    try {
      await client.page.goto(roleLink);
      await client.page.reload();
      const entry = client.page.locator(".client-entry", { hasText: "Saoirse Okonkwo" });
      await entry.getByRole("button", { name: "Interview Saoirse" }).click();
      await expect(client.page.getByText("You asked to meet Saoirse.")).toBeVisible();
    } finally {
      await client.close();
    }
    // One for the first open (not one per reload), one for the answer.
    expect(await db.notification.count({ where: { userId } })).toBe(2);

    // The bell asks again when the tab comes back into view, without a reload.
    await me.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(bell).toHaveAttribute("data-unread", "2");
    await expect(bell.locator(".unread-badge")).toHaveText("2");
    await expect(me.page.locator(".nav-item", { hasText: "Activity" }).locator(".unread-badge")).toHaveText("2");
    await me.page.locator(".workspace-topbar").screenshot({ path: testInfo.outputPath("activity-bell.png") });

    // The row says what is new, and opening the role is reading it.
    await me.page.goto(`/roles/${roleId}`);
    const row = me.page.locator("li.card", { hasText: "Saoirse Okonkwo" });
    await expect(row.locator(".new-chip")).toBeVisible();
    await expect(row.getByText("Brightwater Group Ltd wants to meet")).toBeVisible();
    await expect(bell).toHaveAttribute("data-unread", "0");
    expect(await db.notification.count({ where: { userId, readAt: null } })).toBe(0);

    await me.page.goto("/activity");
    const entries = me.page.getByTestId("activity-entry");
    await expect(entries).toHaveCount(2);
    await expect(entries.first()).toContainText("Brightwater Group Ltd wants to meet Saoirse Okonkwo (Activity Test Analytics Lead)");
    await expect(entries.nth(1)).toContainText("opened Activity Test Analytics Lead for the first time");
    await expect(me.page.locator(".activity-entry.is-unread")).toHaveCount(0);
  } finally {
    await me.close();
  }
});

test("A2 rendering is not reading: Activity marks only once on screen, and the count endpoint reads nothing", async ({ browser, request }) => {
  await db.notification.create({ data: { userId, kind: "client_set_hours", roleId } });
  // Without a session there is no count to read.
  expect((await request.get(`${BASE}/api/notifications/unread`, { headers: { cookie: "" } })).status()).toBe(401);
  const me = await recruiter(browser);
  try {
    const response = await me.page.request.get("/api/notifications/unread");
    expect(await response.json()).toEqual({ unread: 1 });
    expect(await db.notification.count({ where: { userId, readAt: null } })).toBe(1);
    await me.page.goto("/activity");
    const fresh = me.page.locator(".activity-entry.is-unread");
    await expect(fresh).toHaveCount(1);
    await expect(fresh).toContainText("Brightwater Group Ltd set their interview hours for Activity Test Analytics Lead");
    await expect(me.page.locator(".activity-bell")).toHaveAttribute("data-unread", "0");
    expect(await db.notification.count({ where: { userId, readAt: null } })).toBe(0);
  } finally {
    await me.close();
  }
});

test("A3 an answer on a custom shortlist shows on the role's row and Follow-ups, and is brought onto the role in one click", async ({ browser }) => {
  const { person, candidate } = await candidateOn("Tobiah Lindqvist");
  const shortlist = await db.shortlist.create({ data: {
    userId, kind: "custom", title: "Analytics people for Brightwater", client: "Brightwater Group", access: "link",
    expiresAt: new Date(Date.now() + 30 * DAY), accesses: { create: { nonce: newNonce() } },
    items: { create: { personId: person.id, consentAt: new Date(Date.now() - DAY), position: 0 } },
  }, include: { accesses: true } });
  const client = await guest(browser);
  try {
    await client.page.goto(`/s/${shortlistToken(SECRET, shortlist.accesses[0].id, shortlist.accesses[0].nonce)}`);
    await client.page.locator(".client-entry", { hasText: "Tobiah Lindqvist" }).getByRole("button", { name: "Interview Tobiah" }).click();
    await expect(client.page.getByText("You asked to meet Tobiah.")).toBeVisible();
  } finally {
    await client.close();
  }

  const me = await recruiter(browser);
  try {
    await me.page.goto("/followups");
    const section = me.page.getByRole("region", { name: "Wants to meet, from a shortlist" });
    await expect(section).toContainText("Tobiah Lindqvist");
    await section.getByRole("link", { name: "Open on Activity Test Analytics Lead" }).click();
    await expect(me.page).toHaveURL(new RegExp(`/roles/${roleId}#candidate-${candidate.id}$`));

    const row = me.page.locator("li.card", { hasText: "Tobiah Lindqvist" });
    await expect(row.getByTestId("answer-elsewhere")).toContainText("Brightwater Group Ltd wants to meet");
    await expect(row.getByTestId("answer-elsewhere")).toContainText("Analytics people for Brightwater");
    await row.getByRole("button", { name: /Add to this role.s client link with this answer/ }).click();
    await expect(row.getByText("On the client link")).toBeVisible();
    await expect(row.getByTestId("answer-elsewhere")).toHaveCount(0);
    await expect(row.locator(".chip.client-said-yes")).toContainText("Brightwater Group Ltd wants to meet");

    const onRole = await db.shortlistItem.findFirstOrThrow({ where: { personId: person.id, shortlist: { roleId } } });
    expect(onRole.decision).toBe("interview");
    expect(onRole.candidateId).toBe(candidate.id);
    expect((await db.candidate.findUniqueOrThrow({ where: { id: candidate.id } })).stage).toBe("submitted");

    // Now it is the role's answer, it is in the usual group, not this one.
    await me.page.goto("/followups");
    await expect(me.page.getByRole("region", { name: "Wants to meet, from a shortlist" })).toHaveCount(0);
    await expect(me.page.getByRole("region", { name: "Client wants to meet" })).toContainText("Tobiah Lindqvist");

    // The shortlist library marks the shortlist the answer came from.
    await db.notification.updateMany({ where: { userId, shortlistId: shortlist.id }, data: { readAt: null } });
    await me.page.goto("/shortlists");
    await expect(me.page.locator("details.shortlist-row", { hasText: "Analytics people for Brightwater" }).locator(".new-chip")).toBeVisible();
  } finally {
    await me.close();
  }
});

test("A4 a read-only view shows the count but marks nothing as read", async ({ browser }) => {
  await db.notification.create({ data: { userId, kind: "client_opened", roleId } });
  const admin = await db.user.findFirstOrThrow({ where: { role: "admin" } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId: admin.id, authVersion: admin.authVersion, viewUserId: userId, expiresAt: new Date(Date.now() + 3_600_000) } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  try {
    const page = await context.newPage();
    await page.goto("/activity");
    await expect(page.locator(".activity-entry.is-unread")).toHaveCount(1);
    await page.goto(`/roles/${roleId}`);
    await expect(page.locator(".activity-bell")).toHaveAttribute("data-unread", "1");
    await page.waitForLoadState("networkidle");
    expect(await db.notification.count({ where: { userId, readAt: null } })).toBe(1);
  } finally {
    await context.close();
  }
});
