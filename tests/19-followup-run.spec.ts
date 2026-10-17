import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";

// The follow-up run: everyone due a follow-up, ticked with reasons, walked
// through one at a time; a suggested reply for people who answered, taken
// with Tab. Runs on a Basic account, because it is on every plan. The model
// is the local stub; only fictional people and the disposable database.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const STUB = "http://localhost:8766";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

let account: { user: { id: string }; page: Page; close: () => Promise<void> };
const ids: Record<string, string> = {};

async function basicAccount(browser: Browser) {
  const user = await db.user.create({ data: {
    email: `run-basic-${randomUUID()}@test.capture.invalid`, name: "Morven Ellis", role: "recruiter", accountTier: "basic",
    settings: { create: { seenRelease: CURRENT_RELEASE, recruiterName: "Morven Ellis" } },
  } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  return { user, page: await context.newPage(), close: () => context.close() };
}

async function candidate(name: string, roleId: string, stage: string, days: number, extra: { nudgeCount?: number; doNotContact?: boolean; sentDaysAgo?: number } = {}) {
  const person = await db.person.create({ data: { userId: account.user.id, fullName: name, searchText: name.toLowerCase(), doNotContact: extra.doNotContact ?? false } });
  const created = await db.candidate.create({ data: {
    roleId, personId: person.id, fullName: name, stage, lastActivityAt: ago(days), nudgeCount: extra.nudgeCount ?? 0,
    profileUrl: `https://www.linkedin.com/in/${name.toLowerCase().replace(/\W+/g, "-")}`,
  } });
  if (extra.sentDaysAgo !== undefined) {
    await db.outreachLog.create({ data: { candidateId: created.id, renderedBody: `Hi ${name.split(" ")[0]}, an earlier note.`, kind: "message", sentAt: ago(extra.sentDaysAgo) } });
  }
  ids[name] = created.id;
}

async function suggest(page: Page, candidateId: string, theirReply: string, origin = BASE) {
  return page.request.post("/api/followups/suggest", { headers: { origin, "content-type": "application/json" }, data: { candidateId, theirReply } });
}

test.beforeAll(async ({ browser }) => {
  account = await basicAccount(browser);
  const role = await db.role.create({ data: { userId: account.user.id, title: "Plant Manager", client: "Halden Systems" } });
  const closed = await db.role.create({ data: { userId: account.user.id, title: "Closed Role", status: "closed" } });
  await candidate("Rhiannon Achterberg", role.id, "replied", 1, { sentDaysAgo: 6 });
  await candidate("Bram Okafor-Lind", role.id, "booking_pending", 12, { sentDaysAgo: 12 });
  await candidate("Quentin Arbuthnot", role.id, "contacted", 20, { sentDaysAgo: 20 });
  await candidate("Twyla Haverford", role.id, "contacted", 25, { nudgeCount: 2, sentDaysAgo: 25 });
  await candidate("Doris Pennington", role.id, "contacted", 22, { doNotContact: true, sentDaysAgo: 22 });
  await candidate("Clement Closedrole", closed.id, "contacted", 30, { sentDaysAgo: 30 });
  await db.messageTemplate.create({ data: { userId: account.user.id, name: "Quiet chaser", kind: "message", body: "Hi {{first_name}}, checking in about {{role_title}}.\n\n{{recruiter_name}}" } });
});

test.afterAll(async () => {
  await account?.close();
});

test("F1 the list is worked out with reasons, ticked or not, and starts from one click on Follow-ups", async () => {
  const { page } = account;
  await page.goto("/followups", { timeout: 90_000 });
  await page.getByRole("link", { name: "Follow up in batches (5)" }).click();
  await expect(page).toHaveURL(/\/followups\/run$/);

  const rowFor = (name: string) => page.locator(".run-row", { hasText: name });
  await expect(page.getByRole("heading", { name: /Replied, waiting on you/ })).toBeVisible();
  await expect(rowFor("Rhiannon Achterberg").getByRole("checkbox")).toBeChecked();
  await expect(rowFor("Rhiannon Achterberg")).toContainText("Replied 1 day ago");
  await expect(rowFor("Bram Okafor-Lind").getByRole("checkbox")).toBeChecked();
  await expect(rowFor("Quentin Arbuthnot").getByRole("checkbox")).toBeChecked();
  await expect(rowFor("Twyla Haverford").getByRole("checkbox")).not.toBeChecked();
  await expect(rowFor("Twyla Haverford")).toContainText("Consider marking them rejected");
  await expect(rowFor("Doris Pennington").getByRole("checkbox")).toBeDisabled();
  await expect(rowFor("Doris Pennington")).toContainText("Do not contact");
  await expect(page.getByText("Clement Closedrole")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start (3)" })).toBeVisible();

  // A tick changes the count; another template re-reads the preview, ticks kept.
  await rowFor("Twyla Haverford").getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Start (4)" })).toBeVisible();
  await rowFor("Twyla Haverford").getByRole("checkbox").uncheck();
  await page.getByLabel("Template for Went quiet").selectOption({ label: "Quiet chaser - Message" });
  await expect(page).toHaveURL(/review=1/);
  await expect(page.getByLabel("Template for Went quiet")).toHaveValue(/.+/);
  await expect(rowFor("Twyla Haverford").getByRole("checkbox")).not.toBeChecked();
  await expect(rowFor("Bram Okafor-Lind").getByRole("checkbox")).toBeChecked();
  const quiet = page.getByRole("region", { name: /Went quiet/ });
  await quiet.getByText("Preview for Quentin").click();
  await expect(quiet.getByText("Hi Quentin, checking in about Plant Manager.")).toBeVisible();

  // Nothing here sends or opens in bulk.
  await expect(page.getByRole("button", { name: /send all|open all|send to all/i })).toHaveCount(0);
});

test("F2 a reply is suggested from what they said, Tab takes it, and Mark as sent moves on", async () => {
  const { page } = account;
  await page.getByRole("button", { name: "Start (3)" }).click();
  await expect(page).toHaveURL(/\/followups\/run\?.*c=r\./);
  await expect(page.getByText("1 of 3")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rhiannon Achterberg" })).toBeVisible();
  const replyBox = page.getByLabel("Your reply");
  await expect(replyBox).toHaveValue("");

  await page.getByLabel("What Rhiannon said").fill("Yes I'm interested, what's the salary range?");
  await expect(page.getByText("Press Tab to use the suggested reply, or write your own.")).toBeVisible();
  const last = await (await fetch(`${STUB}/__last-reply`)).json();
  expect(last).toMatchObject({ model: "claude-haiku-4-5", max_tokens: 400, hasEffort: false, hasThinking: false, delimited: true });

  // Typing the same opening keeps the rest offered; Tab completes it.
  await replyBox.focus();
  await replyBox.pressSequentially("Thanks for");
  await replyBox.press("Tab");
  await expect(replyBox).toHaveValue(/^Thanks for coming back to me\. You said "Yes I'm interested, what's the salary ra" - happy to talk/);
  await expect(replyBox).toBeFocused();
  const sent = await replyBox.inputValue();

  await page.getByRole("button", { name: "Mark as sent", exact: true }).click();
  await expect(page).toHaveURL(/i=1/);
  await expect(page.getByRole("heading", { name: "Bram Okafor-Lind" })).toBeVisible();
  const logged = await db.outreachLog.findFirst({ where: { candidateId: ids["Rhiannon Achterberg"] }, orderBy: { sentAt: "desc" } });
  expect(logged?.renderedBody).toBe(sent);
  expect(await db.usageEvent.count({ where: { userId: account.user.id, kind: "reply_suggested" } })).toBe(1);
});

test("F3 a stage can be settled without a message, the arrow goes back, and an interrupted run can be resumed", async () => {
  const { page } = account;
  // Booking is not set up on this account, so Capture's own text asks for times.
  await expect(page.getByLabel("Message")).toHaveValue(/Could you send me a couple of times that work for you this week\?/);
  await page.getByRole("button", { name: "Mark booked" }).click();
  await expect(page).toHaveURL(/i=2/);
  expect((await db.candidate.findUniqueOrThrow({ where: { id: ids["Bram Okafor-Lind"] } })).stage).toBe("booked");
  await expect(page.getByRole("heading", { name: "Quentin Arbuthnot" })).toBeVisible();
  await expect(page.getByLabel("Message")).toHaveValue("Hi Quentin, checking in about Plant Manager.\n\nMorven Ellis");

  await page.getByRole("link", { name: "Back to Bram" }).click();
  await expect(page).toHaveURL(/i=1/);
  await expect(page.getByRole("heading", { name: "Bram Okafor-Lind" })).toBeVisible();

  await page.goto("/followups");
  await page.getByRole("link", { name: "Continue your run (2 of 3)" }).click();
  await expect(page.getByRole("heading", { name: "Bram Okafor-Lind" })).toBeVisible();
  await page.getByRole("link", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Quentin Arbuthnot" })).toBeVisible();

  await page.getByRole("button", { name: "Mark as sent", exact: true }).click();
  await expect(page.getByRole("heading", { name: "That is everyone." })).toBeVisible();
  await expect(page.getByText("3 people gone through, 2 written to today.")).toBeVisible();
  const quentin = await db.candidate.findUniqueOrThrow({ where: { id: ids["Quentin Arbuthnot"] } });
  expect(quentin.nudgeCount).toBe(1);
  await page.goto("/followups");
  await expect(page.getByRole("link", { name: /Continue your run/ })).toHaveCount(0);
});

test("F4 the suggestion refuses other origins, other accounts' people, read-only views and a spent month, and handles a refusal", async ({ page }) => {
  const own = account.page;
  expect((await suggest(own, ids["Rhiannon Achterberg"], "Sounds good to me", "https://elsewhere.example")).status()).toBe(403);
  expect((await suggest(own, ids["Rhiannon Achterberg"], "short")).status()).toBe(400);
  expect((await suggest(own, ids["Doris Pennington"], "Please stop messaging me")).status()).toBe(409);

  const refused = await suggest(own, ids["Rhiannon Achterberg"], "STUB_REPLY_REFUSE please");
  expect(refused.status()).toBe(422);
  expect((await refused.json()).error).toMatch(/Write it yourself/);

  // The admin's own workspace cannot reach this account's candidate.
  expect((await suggest(page, ids["Rhiannon Achterberg"], "Sounds good to me")).status()).toBe(404);
  // Nor can a read-only view of it spend on its behalf.
  const token = process.env.CAPTURE_TEST_SESSION_TOKEN!;
  await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: account.user.id } });
  try {
    expect((await suggest(page, ids["Rhiannon Achterberg"], "Sounds good to me")).status()).toBe(403);
    await page.goto(`/followups/run?c=q.${ids["Quentin Arbuthnot"]}&i=0`);
    await expect(page.getByRole("heading", { name: "Quentin Arbuthnot" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark as sent", exact: true })).toBeDisabled();
  } finally {
    await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: null } });
  }
  // Somebody else's ids in a run address are dropped, and an empty run starts over.
  await page.goto(`/followups/run?c=q.${ids["Quentin Arbuthnot"]}&i=0`);
  await expect(page).toHaveURL(/\/followups\/run$/);
  await expect(page.getByText("Quentin Arbuthnot")).toHaveCount(0);

  const month = new Date();
  await db.usageEvent.createMany({ data: Array.from({ length: 300 }, () => ({ userId: account.user.id, kind: "reply_suggested", value: null, at: month })) });
  const capped = await suggest(own, ids["Rhiannon Achterberg"], "Another message from them");
  expect(capped.status()).toBe(429);

});
