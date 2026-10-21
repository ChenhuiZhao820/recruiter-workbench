import { expect, test, type Browser, type Page } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { db } from "./helpers";
import { hashPassword, hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";
import { trialKeyForEmail } from "../lib/signup-core.mjs";

// Self-serve sign-up, the trial, the read-only state after it and paying with
// Stripe. Email lands in the test outbox (CAPTURE_TEST_MAIL_DIR) and Stripe is
// the local stand-in in tests/anthropic-stub.mjs; webhooks are signed here
// with the test secret, exactly as Stripe signs them.

const BASE = "http://localhost:3100";
const STUB = "http://localhost:8766";
const EMPTY_STATE = { cookies: [], origins: [] };
const PASSWORD = "TEST-ONLY-signup-password-3100!";
const WEBHOOK_SECRET = "whsec_test_only_0000000000000000";
const stripe = new Stripe("sk_test_not_real");
// The page's own messages; Next's route announcer is an alert region too.
const ALERT = 'p[role="alert"]';

test.describe.configure({ mode: "serial" });
test.use({ storageState: EMPTY_STATE });
test.setTimeout(120_000);

const email = (label: string) => `signup-${label}-${randomUUID().slice(0, 8)}@test-capture.example`;

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE, storageState: EMPTY_STATE });
  return context.newPage();
}

async function mailTo(address: string, subject: RegExp, after = 0): Promise<{ subject: string; text: string }> {
  const dir = process.env.CAPTURE_TEST_MAIL_DIR!;
  let found: { subject: string; text: string } | null = null;
  await expect.poll(async () => {
    const names = await readdir(dir).catch(() => [] as string[]);
    const mails = await Promise.all(names.filter((name) => Number(name.split("-")[0]) >= after).sort().map(async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8"))));
    found = mails.reverse().find((mail) => mail.to === address && subject.test(mail.subject)) ?? null;
    return Boolean(found);
  }, { timeout: 15_000 }).toBe(true);
  return found!;
}

async function mailCount(address: string) {
  const dir = process.env.CAPTURE_TEST_MAIL_DIR!;
  const names = await readdir(dir).catch(() => [] as string[]);
  const mails = await Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8"))));
  return mails.filter((mail) => mail.to === address).length;
}

async function fillSignup(page: Page, fields: { name?: string; email: string; password?: string; terms?: boolean }) {
  await page.goto("/signup");
  if (fields.terms !== false) await page.getByRole("checkbox").check();
  await page.getByLabel("Your name").fill(fields.name ?? "Self Serve");
  await page.getByLabel("Work email").fill(fields.email);
  await page.getByLabel("Password", { exact: true }).fill(fields.password ?? PASSWORD);
  await page.getByRole("button", { name: /Email me a code/ }).click();
}

async function signUp(page: Page, address: string, name = "Self Serve") {
  const started = Date.now();
  await fillSignup(page, { name, email: address });
  await expect(page).toHaveURL(`${BASE}/signup/verify`);
  await expect(page.getByText(address)).toBeVisible();
  const mail = await mailTo(address, /is your Retrivr code/, started);
  const code = mail.subject.match(/^(\d{6}) /)![1];
  await page.getByLabel("Six-digit code").fill(code);
  await page.getByRole("button", { name: /Create my account/ }).click();
  await expect(page).toHaveURL(`${BASE}/getting-started`);
  return db.user.findUniqueOrThrow({ where: { email: address } });
}

async function webhook(page: Page, type: string, object: Record<string, unknown>, id = `evt_${randomUUID().replace(/-/g, "")}`) {
  const payload = JSON.stringify({ id, object: "event", type, data: { object }, created: Math.floor(Date.now() / 1000), livemode: false, api_version: null });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
}

function subscription(id: string, customer: string, userId: string, status: string, price = "price_BasicMonthly") {
  return { id, object: "subscription", status, customer, metadata: { userId }, cancel_at_period_end: false, cancel_at: null,
    items: { object: "list", data: [{ id: `si_${id}`, price: { id: price }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400 }] } };
}

async function setSubscriptions(page: Page, subscriptions: Record<string, unknown>) {
  await page.request.post(`${STUB}/__stripe`, { data: { subscriptions } });
}

test("SU1 the homepage leads to sign-up, and a code creates a seven-day Pro trial with nothing an admin would set", async ({ browser }) => {
  const page = await guest(browser);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Try Pro free for 7 days/ })).toHaveAttribute("href", "/signup");
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/signup");
  const address = email("trial");
  const user = await signUp(page, address, "Tamsin Okafor");
  expect(user).toMatchObject({ name: "Tamsin Okafor", role: "recruiter", signupSource: "self", accountTier: "trial", emailVerified: true, termsVersion: "test-terms-1", active: true });
  expect(user.passwordHash).toMatch(/^scrypt\$/);
  expect(user.trialExpiresAt!.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
  expect(user.trialExpiresAt!.getTime() - Date.now()).toBeLessThan(7.1 * 86_400_000);
  expect(await db.trialClaim.findUnique({ where: { keyHash: trialKeyForEmail(address) } })).not.toBeNull();
  expect(await db.pendingSignup.findUnique({ where: { email: address } })).toBeNull();
  expect(await db.authSession.count({ where: { userId: user.id } })).toBe(0);
  expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
  expect(await db.auditEvent.count({ where: { actorId: user.id, action: "account_signed_up" } })).toBe(1);
  expect((await db.settings.findUniqueOrThrow({ where: { userId: user.id } })).recruiterName).toBe("Tamsin Okafor");
  await expect(page.getByRole("status").filter({ hasText: "Pro trial: 7 days left." })).toBeVisible();
  // Pro features and the extension come with the trial.
  expect((await page.request.get("/api/extension/download")).status()).toBe(200);
  // The password works on its own afterwards.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Email", { exact: true }).fill(address);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // The name came with the sign-up, so this is no longer an untouched account.
  await expect(page).toHaveURL(`${BASE}/`);
  await page.context().close();
});

