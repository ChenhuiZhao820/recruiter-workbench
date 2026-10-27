import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";
import { formatDay } from "../lib/billing-core.mjs";
import { trialKeyForEmail } from "../lib/signup-core.mjs";

// The promo code TRIAL2026 on the billing page: 30 days of Pro for an account
// below Pro, a trial made 30 days long, one redemption per address, and Pro
// accounts refused. The deadline is moved to 2099 for the suite (see
// playwright.config.ts); the 15 November cut-off is in tests/promo.test.mjs.
// Fictional accounts and the disposable database only.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const DAY = 86_400_000;

type Account = { user: { id: string; email: string; createdAt: Date }; page: Page; close: () => Promise<void> };

async function account(browser: Browser, data: Record<string, unknown>, options: { email?: string; viewport?: { width: number; height: number } } = {}): Promise<Account> {
  const user = await db.user.create({ data: {
    email: options.email ?? `promo-${randomUUID()}@test.capture.invalid`, name: "Mara Quist", role: "recruiter",
    settings: { create: { seenRelease: CURRENT_RELEASE, recruiterName: "Mara Quist" } },
    ...data,
  } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] }, ...(options.viewport ? { viewport: options.viewport } : {}) });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  return { user, page: await context.newPage(), close: () => context.close() };
}

async function redeem(page: Page, code: string) {
  await page.getByLabel("Promo code").fill(code);
  await page.getByRole("button", { name: "Redeem" }).click();
}

