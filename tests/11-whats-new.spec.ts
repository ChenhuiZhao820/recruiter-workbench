import { test, expect, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./helpers";
import { hashPassword, hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";

// A release is news exactly once per account, and only to an account that used
// an earlier version. These cover who is shown it, that reading it is recorded
// by the recruiter rather than by the page rendering, and that nobody can have
// somebody else's release marked as read for them.

const BASE = "http://localhost:3100";
const PASSWORD = "TEST-ONLY-release-password-3100!";
const EMPTY_STATE = { cookies: [], origins: [] };
const secret = () => randomBytes(32).toString("base64url");

test.use({ storageState: EMPTY_STATE });
test.setTimeout(120_000);

let passwordHash: string;
test.beforeAll(async () => { passwordHash = await hashPassword(PASSWORD); });

async function account({ seen = false, configured = true } = {}) {
  const suffix = randomUUID();
  const user = await db.user.create({
    data: {
      email: `release-${suffix}@test.capture.invalid`,
      name: `Release ${suffix}`,
      role: "recruiter",
      passwordHash,
      settings: {
        create: {
          // "Configured" is what makes an account an established one rather
          // than a brand new one: a new account gets the setup guide instead.
          recruiterName: configured ? "Established Recruiter" : "",
          ...(seen ? { seenRelease: CURRENT_RELEASE } : {}),
        },
      },
    },
  });
  return user;
}

// Settings hold the user with onDelete: Restrict, so they go first.
async function cleanUp(...userIds: string[]) {
  await db.session.deleteMany({ where: { userId: { in: userIds } } });
  await db.settings.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function signedInPage(page: Page, userId: string) {
  const token = secret();
  await db.session.create({
    data: { tokenHash: hashToken(token), userId, authVersion: 0, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  await page.context().addCookies([
    { name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
  ]);
}

test("R1 signing in with an unread release lands on it, and reading it is a decision", async ({ page }) => {
  const user = await account();
  await signIn(page, user.email);
  await expect(page).toHaveURL(`${BASE}/whats-new`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/What.s new/);
  await expect(page.getByRole("heading", { name: /Send outreach walks the shortlist/ })).toBeVisible();
  // Reading the page is not reading the release.
  expect((await db.settings.findUniqueOrThrow({ where: { userId: user.id } })).seenRelease).toBeNull();

  await page.getByRole("button", { name: "Got it", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/`);
  expect((await db.settings.findUniqueOrThrow({ where: { userId: user.id } })).seenRelease).toBe(CURRENT_RELEASE);

  // And it is news only once.
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, user.email);
  await expect(page).toHaveURL(`${BASE}/`);
  await cleanUp(user.id);
});

test("R2 an account already signed in gets a link in the top bar, which leaves with the release", async ({ page }) => {
  const user = await account();
  await signedInPage(page, user.id);
  await page.goto("/");
  const link = page.getByRole("link", { name: /^What.s new$/ });
  await expect(link).toBeVisible();

  // It follows them around rather than waiting for one particular page.
  await page.goto("/searches");
  await expect(link).toBeVisible();

  await link.click();
  await expect(page).toHaveURL(`${BASE}/whats-new`);
  await page.getByRole("button", { name: "Got it", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/`);
  await expect(page.getByRole("link", { name: /^What.s new$/ })).toHaveCount(0);
  await cleanUp(user.id);
});

test("R3 a brand new account is set up, not caught up", async ({ page }) => {
  const user = await account({ configured: false });
  await signIn(page, user.email);
  // What changed since a version they never used is not news to them.
  await expect(page).toHaveURL(`${BASE}/getting-started`);
  await expect(page.getByRole("link", { name: /^What.s new$/ })).toHaveCount(0);
  await cleanUp(user.id);
});

test("R4 the release cannot be read on somebody else's behalf", async ({ page, request }) => {
  const user = await account();
  await signedInPage(page, user.id);
  await page.goto("/whats-new");
  await page.getByRole("button", { name: "Got it", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/`);

  // Reading it is recorded against the account that read it and nobody else:
  // a post carrying no session of its own leaves every other record alone.
  const other = await account();
  await request.post(`${BASE}/whats-new`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: "",
    failOnStatusCode: false,
  });
  expect((await db.settings.findUniqueOrThrow({ where: { userId: other.id } })).seenRelease).toBeNull();
  expect((await db.settings.findUniqueOrThrow({ where: { userId: user.id } })).seenRelease).toBe(CURRENT_RELEASE);
  await cleanUp(user.id, other.id);
});