test("SU2 nothing is made without the terms, a real inbox, a strong password or the right code", async ({ browser }) => {
  const page = await guest(browser);
  const address = email("refused");
  await fillSignup(page, { email: address, terms: false });
  await expect(page.locator(ALERT)).toContainText("Agree to the terms");
  await fillSignup(page, { email: `x-${randomUUID().slice(0, 6)}@mailinator.com` });
  await expect(page.locator(ALERT)).toContainText("Throwaway inboxes");
  // A short password stops in the browser, and in the server without it.
  await fillSignup(page, { email: address, password: "short" });
  await expect(page).toHaveURL(`${BASE}/signup`);
  expect(await page.getByLabel("Password", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.tooShort)).toBe(true);
  await page.getByLabel("Password", { exact: true }).evaluate((input: HTMLInputElement) => input.removeAttribute("minlength"));
  await page.getByRole("button", { name: /Email me a code/ }).click();
  await expect(page.locator(ALERT)).toContainText(/12/);
  expect(await db.pendingSignup.findUnique({ where: { email: address } })).toBeNull();
  expect(await mailCount(address)).toBe(0);

  await fillSignup(page, { email: address });
  await expect(page).toHaveURL(`${BASE}/signup/verify`);
  const mail = await mailTo(address, /is your Retrivr code/);
  const code = mail.subject.slice(0, 6);
  const wrong = code === "000000" ? "111111" : "000000";
  await page.getByLabel("Six-digit code").fill(wrong);
  await page.getByRole("button", { name: /Create my account/ }).click();
  await expect(page.locator(ALERT)).toContainText("wrong or has expired");
  expect(await db.user.findUnique({ where: { email: address } })).toBeNull();
  // The code is the only way in: Better Auth's own routes are closed.
  for (const [method, route] of [["POST", "/api/auth/email-otp/send-verification-otp"], ["POST", "/api/auth/sign-in/email-otp"], ["POST", "/api/auth/sign-up/email"], ["GET", "/api/auth/get-session"], ["POST", "/api/auth/update-user"]] as const) {
    const response = method === "GET" ? await page.request.get(route) : await page.request.post(route, { data: { email: address, otp: code }, headers: { origin: BASE } });
    expect(response.status(), route).toBe(404);
  }
  expect(await db.user.findUnique({ where: { email: address } })).toBeNull();
  // Without the sign-up cookie, the code page sends you back to the start.
  const other = await guest(browser);
  await other.goto("/signup/verify");
  await expect(other).toHaveURL(`${BASE}/signup`);
  await other.context().close();
  await page.context().close();
});