test("PC1 a trial that ended: the banner offers the code, a wrong one is refused beside the field, TRIAL2026 opens 30 days of Pro", async ({ browser }) => {
  const ended = await account(browser, { signupSource: "self", accountTier: "trial", trialExpiresAt: new Date(Date.now() - DAY) });
  const { page } = ended;
  await page.goto("/");
  const banner = page.getByRole("status").filter({ hasText: "Your trial has ended" });
  await banner.getByRole("link", { name: "Have a promo code?" }).click();
  await expect(page).toHaveURL(`${BASE}/billing?tab=plans&promo=1`);
  const field = page.getByLabel("Promo code");
  await expect(field).toBeFocused();
  await expect(page.getByRole("button", { name: "Redeem" })).toBeDisabled();

  await redeem(page, "TRIAL2025");
  await expect(page.getByText("That code isn't valid. Check it and try again.")).toBeVisible();
  await expect(field).toHaveValue("TRIAL2025");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  expect(await db.user.findUniqueOrThrow({ where: { id: ended.user.id }, select: { promoProUntil: true } })).toEqual({ promoProUntil: null });

  const before = Date.now();
  await redeem(page, " trial-2026 ");
  await expect(page).toHaveURL(`${BASE}/billing?tab=overview&promo=done`);
  const stored = await db.user.findUniqueOrThrow({ where: { id: ended.user.id }, select: { promoProFrom: true, promoProUntil: true } });
  expect(stored.promoProFrom!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  expect(stored.promoProUntil!.getTime() - stored.promoProFrom!.getTime()).toBe(30 * DAY);
  await expect(page.getByRole("status").filter({ hasText: `Pro is on until ${formatDay(stored.promoProUntil!)}.` })).toBeVisible();
  const plan = page.getByRole("region", { name: "Current plan" });
  await expect(plan.getByRole("heading", { name: "Pro trial" })).toBeVisible();
  await expect(plan.getByText("30 days left")).toBeVisible();
  await expect(plan.getByText(`Pro features until ${formatDay(stored.promoProUntil!)}, from the code TRIAL2026.`)).toBeVisible();
  await expect(plan.getByRole("list", { name: "Included in your plan" }).getByText("Email finder")).toBeVisible();
  await expect(page.getByRole("button", { name: "Have a promo code?" })).toHaveCount(0);

  // The workspace is no longer read-only, and the banner counts the days.
  await page.goto("/");
  await expect(page.getByText("Your trial has ended")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Pro trial: 30 days left." })).toBeVisible();
  expect(await db.promoRedemption.count({ where: { keyHash: trialKeyForEmail(ended.user.email) } })).toBe(1);
  expect(await db.auditEvent.count({ where: { targetUserId: ended.user.id, action: "promo.redeemed" } })).toBe(1);
  expect(await db.usageEvent.count({ where: { userId: ended.user.id, kind: "promo_redeemed" } })).toBe(1);
  await ended.close();
});

test("PC2 a trial is made 30 days from when it started, not 30 more", async ({ browser }) => {
  const createdAt = new Date(Date.now() - 2 * DAY);
  const trial = await account(browser, { signupSource: "self", accountTier: "trial", createdAt, trialExpiresAt: new Date(createdAt.getTime() + 7 * DAY) });
  const { page } = trial;
  await page.goto("/billing");
  await page.getByRole("button", { name: "Have a promo code?" }).click();
  await expect(page.getByLabel("Promo code")).toBeFocused();
  await redeem(page, "TRIAL2026");
  await expect(page).toHaveURL(`${BASE}/billing?tab=overview&promo=trial`);
  const until = new Date(trial.user.createdAt.getTime() + 30 * DAY);
  const stored = await db.user.findUniqueOrThrow({ where: { id: trial.user.id }, select: { promoProFrom: true, promoProUntil: true } });
  expect(stored.promoProFrom!.getTime()).toBe(trial.user.createdAt.getTime());
  expect(stored.promoProUntil!.getTime()).toBe(until.getTime());
  await expect(page.getByText(`Your Pro trial now runs until ${formatDay(until)}: 30 days from when it started.`)).toBeVisible();
  await expect(page.getByRole("region", { name: "Current plan" }).getByText("28 days left")).toBeVisible();
  await trial.close();
});

test("PC3 an address redeems once, even from a new account; a second press says so", async ({ browser }) => {
  const email = `promo-again-${randomUUID()}@test.capture.invalid`;
  // The address redeemed before, on an account since deleted.
  await db.promoRedemption.create({ data: { promoId: "trial2026", keyHash: trialKeyForEmail(email.replace("@", "+second@")) } });
  const again = await account(browser, { signupSource: "self", accountTier: "trial", trialExpiresAt: new Date(Date.now() - DAY) }, { email });
  const { page } = again;
  await page.goto("/billing?tab=plans&promo=1");
  await redeem(page, "TRIAL2026");
  await expect(page.getByText("You've already used this code.", { exact: true })).toBeVisible();
  expect(await db.user.findUniqueOrThrow({ where: { id: again.user.id }, select: { promoProUntil: true } })).toEqual({ promoProUntil: null });
  await again.close();

  // An account that redeemed it and still has the form open in another tab.
  const twice = await account(browser, {});
  const first = twice.page;
  const second = await first.context().newPage();
  for (const page of [first, second]) {
    await page.goto("/billing?tab=overview&promo=1");
    await page.getByLabel("Promo code").fill("TRIAL2026");
  }
  await first.getByRole("button", { name: "Redeem" }).click();
  await expect(first).toHaveURL(`${BASE}/billing?tab=overview&promo=done`);
  const { promoProUntil } = await db.user.findUniqueOrThrow({ where: { id: twice.user.id }, select: { promoProUntil: true } });
  await second.getByRole("button", { name: "Redeem" }).click();
  await expect(second.getByText(`You've already used this code. Your free Pro runs until ${formatDay(promoProUntil!)}.`)).toBeVisible();
  expect(await db.promoRedemption.count({ where: { keyHash: trialKeyForEmail(twice.user.email) } })).toBe(1);
  await twice.close();
});

test("PC4 Pro already: the code is not offered, and a press from an old page is refused without spending it", async ({ browser }) => {
  const basic = await account(browser, {});
  const { page } = basic;
  await page.goto("/billing?tab=overview&promo=1");
  await page.getByLabel("Promo code").fill("TRIAL2026");
  // Made Pro while the page was open.
  await db.user.update({ where: { id: basic.user.id }, data: { accountTier: "pro" } });
  await page.getByRole("button", { name: "Redeem" }).click();
  await expect(page.getByText("Your plan already includes Pro, so there is nothing to add. The code has not been used.")).toBeVisible();
  expect(await db.promoRedemption.count({ where: { keyHash: trialKeyForEmail(basic.user.email) } })).toBe(0);
  await page.goto("/billing");
  await expect(page.getByRole("button", { name: "Have a promo code?" })).toHaveCount(0);
  await basic.close();

  for (const data of [{ accountTier: "promax" }, { billingPlan: "pro", billingStatus: "active" }]) {
    const pro = await account(browser, data);
    await pro.page.goto("/billing");
    await expect(pro.page.getByRole("region", { name: "Current plan" })).toBeVisible();
    await expect(pro.page.getByRole("button", { name: "Have a promo code?" })).toHaveCount(0);
    await pro.close();
  }
});

test("PC5 a Basic account gets Pro for 30 days and goes back to Basic after", async ({ browser }) => {
  const basic = await account(browser, {});
  const { page } = basic;
  await page.goto("/billing");
  await page.getByRole("button", { name: "Have a promo code?" }).click();
  await redeem(page, "trial2026");
  await expect(page).toHaveURL(`${BASE}/billing?tab=overview&promo=done`);
  await expect(page.getByRole("region", { name: "Current plan" }).getByRole("heading", { name: "Pro trial" })).toBeVisible();
  await expect(page.getByText("For the whole trial, not per month.")).toBeVisible();

  await db.user.update({ where: { id: basic.user.id }, data: { promoProFrom: new Date(Date.now() - 31 * DAY), promoProUntil: new Date(Date.now() - DAY) } });
  await page.goto("/billing");
  await expect(page.getByRole("region", { name: "Current plan" }).getByRole("heading", { name: "Basic plan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Have a promo code?" })).toHaveCount(0);
  await basic.close();
});

test("PC6 ten tries an hour", async ({ browser }) => {
  const guesser = await account(browser, {});
  const { page } = guesser;
  await page.goto("/billing?tab=overview&promo=1");
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await redeem(page, `WRONG${attempt}`);
    await expect(page.getByText("That code isn't valid. Check it and try again.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Redeem" })).toBeEnabled();
  }
  await redeem(page, "TRIAL2026");
  await expect(page.getByText("Too many tries. Try again in an hour.")).toBeVisible();
  expect(await db.user.findUniqueOrThrow({ where: { id: guesser.user.id }, select: { promoProUntil: true } })).toEqual({ promoProUntil: null });
  await guesser.close();
});

test("PC7 at phone width the field and button stack without sideways scroll", async ({ browser }) => {
  const phone = await account(browser, { signupSource: "self", accountTier: "trial", trialExpiresAt: new Date(Date.now() - DAY) }, { viewport: { width: 375, height: 812 } });
  const { page } = phone;
  await page.goto("/billing?tab=plans&promo=1");
  await expect(page.getByLabel("Promo code")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Measured together: focusing the field scrolls the page under the test.
  const [field, button] = await page.getByLabel("Promo code").evaluate((input) => {
    const redeem = input.closest("form")!.querySelector("button[type=submit]")!;
    return [input.getBoundingClientRect(), redeem.getBoundingClientRect()].map((box) => ({ top: box.top, bottom: box.bottom, width: box.width }));
  });
  expect(button.top).toBeGreaterThanOrEqual(field.bottom);
  expect(button.width).toBeCloseTo(field.width, 0);
  await phone.close();
});
