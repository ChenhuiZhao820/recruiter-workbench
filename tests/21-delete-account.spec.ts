import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./helpers";
import { CURRENT_RELEASE } from "../lib/release";
import { hashToken } from "../lib/auth-crypto";

const BASE = "http://localhost:3100";
const EMPTY_STATE = { cookies: [], origins: [] };
type Actor = { id: string; email: string; page: Page };

const test = base.extend<{ create: (role?: "admin" | "recruiter") => Promise<Actor> }>({
  create: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (role = "recruiter") => {
      const suffix = randomUUID();
      const user = await db.user.create({ data: {
        email: `del-${role}-${suffix}@test.capture.invalid`, name: `Del ${role} ${suffix}`, role,
        settings: { create: { seenRelease: CURRENT_RELEASE } },
      } });
      const token = randomBytes(32).toString("base64url");
      await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
      const context = await browser.newContext({ baseURL: BASE, storageState: EMPTY_STATE, serviceWorkers: "block" });
      contexts.push(context);
      await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
      return { id: user.id, email: user.email, page: await context.newPage() };
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

test.use({ storageState: EMPTY_STATE });
test.setTimeout(120_000);
test.afterAll(async () => { await db.$disconnect(); });

test("D1 an admin deletes a recruiter account and all its data, after typing the email", async ({ create }) => {
  const admin = await create("admin");
  const target = await create();
  const other = await create();
  const role = await db.role.create({ data: { userId: target.id, title: "Doomed role", candidates: { create: { fullName: "Gone Person" } } } });
  await db.messageTemplate.create({ data: { userId: target.id, name: "T", body: "Hi" } });
  await db.role.create({ data: { userId: other.id, title: "Survivor role" } });

  await admin.page.goto(`/admin/${target.id}`);
  await admin.page.getByText("Delete account", { exact: true }).click();
  await admin.page.getByLabel(/Type .* to confirm/).fill("wrong@example.com");
  await admin.page.getByRole("button", { name: "Delete account permanently" }).click();
  await expect(admin.page.locator("p[role=alert]")).toContainText("exactly");
  expect(await db.user.count({ where: { id: target.id } })).toBe(1);

  await admin.page.getByLabel(/Type .* to confirm/).fill(target.email);
  await admin.page.getByRole("button", { name: "Delete account permanently" }).click();
  await expect(admin.page).toHaveURL(/\/admin$/);
  expect(await db.user.count({ where: { id: target.id } })).toBe(0);
  expect(await db.role.count({ where: { id: role.id } })).toBe(0);
  expect(await db.candidate.count({ where: { roleId: role.id } })).toBe(0);
  expect(await db.session.count({ where: { userId: target.id } })).toBe(0);
  expect(await db.user.count({ where: { id: other.id } })).toBe(1);
  expect(await db.role.count({ where: { userId: other.id } })).toBe(1);
  expect(await db.auditEvent.count({ where: { actorId: admin.id, targetUserId: target.id, action: "account_deleted" } })).toBe(1);
  expect((await admin.page.request.get(`/admin/${target.id}`)).status()).toBe(404);
});

test("D2 administrators cannot be deleted and the form is absent on their own page", async ({ create }) => {
  const admin = await create("admin");
  const second = await create("admin");
  await admin.page.goto(`/admin/${second.id}`);
  await expect(admin.page.getByText("Delete account", { exact: true })).toHaveCount(0);
  await admin.page.goto(`/admin/${admin.id}`);
  await expect(admin.page.getByText("Delete account", { exact: true })).toHaveCount(0);
});

test("D3 a recruiter cannot reach the admin delete", async ({ create }) => {
  const recruiter = await create();
  const victim = await create();
  const response = await recruiter.page.goto(`/admin/${victim.id}`);
  expect(response?.status()).not.toBe(200);
  expect(await db.user.count({ where: { id: victim.id } })).toBe(1);
});