test("SU3 signing up with an address that has an account says so by email, never on the page", async ({ browser }) => {
  const address = email("existing");
  await db.user.create({ data: { email: address, name: "Existing", role: "recruiter", passwordHash: await hashPassword(PASSWORD), settings: { create: { seenRelease: CURRENT_RELEASE } } } });
  const page = await guest(browser);
  await fillSignup(page, { email: address });
  await expect(page).toHaveURL(`${BASE}/signup/verify`);
  await mailTo(address, /already have a Retrivr account/);
  expect(await db.pendingSignup.findUnique({ where: { email: address } })).toBeNull();
  expect(await db.user.count({ where: { email: address } })).toBe(1);
  await page.context().close();
});

test("SU4 an ended trial is a read-only workspace; paying through Stripe opens it again", async ({ browser }) => {
  const page = await guest(browser);
  const address = email("billing");
  const user = await signUp(page, address);
  const role = await db.role.create({ data: { userId: user.id, title: "Kept while read-only" } });
  await db.user.update({ where: { id: user.id }, data: { trialExpiresAt: new Date(Date.now() - 1000) } });

  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "Your trial has ended" })).toBeVisible();
  await expect(page.getByText("Kept while read-only")).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
  expect((await page.request.get("/api/export")).status()).toBe(200);
  expect((await page.request.get("/api/extension/download")).status()).toBe(403);

  // Choosing a plan goes to Stripe's page, for this account and nothing else.
  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Choose a plan" })).toBeVisible();
  await expect(page.locator("article").filter({ has: page.getByRole("heading", { name: "Pro Max", exact: true }) })).toHaveCount(1);
  await page.locator("article").filter({ has: page.getByRole("heading", { name: "Basic", exact: true }) }).getByRole("button", { name: /month/ }).click();
  await expect(page).toHaveURL(/localhost:8766\/stripe-checkout\/cs_test_/);
  const checkout = (await (await page.request.get(`${STUB}/__stripe`)).json()).lastCheckout;
  expect(checkout).toMatchObject({ mode: "subscription", "line_items[0][price]": "price_BasicMonthly", client_reference_id: user.id, customer_email: address, "subscription_data[metadata][userId]": user.id });

  // Paying is only real once Stripe's signed webhook says so.
  const subId = `sub_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const customer = `cus_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  await setSubscriptions(page, { [subId]: subscription(subId, customer, user.id, "active") });
  const unsigned = await page.request.post("/api/billing/webhook", { data: "{}", headers: { "stripe-signature": "t=1,v1=forged" } });
  expect(unsigned.status()).toBe(400);
  const eventId = `evt_${randomUUID().replace(/-/g, "")}`;
  expect((await webhook(page, "checkout.session.completed", { id: "cs_test_1", object: "checkout.session", mode: "subscription", subscription: subId, customer, client_reference_id: user.id }, eventId)).status()).toBe(200);
  const paid = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(paid).toMatchObject({ stripeCustomerId: customer, stripeSubscriptionId: subId, billingPlan: "basic", billingInterval: "monthly", billingStatus: "active", accountTier: "trial" });
  // A redelivered event changes nothing more.
  expect(await (await webhook(page, "checkout.session.completed", { id: "cs_test_1", object: "checkout.session", mode: "subscription", subscription: subId, customer, client_reference_id: user.id }, eventId)).json()).toMatchObject({ duplicate: true });

  await page.goto("/billing");
  await expect(page.getByText("Basic, billed monthly")).toBeVisible();
  await expect(page.getByRole("button", { name: /Manage billing/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose a plan" })).toHaveCount(0);
  await page.goto(`/roles/${role.id}`);
  await expect(page.getByRole("status").filter({ hasText: "Your trial has ended" })).toHaveCount(0);
  expect((await page.request.get("/api/extension/download")).status()).toBe(200);

  // Stripe says the card failed: the plan holds for the grace period, then goes.
  await setSubscriptions(page, { [subId]: subscription(subId, customer, user.id, "past_due") });
  await webhook(page, "customer.subscription.updated", { id: subId, object: "subscription" });
  const pastDue = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(pastDue.billingStatus).toBe("past_due");
  expect(pastDue.billingPastDueSince).not.toBeNull();
  expect((await page.request.get("/api/extension/download")).status()).toBe(200);
  await db.user.update({ where: { id: user.id }, data: { billingPastDueSince: new Date(Date.now() - 8 * 86_400_000) } });
  expect((await page.request.get("/api/extension/download")).status()).toBe(403);

  // Cancelled: no plan again, and the account's data is all still there.
  await setSubscriptions(page, { [subId]: subscription(subId, customer, user.id, "canceled") });
  await webhook(page, "customer.subscription.deleted", { id: subId, object: "subscription" });
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).billingStatus).toBe("canceled");
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "Your trial has ended" })).toBeVisible();
  expect(await db.role.count({ where: { userId: user.id } })).toBe(1);
  await page.context().close();
});

