import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./helpers";
import { hashPassword, hashToken } from "../lib/auth-crypto";
import { hashExtensionCode } from "../lib/extension-access";

// The setup guide is the first thing a newly activated account sees, so these
// tests care about two things: that it tells the truth about what is still
// missing, and that it never hands out extension access the account has not
// been granted.
const BASE = "http://localhost:3100";
const PASSWORD = "TEST-ONLY-onboarding-password-3100!";
const EMPTY_STATE = { cookies: [], origins: [] };
const WEEK = 7 * 24 * 60 * 60 * 1000;
const GUIDE = "/getting-started";
const DOWNLOAD_LINK = { name: "Download extension ZIP", exact: true } as const;
const secret = () => randomBytes(32).toString("base64url");
type Actor = { id: string; name: string; email: string; page: Page };
type Setup = {
  create: (options?: { role?: "admin" | "recruiter"; name?: string; recruiterName?: string; activated?: boolean }) => Promise<Actor>;
  guest: () => Promise<Page>;
  secrets: string[];
};
let passwordHash: string;

const test = base.extend<{ setup: Setup }>({
  setup: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    const externalRequests: string[] = [];
    const requestUrls: string[] = [];
    const secrets: string[] = [];
    const guest = async () => {
      const context = await browser.newContext({ baseURL: BASE, storageState: EMPTY_STATE, serviceWorkers: "block" });
      contexts.push(context);
      context.on("request", (request) => requestUrls.push(request.url()));
      await context.route((url) => !["localhost", "127.0.0.1"].includes(url.hostname), (route) => {
        externalRequests.push(route.request().url());
        return route.abort();
      });
      return context.newPage();
    };
    try {
      await use({
        guest,
        secrets,
        create: async ({ role = "recruiter", name, recruiterName = "", activated = false } = {}) => {
          const suffix = randomUUID();
          const user = await db.user.create({ data: {
            email: `onboarding-${role}-${suffix}@test.capture.invalid`,
            name: name ?? `Onboarding ${role} ${suffix}`,
            role, passwordHash,
            settings: { create: { recruiterName } },
            ...(activated ? { extensionAccess: { create: { activatedAt: new Date() } } } : {}),
          } });
          const token = secret();
          secrets.push(token);
          await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
          const page = await guest();
          await page.context().addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
          return { id: user.id, name: user.name, email: user.email, page };
        },
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
      expect(externalRequests, "The setup guide must not request external resources").toEqual([]);
      for (const value of secrets) expect(requestUrls.some((url) => url.includes(value)), "Secrets must never be sent in request URLs").toBe(false);
    }
  },
});

test.use({ storageState: EMPTY_STATE });
test.setTimeout(120_000);
test.beforeAll(async () => { passwordHash = await hashPassword(PASSWORD); });
test.afterAll(async () => { await db.$disconnect(); });

function progress(page: Page) {
  return page.getByRole("region", { name: "Setup progress", exact: true });
}

function step(page: Page, heading: string) {
  return page.locator("li.onboarding-step", { has: page.getByRole("heading", { name: heading, exact: true }) });
}

test("O1: a first sign-in on an untouched account lands on the setup guide", async ({ setup }) => {
  const actor = await setup.create();
  const page = await setup.guest();
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(actor.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}${GUIDE}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome");
  await expect(progress(page)).toContainText("1 of 5 done");
});

test("O2: a configured account signs in to the dashboard and loses the setup nav entry", async ({ setup }) => {
  const actor = await setup.create({ recruiterName: "Configured Recruiter", activated: true });
  await db.role.create({ data: { userId: actor.id, title: "Staff Engineer" } });
  await db.settings.update({ where: { userId: actor.id }, data: { captureTokenHash: hashToken(secret()) } });

  const page = await setup.guest();
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(actor.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/`);
  await expect(page.getByRole("region", { name: "Finish setting up", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Getting started", exact: true })).toHaveCount(0);

  // The guide itself stays reachable for reinstalls, and reports completion.
  await page.goto(GUIDE);
  await expect(progress(page)).toContainText("5 of 5 done");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("You are set up");
});

test("O3: the guide tracks each step as it is completed and only then offers the extension", async ({ setup }) => {
  const actor = await setup.create();
  const page = actor.page;
  await page.goto("/");
  const prompt = page.getByRole("region", { name: "Finish setting up", exact: true });
  await expect(prompt).toContainText("1 of 5 setup steps done");
  await expect(page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Getting started", exact: true })).toBeVisible();
  await prompt.getByRole("link", { name: "Open the setup guide", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}${GUIDE}`);

  // Nothing extension-related is offered before the account is activated.
  await expect(page.getByRole("link", DOWNLOAD_LINK)).toHaveCount(0);
  await expect(step(page, "Install the extension in Chrome")).toContainText("Activate extension access first");
  await expect(step(page, "Generate your capture key and connect")).toContainText("Activate extension access first");
  expect((await page.request.get("/api/extension/download")).status()).toBe(403);

  // Outreach details.
  await page.goto("/settings");
  await page.getByLabel(/Your name/).fill("Robin Fielder");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("Settings saved");
  await page.goto(GUIDE);
  await expect(progress(page)).toContainText("2 of 5 done");
  await expect(step(page, "Add your outreach details")).toContainText("Robin Fielder");

  // First open role.
  await page.goto("/roles/new");
  await page.getByLabel(/Job title/i).fill("Backend Engineer");
  await page.getByRole("button", { name: /Create role/i }).click();
  await expect(page).toHaveURL(/\/roles\/[^/]+$/);
  await page.goto(GUIDE);
  await expect(progress(page)).toContainText("3 of 5 done");

  // Extension activation, with a code issued the way an administrator issues one.
  const code = secret();
  setup.secrets.push(code);
  await db.extensionAccess.create({ data: { userId: actor.id, codeHash: hashExtensionCode(code), expiresAt: new Date(Date.now() + WEEK) } });
  await page.goto(GUIDE);
  const activation = step(page, "Activate extension access");
  await activation.getByLabel("Extension activation code", { exact: true }).fill(code);
  await activation.getByRole("button", { name: "Activate extension", exact: true }).click();
  await expect(page.getByRole("link", DOWNLOAD_LINK)).toBeVisible();
  await expect(page).toHaveURL(`${BASE}${GUIDE}`);
  await expect(progress(page)).toContainText("4 of 5 done");

  // Capture key: generated in Settings, which completes the guide.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Generate a capture key", exact: true }).click();
  await expect(page.getByLabel("New capture key", { exact: true })).toBeVisible();
  await page.goto(GUIDE);
  await expect(progress(page)).toContainText("5 of 5 done");
  await expect(progress(page)).toContainText("Nothing left to configure");
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Finish setting up", exact: true })).toHaveCount(0);
});

test("O4: an administrator needs no activation code but still sees the remaining steps", async ({ setup }) => {
  const admin = await setup.create({ role: "admin" });
  await admin.page.goto(GUIDE);
  const activation = step(admin.page, "Activate extension access");
  await expect(activation).toContainText("Administrator access includes the extension");
  await expect(activation.getByLabel("Extension activation code", { exact: true })).toHaveCount(0);
  await expect(admin.page.getByRole("link", DOWNLOAD_LINK)).toBeVisible();
  await expect(progress(admin.page)).toContainText("2 of 5 done");
});

test("O5: a read-only workspace view offers no setup actions", async ({ setup }) => {
  const admin = await setup.create({ role: "admin" });
  const recruiter = await setup.create();
  await admin.page.goto("/admin");
  await admin.page.locator("article", { hasText: recruiter.email }).getByRole("button", { name: /View workspace/i }).click();
  await expect(admin.page.getByRole("status").filter({ hasText: recruiter.email })).toBeVisible();

  await admin.page.goto(GUIDE);
  await expect(admin.page.getByText("Return to your own workspace")).toBeVisible();
  await expect(admin.page.getByRole("region", { name: "Setup progress", exact: true })).toHaveCount(0);
  await expect(admin.page.getByRole("link", DOWNLOAD_LINK)).toHaveCount(0);
  await expect(admin.page.getByLabel("Extension activation code", { exact: true })).toHaveCount(0);
});

test("O6: the guide is private", async ({ setup }) => {
  const page = await setup.guest();
  await page.goto(GUIDE);
  await expect(page).toHaveURL(`${BASE}/login`);
});