test("SU5 a webhook for someone else's customer or an unknown price grants nothing", async ({ browser }) => {
  const page = await guest(browser);
  const user = await signUp(page, email("foreign"));
  await db.user.update({ where: { id: user.id }, data: { trialExpiresAt: new Date(Date.now() - 1000) } });
  const subId = `sub_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  // A price this deployment does not sell.
  await setSubscriptions(page, { [subId]: subscription(subId, "cus_unknownprice", user.id, "active", "price_SomethingElse") });
  await webhook(page, "checkout.session.completed", { id: "cs_x", object: "checkout.session", mode: "subscription", subscription: subId, customer: "cus_unknownprice", client_reference_id: user.id });
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).billingPlan).toBeNull();
  expect((await page.request.get("/api/extension/download")).status()).toBe(403);
  // A subscription belonging to another customer cannot be pinned on this account.
  const other = await db.user.create({ data: { email: email("other"), name: "Other", role: "recruiter", stripeCustomerId: "cus_someoneelse", settings: { create: {} } } });
  const otherSub = `sub_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  await setSubscriptions(page, { [otherSub]: subscription(otherSub, "cus_someoneelse", user.id, "active", "price_ProMonthly") });
  await webhook(page, "customer.subscription.created", { id: otherSub, object: "subscription" });
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).billingPlan).toBeNull();
  expect((await db.user.findUniqueOrThrow({ where: { id: other.id } })).billingPlan).toBe("pro");
  await page.context().close();
});

test("SU6 deleting your own account keeps the trial used; signing up again starts without one", async ({ browser }) => {
  const page = await guest(browser);
  const address = email("again");
  const user = await signUp(page, address);
  await page.goto("/account");
  await page.getByText("Delete account", { exact: true }).click();
  await page.getByLabel(`Type ${address} to confirm`).fill(address);
  await page.getByRole("button", { name: "Delete account permanently" }).click();
  await expect(page).toHaveURL(`${BASE}/welcome`);
  expect(await db.user.findUnique({ where: { id: user.id } })).toBeNull();
  expect(await db.auditEvent.count({ where: { targetUserId: user.id, action: "account_deleted_by_owner" } })).toBe(1);
  expect(await db.trialClaim.findUnique({ where: { keyHash: trialKeyForEmail(address) } })).not.toBeNull();

  const plus = address.replace("@", "+second@");
  const again = await signUp(page, plus);
  expect(again).toMatchObject({ signupSource: "self", accountTier: "trial", trialExpiresAt: null });
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "Your trial has ended" })).toBeVisible();
  await page.context().close();
});

test("SU7 forgot password emails a one-hour link that sets a new password and signs out everywhere", async ({ browser }) => {
  const address = email("reset");
  const user = await db.user.create({ data: { email: address, name: "Resetting", role: "recruiter", passwordHash: await hashPassword(PASSWORD), settings: { create: { seenRelease: CURRENT_RELEASE, recruiterName: "Resetting" } } } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: 0, expiresAt: new Date(Date.now() + 3_600_000) } });
  const page = await guest(browser);
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL(`${BASE}/forgot-password`);
  // The form is a client form; let it hydrate before using it.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(address);
  await page.getByRole("button", { name: /Email me a link/ }).click();
  await expect(page.getByRole("status")).toContainText("If that address has a Retrivr account");
  // An unknown address gets the same answer and no email.
  const unknown = email("nobody");
  await page.getByLabel("Email").fill(unknown);
  await page.getByRole("button", { name: /Email me a link/ }).click();
  await expect(page.getByRole("status")).toContainText("If that address has a Retrivr account");
  expect(await mailCount(unknown)).toBe(0);
  const mail = await mailTo(address, /Set a new Retrivr password/);
  const link = mail.text.match(/https?:\/\/\S+\/activate#token=[A-Za-z0-9_-]{43}/)![0];
  const activation = await db.activationToken.findFirstOrThrow({ where: { userId: user.id } });
  expect(activation.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3_600_000);
  await page.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
  const fresh = "TEST-ONLY-new-password-3100!";
  await page.getByLabel("New password", { exact: true }).fill(fresh);
  await page.getByLabel("Confirm new password", { exact: true }).fill(fresh);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page).toHaveURL(/\/login\?activated=1/);
  expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  await page.getByLabel("Email", { exact: true }).fill(address);
  await page.getByLabel("Password", { exact: true }).fill(fresh);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/`);
  await page.context().close();
});

test("SU10 the terms and the privacy policy are public pages naming who runs Retrivr", async ({ browser }) => {
  const page = await guest(browser);
  const external: string[] = [];
  page.on("request", (request) => { if (!request.url().startsWith(BASE)) external.push(request.url()); });
  for (const [route, heading] of [["/terms", "Terms of service"], ["/privacy", "Privacy policy"]]) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText(/Aditya Umang Shah, trading as Basanite/).first()).toBeVisible();
    await expect(page.locator(".legal-draft")).toHaveCount(0);
    await expect(page.locator(".legal-doc")).not.toContainText("[");
    await expect(page.locator(".legal-doc")).not.toContainText("undefined");
  }
  await expect(page.getByText(/Frankfurt/).first()).toBeVisible();
  expect(external).toEqual([]);
  await page.context().close();
});

test("SU8 Google and Microsoft sign-in leave from this site with PKCE and their own client, and a new account needs the terms first", async ({ browser }) => {
  const page = await guest(browser);
  await page.goto("/login");
  for (const provider of ["google", "microsoft"]) {
    const response = await page.request.post("/api/auth/sign-in/social", { data: { provider, callbackURL: "/", errorCallbackURL: "/login?error=provider" }, headers: { origin: BASE } });
    expect(response.status(), provider).toBe(200);
    const url = new URL((await response.json()).url);
    expect(url.hostname).toBe(provider === "google" ? "accounts.google.com" : "login.microsoftonline.com");
    expect(url.searchParams.get("client_id")).toBe(provider === "google" ? "test-google-client" : "test-microsoft-client");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback/${provider}`);
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("scope")).not.toMatch(/calendar/i);
  }
  // Another site cannot start one.
  expect((await page.request.post("/api/auth/sign-in/social", { data: { provider: "google", callbackURL: "/" }, headers: { origin: "https://elsewhere.example" } })).status()).toBe(403);
  // On the sign-up page the buttons refuse until the terms are ticked.
  await page.goto("/signup");
  await page.getByRole("button", { name: "Sign up with Google" }).click();
  await expect(page.locator(ALERT)).toContainText("Agree to the terms");
  await expect(page).toHaveURL(`${BASE}/signup`);
  await page.context().close();
});

test("SU9 forgot password and sign-up work before the page's script has loaded", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE, storageState: EMPTY_STATE, javaScriptEnabled: false });
  const page = await context.newPage();
  const address = email("nojs-reset");
  await db.user.create({ data: { email: address, name: "No Script", role: "recruiter", passwordHash: await hashPassword(PASSWORD), settings: { create: { seenRelease: CURRENT_RELEASE } } } });
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(address);
  await page.getByRole("button", { name: /Email me a link/ }).click();
  await expect(page.getByRole("status")).toContainText("If that address has a Retrivr account");
  await mailTo(address, /Set a new Retrivr password/);

  // Sign-up: the terms box, a refusal shown on the page, and on to the code.
  const newcomer = email("nojs-signup");
  await fillSignup(page, { email: newcomer, terms: false });
  await expect(page.locator(ALERT)).toContainText("Agree to the terms");
  await fillSignup(page, { email: `x-${randomUUID().slice(0, 6)}@mailinator.com` });
  await expect(page.locator(ALERT)).toContainText("Throwaway inboxes");
  await fillSignup(page, { email: newcomer });
  await expect(page).toHaveURL(`${BASE}/signup/verify`);
  const mail = await mailTo(newcomer, /is your Retrivr code/);
  const code = mail.subject.slice(0, 6);
  await page.getByLabel("Six-digit code").fill(code === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: /Create my account/ }).click();
  await expect(page.locator(ALERT)).toContainText("wrong or has expired");
  await page.getByLabel("Six-digit code").fill(code);
  await page.getByRole("button", { name: /Create my account/ }).click();
  await expect(page).toHaveURL(`${BASE}/getting-started`);
  expect(await db.user.findUnique({ where: { email: newcomer } })).toMatchObject({ signupSource: "self", accountTier: "trial" });
  await context.close();
});
