import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./helpers";
import { hashPassword, hashToken } from "../lib/auth-crypto";

const BASE = "http://localhost:3100";
const PASSWORD = "TEST-ONLY-account-tier-password-3100!";
const EMPTY_STATE = { cookies: [], origins: [] };
const DAY = 24 * 60 * 60 * 1000;
const CREATE_FORM = 'form:has(input[name="email"]):has(select[name="accountTier"])';
type Tier = "basic" | "pro" | "trial";
type Actor = { id: string; name: string; email: string; token: string; page: Page };
type Accounts = {
  create: (options?: { role?: "admin" | "recruiter"; accountTier?: Tier; trialExpiresAt?: Date | null; activated?: boolean }) => Promise<Actor>;
  guest: () => Promise<Page>;
};
type FormSnapshot = { url: string; fields: Record<string, string> };
let passwordHash: string;

const test = base.extend<{ accounts: Accounts }>({
  accounts: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    const externalRequests: string[] = [];
    const guest = async () => {
      const context = await browser.newContext({ baseURL: BASE, storageState: EMPTY_STATE, serviceWorkers: "block", timezoneId: "America/Los_Angeles" });
      contexts.push(context);
      await context.route((url) => !["localhost", "127.0.0.1"].includes(url.hostname), (route) => {
        externalRequests.push(route.request().url());
        return route.abort();
      });
      return context.newPage();
    };
    try {
      await use({
        guest,
        create: async ({ role = "recruiter", accountTier, trialExpiresAt, activated = false } = {}) => {
          const suffix = randomUUID();
          const user = await db.user.create({ data: {
            email: `tier-${role}-${suffix}@test.capture.invalid`, name: `Tier ${role} ${suffix}`, role, passwordHash,
            ...(accountTier === undefined ? {} : { accountTier }),
            ...(trialExpiresAt === undefined ? {} : { trialExpiresAt }),
            settings: { create: {} },
            ...(activated ? { extensionAccess: { create: { activatedAt: new Date() } } } : {}),
          } });
          const token = randomBytes(32).toString("base64url");
          await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
          const page = await guest();
          await page.context().addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
          return { id: user.id, name: user.name, email: user.email, token, page };
        },
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
      expect(externalRequests, "Account tier pages must not request external resources").toEqual([]);
    }
  },
});

test.use({ storageState: EMPTY_STATE });
test.setTimeout(120_000);
test.beforeAll(async () => { passwordHash = await hashPassword(PASSWORD); });
test.afterAll(async () => { await db.$disconnect(); });

function utcMinute(time = Date.now() + 7 * DAY) {
  return new Date(time).toISOString().slice(0, 16);
}

function tierSelector(actor: Actor) {
  return `article:has(input[value="${actor.id}"]) form:has(select[name="accountTier"])`;
}

function article(page: Page, email: string) {
  return page.locator("article", { hasText: email });
}

async function expectAccountType(page: Page, label: string) {
  await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
  const details = page.getByRole("region", { name: "Account details", exact: true });
  await expect(details.getByText("Account type", { exact: true })).toBeVisible();
  await expect(details.getByText(label, { exact: true })).toBeVisible();
}

async function expectArticleType(page: Page, email: string, label: string) {
  await expect(article(page, email).locator("span").filter({ hasText: new RegExp(`^${label}$`) }).first()).toBeVisible();
}

async function snapshotForm(page: Page, url: string, selector: string): Promise<FormSnapshot> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url}`).toBe(true);
  const fields = await page.evaluate(({ html, selector }) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const form = doc.querySelector<HTMLFormElement>(selector);
    if (!form) throw new Error(`Missing form: ${selector}`);
    doc.querySelectorAll("[disabled]").forEach((element) => element.removeAttribute("disabled"));
    return Object.fromEntries(Array.from(new FormData(form).entries()).map(([key, value]) => [key, String(value)]));
  }, { html: await response.text(), selector });
  expect(Object.keys(fields).some((key) => /^\$ACTION_(ID|REF)_/.test(key)), "Post a real server-action form, not a no-op request").toBe(true);
  return { url, fields };
}

async function postForm(page: Page, form: FormSnapshot, changes: Record<string, string>, origin: string | null = BASE) {
  return page.request.post(form.url, { multipart: { ...form.fields, ...changes }, headers: origin === null ? {} : { Origin: origin } });
}

async function tierEvents(actorId: string) {
  return db.auditEvent.findMany({ where: { actorId, action: { startsWith: "account_tier_changed_to_" } }, orderBy: { createdAt: "asc" } });
}

test("T1 ordinary accounts default to Basic while administrators remain Admin without a tier editor", async ({ accounts }) => {
  const actor = await accounts.create();
  const admin = await accounts.create({ role: "admin" });
  expect(await db.user.findUniqueOrThrow({ where: { id: actor.id } })).toMatchObject({ role: "recruiter", accountTier: "basic", trialExpiresAt: null });
  await actor.page.goto("/account");
  await expectAccountType(actor.page, "Basic");
  await expect(actor.page.getByLabel("Account type", { exact: true })).toHaveCount(0);
  await admin.page.goto("/account");
  await expectAccountType(admin.page, "Admin");
  await admin.page.goto("/admin");
  await expectArticleType(admin.page, actor.email, "Basic");
  await expectArticleType(admin.page, admin.email, "Admin");
  const editor = article(admin.page, actor.email).getByLabel("Account type", { exact: true });
  await expect(editor).toHaveValue("basic");
  await expect(editor.locator("option")).toHaveText(["Basic", "Pro", "Trial"]);
  await expect(article(admin.page, actor.email).getByLabel("Trial expires at (UTC)", { exact: true })).toHaveCount(0);
  await expect(article(admin.page, admin.email).getByLabel("Account type", { exact: true })).toHaveCount(0);
  await expect(article(admin.page, admin.email).getByRole("button", { name: "Save account type", exact: true })).toHaveCount(0);
});

for (const tier of ["basic", "pro", "trial"] as const) {
  test(`T2 administrator creates and activates a ${tier} recruiter with UTC expiry and no implicit extension grant`, async ({ accounts }) => {
    const admin = await accounts.create({ role: "admin" });
    const email = `tier-created-${randomUUID()}@test.capture.invalid`;
    const expiry = utcMinute();
    await admin.page.goto("/admin");
    const create = admin.page.getByRole("region", { name: "Create account", exact: true });
    const select = create.getByLabel("Account type", { exact: true });
    await expect(select).toHaveValue("basic");
    await expect(select).toHaveAttribute("name", "accountTier");
    await expect(select.locator("option")).toHaveText(["Basic", "Pro", "Trial"]);
    await expect(create.getByLabel("Trial expires at (UTC)", { exact: true })).toHaveCount(0);
    await create.getByLabel("Name", { exact: true }).fill(`Created ${tier} recruiter`);
    await create.getByLabel("Email", { exact: true }).fill(email);
    if (tier !== "basic") await select.selectOption(tier);
    if (tier === "trial") {
      const input = create.getByLabel("Trial expires at (UTC)", { exact: true });
      await expect(input).toHaveAttribute("name", "trialExpiresAt");
      await expect(input).toHaveAttribute("type", "datetime-local");
      await input.fill(expiry);
    }
    await create.getByRole("button", { name: "Create account", exact: true }).click();
    const setup = create.getByLabel("One-time setup link", { exact: true });
    await expect(setup).toBeVisible();
    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { extensionAccess: true } });
    expect(user).toMatchObject({ role: "recruiter", accountTier: tier, trialExpiresAt: tier === "trial" ? new Date(`${expiry}:00.000Z`) : null, extensionAccess: null });
    const label = tier[0].toUpperCase() + tier.slice(1);
    await expectArticleType(admin.page, email, label);
    const page = await accounts.guest();
    await page.goto(await setup.inputValue());
    await expect(page.locator('input[name="token"]')).not.toHaveValue("");
    await page.getByLabel("New password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm new password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Set password", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${BASE}/`);
    await page.goto("/account");
    await expectAccountType(page, label);
    expect((await page.request.get("/api/extension/download")).status()).toBe(403);
    await expect(page.getByRole("region", { name: "Browser extension", exact: true }).getByLabel("Extension activation code", { exact: true })).toBeVisible();
  });
}

test("T3 upgrades and downgrades update existing sessions without changing role, credentials or extension access", async ({ accounts }) => {
  const admin = await accounts.create({ role: "admin" });
  const actor = await accounts.create({ activated: true });
  const before = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  const session = await db.session.findUniqueOrThrow({ where: { tokenHash: hashToken(actor.token) } });
  const access = await db.extensionAccess.findUniqueOrThrow({ where: { userId: actor.id } });
  const settings = await db.settings.findUniqueOrThrow({ where: { userId: actor.id } });
  const expiry = utcMinute();
  await actor.page.goto("/account");
  await expectAccountType(actor.page, "Basic");
  await admin.page.goto("/admin");
  const card = article(admin.page, actor.email);
  for (const tier of ["pro", "trial", "basic"] as const) {
    await card.getByLabel("Account type", { exact: true }).selectOption(tier);
    if (tier === "trial") await card.getByLabel("Trial expires at (UTC)", { exact: true }).fill(expiry);
    else await expect(card.getByLabel("Trial expires at (UTC)", { exact: true })).toHaveCount(0);
    await card.getByRole("button", { name: "Save account type", exact: true }).click();
    await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { id: actor.id } })).accountTier).toBe(tier);
    const label = tier[0].toUpperCase() + tier.slice(1);
    await expectArticleType(admin.page, actor.email, label);
    await actor.page.reload();
    await expectAccountType(actor.page, label);
    expect(await db.user.findUniqueOrThrow({ where: { id: actor.id } })).toMatchObject({ role: "recruiter", authVersion: before.authVersion, passwordHash: before.passwordHash, accountTier: tier, trialExpiresAt: tier === "trial" ? new Date(`${expiry}:00.000Z`) : null });
    expect(await db.session.findUnique({ where: { tokenHash: hashToken(actor.token) } })).toEqual(session);
    expect(await db.extensionAccess.findUnique({ where: { userId: actor.id } })).toEqual(access);
    expect(await db.settings.findUnique({ where: { userId: actor.id } })).toEqual(settings);
    await expect(actor.page.getByRole("region", { name: "Browser extension", exact: true }).getByRole("link", { name: "Download extension ZIP", exact: true })).toBeVisible();
    expect(await db.auditEvent.count({ where: { actorId: admin.id, targetUserId: actor.id, action: `account_tier_changed_to_${tier}` } })).toBe(1);
  }
  expect((await tierEvents(admin.id)).map((event) => event.action)).toEqual(["account_tier_changed_to_pro", "account_tier_changed_to_trial", "account_tier_changed_to_basic"]);
  expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe("admin");
});

test("T4 strict trial validation rejects missing, invalid and expired UTC dates in real creation and classification actions", async ({ accounts }) => {
  const admin = await accounts.create({ role: "admin" });
  const actor = await accounts.create({ accountTier: "pro" });
  const update = await snapshotForm(admin.page, "/admin", tierSelector(actor));
  const create = await snapshotForm(admin.page, "/admin", CREATE_FORM);
  const before = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  const invalidDates = ["", "not-a-date", utcMinute(Date.now() - DAY), utcMinute(Date.now()), "2099-02-29T12:30", "2099-04-31T12:30", "2099-13-01T12:30", "2099-01-01T24:00", "2099-01-01", "2099-01-01T12:30Z", "2099-01-01T12:30+01:00", "2099-01-01T12:30:45"];
  for (const trialExpiresAt of invalidDates) {
    const changed = await postForm(admin.page, update, { accountTier: "trial", trialExpiresAt });
    expect(await changed.text()).toContain('role="alert"');
    expect(await db.user.findUnique({ where: { id: actor.id } })).toEqual(before);
    const email = `tier-invalid-${randomUUID()}@test.capture.invalid`;
    const created = await postForm(admin.page, create, { name: "Invalid trial", email, accountTier: "trial", trialExpiresAt });
    expect(await created.text()).toContain('role="alert"');
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  }
  expect(await tierEvents(admin.id)).toEqual([]);
  expect(await db.auditEvent.count({ where: { actorId: admin.id } })).toBe(0);
  const expiry = utcMinute();
  expect((await postForm(admin.page, update, { accountTier: "trial", trialExpiresAt: expiry })).ok()).toBe(true);
  expect(await db.user.findUniqueOrThrow({ where: { id: actor.id } })).toMatchObject({ role: "recruiter", accountTier: "trial", trialExpiresAt: new Date(`${expiry}:00.000Z`) });
  await admin.page.goto("/admin");
  await expect(article(admin.page, actor.email).getByLabel("Trial expires at (UTC)", { exact: true })).toHaveValue(expiry);
});

test("T5 an expired trial becomes effectively Basic without rewriting historical tier or expiry", async ({ accounts }) => {
  const expiry = new Date(`${utcMinute()}:00.000Z`);
  const actor = await accounts.create({ accountTier: "trial", trialExpiresAt: expiry });
  const admin = await accounts.create({ role: "admin" });
  await actor.page.goto("/account");
  await expectAccountType(actor.page, "Trial");
  const expiredAt = new Date(Date.now() - 1000);
  await db.user.update({ where: { id: actor.id }, data: { trialExpiresAt: expiredAt } });
  await actor.page.reload();
  await expectAccountType(actor.page, "Basic");
  await expect(actor.page.getByRole("region", { name: "Account details", exact: true })).toContainText("Trial expired");
  await admin.page.goto("/admin");
  await expectArticleType(admin.page, actor.email, "Basic");
  expect(await db.user.findUniqueOrThrow({ where: { id: actor.id } })).toMatchObject({ role: "recruiter", accountTier: "trial", trialExpiresAt: expiredAt });
  expect(await tierEvents(admin.id)).toEqual([]);
  expect((await actor.page.request.get("/api/extension/download")).status()).toBe(403);
});

for (const tier of ["basic", "pro", "trial"] as const) {
  test(`T6 ${tier} recruiters cannot forge administrator actions for themselves or arbitrary other accounts`, async ({ accounts }) => {
    const admin = await accounts.create({ role: "admin" });
    const actor = await accounts.create({ accountTier: tier, trialExpiresAt: tier === "trial" ? new Date(Date.now() + DAY) : null });
    const target = await accounts.create();
    const update = await snapshotForm(admin.page, "/admin", tierSelector(target));
    const create = await snapshotForm(admin.page, "/admin", CREATE_FORM);
    expect((await postForm(admin.page, update, { accountTier: "pro" })).ok()).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).accountTier).toBe("pro");
    const users = await db.user.findMany({ where: { id: { in: [actor.id, target.id, admin.id] } }, orderBy: { id: "asc" } });
    for (const userId of [actor.id, target.id, admin.id]) {
      const response = await postForm(actor.page, update, { userId, accountTier: userId === actor.id && tier !== "pro" ? "pro" : "trial", trialExpiresAt: utcMinute(), role: "admin" });
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(await response.text()).toContain("Administrator access is required");
    }
    const email = `tier-forged-${randomUUID()}@test.capture.invalid`;
    const response = await postForm(actor.page, create, { name: "Forged account", email, accountTier: "pro" });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
    expect(await db.user.findMany({ where: { id: { in: [actor.id, target.id, admin.id] } }, orderBy: { id: "asc" } })).toEqual(users);
    expect(await db.auditEvent.count({ where: { actorId: actor.id } })).toBe(0);
    await actor.page.goto("/admin");
    await expect(actor.page.getByRole("heading", { name: "Account administration", exact: true })).toHaveCount(0);
    expect(await actor.page.content()).not.toContain(target.email);
  });
}

test("T7 administrator targets and forged Admin or unknown tiers are rejected without role escalation", async ({ accounts }) => {
  const admin = await accounts.create({ role: "admin" });
  const otherAdmin = await accounts.create({ role: "admin" });
  const actor = await accounts.create();
  const update = await snapshotForm(admin.page, "/admin", tierSelector(actor));
  const create = await snapshotForm(admin.page, "/admin", CREATE_FORM);
  const ids = [admin.id, otherAdmin.id, actor.id];
  const before = await db.user.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
  const attempts: Record<string, string>[] = [{ userId: admin.id, accountTier: "pro" }, { userId: otherAdmin.id, accountTier: "trial", trialExpiresAt: utcMinute() }, { userId: actor.id, accountTier: "admin" }, { userId: actor.id, accountTier: "enterprise" }];
  for (const changes of attempts) {
    const response = await postForm(admin.page, update, changes);
    expect(await response.text()).toContain('role="alert"');
    expect(await db.user.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })).toEqual(before);
  }
  for (const accountTier of ["admin", "enterprise"]) {
    const email = `tier-admin-forged-${randomUUID()}@test.capture.invalid`;
    const response = await postForm(admin.page, create, { name: "Not an administrator", email, accountTier, role: "admin" });
    expect(await response.text()).toContain('role="alert"');
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  }
  expect(await db.auditEvent.count({ where: { actorId: admin.id } })).toBe(0);
  expect((await postForm(admin.page, update, { accountTier: "pro", role: "admin" })).ok()).toBe(true);
  expect(await db.user.findUniqueOrThrow({ where: { id: actor.id } })).toMatchObject({ role: "recruiter", accountTier: "pro" });
});

test("T8 same-origin and writable-workspace checks protect all account management mutations", async ({ accounts }) => {
  const admin = await accounts.create({ role: "admin" });
  const actor = await accounts.create();
  const update = await snapshotForm(admin.page, "/admin", tierSelector(actor));
  const create = await snapshotForm(admin.page, "/admin", CREATE_FORM);
  const reset = await snapshotForm(admin.page, "/admin", `article:has(input[value="${actor.id}"]) details form`);
  const disable = await snapshotForm(admin.page, "/admin", `article:has(input[value="${actor.id}"]) form:has(input[name="active"])`);
  const before = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  for (const origin of [null, "http://localhost:3999", "https://attacker.example.invalid"]) {
    expect((await postForm(admin.page, update, { accountTier: "pro" }, origin)).status()).toBeGreaterThanOrEqual(400);
    const email = `tier-origin-${randomUUID()}@test.capture.invalid`;
    expect((await postForm(admin.page, create, { name: "Origin injection", email, accountTier: "pro" }, origin)).status()).toBeGreaterThanOrEqual(400);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
    expect(await db.user.findUnique({ where: { id: actor.id } })).toEqual(before);
  }
  expect(await db.auditEvent.count({ where: { actorId: admin.id } })).toBe(0);
  await admin.page.goto("/admin");
  await article(admin.page, actor.email).getByRole("button", { name: "View workspace (read-only)", exact: true }).click();
  await expect(admin.page).toHaveURL(`${BASE}/`);
  await expect(admin.page.getByRole("status")).toContainText(`Read-only workspace: ${actor.name}`);
  const auditCount = await db.auditEvent.count({ where: { actorId: admin.id } });
  const denied = await postForm(admin.page, update, { accountTier: "pro" });
  expect(denied.status()).toBeGreaterThanOrEqual(400);
  expect(await denied.text()).toContain("read-only");
  const email = `tier-readonly-${randomUUID()}@test.capture.invalid`;
  const deniedCreate = await postForm(admin.page, create, { name: "Read-only injection", email, accountTier: "trial", trialExpiresAt: utcMinute() });
  expect(deniedCreate.status()).toBeGreaterThanOrEqual(400);
  expect(await deniedCreate.text()).toContain("read-only");
  expect(await db.user.findUnique({ where: { email } })).toBeNull();
  expect(await db.user.findUnique({ where: { id: actor.id } })).toEqual(before);
  expect(await db.auditEvent.count({ where: { actorId: admin.id } })).toBe(auditCount);
  const tokens = await db.activationToken.findMany({ where: { userId: actor.id } });
  const sessions = await db.session.findMany({ where: { userId: actor.id } });
  const settings = await db.settings.findUniqueOrThrow({ where: { userId: actor.id } });
  for (const action of [reset, disable]) {
    const response = await postForm(admin.page, action, {});
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(await response.text()).toContain("read-only");
    expect(await db.user.findUnique({ where: { id: actor.id } })).toEqual(before);
    expect(await db.activationToken.findMany({ where: { userId: actor.id } })).toEqual(tokens);
    expect(await db.session.findMany({ where: { userId: actor.id } })).toEqual(sessions);
    expect(await db.settings.findUnique({ where: { userId: actor.id } })).toEqual(settings);
    expect(await db.auditEvent.count({ where: { actorId: admin.id } })).toBe(auditCount);
  }
  await admin.page.goto("/admin");
  const card = article(admin.page, actor.email);
  for (const name of ["Save account type", "Generate setup/reset link", "Disable account"]) await expect(card.getByRole("button", { name, exact: true })).toHaveCount(0);
  await admin.page.goto("/account");
  await expectAccountType(admin.page, "Admin");
  const details = admin.page.getByRole("region", { name: "Account details", exact: true });
  await expect(details).toContainText(admin.email);
  await expect(details).not.toContainText(actor.email);
  await admin.page.getByRole("button", { name: "Return to my workspace", exact: true }).click();
  await expect(admin.page).toHaveURL(`${BASE}/`);
  expect((await postForm(admin.page, update, { accountTier: "pro" })).ok()).toBe(true);
  expect((await db.user.findUniqueOrThrow({ where: { id: actor.id } })).accountTier).toBe("pro");
});

test("T9 copied actions require a currently active administrator and a valid session", async ({ accounts }) => {
  const actor = await accounts.create();
  for (const failure of ["disabled", "demoted", "expired", "version", "anonymous"] as const) {
    const admin = await accounts.create({ role: "admin" });
    const form = await snapshotForm(admin.page, "/admin", tierSelector(actor));
    if (failure === "disabled") await db.user.update({ where: { id: admin.id }, data: { active: false } });
    if (failure === "demoted") await db.user.update({ where: { id: admin.id }, data: { role: "recruiter", accountTier: "pro" } });
    if (failure === "expired") await db.session.update({ where: { tokenHash: hashToken(admin.token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    if (failure === "version") await db.user.update({ where: { id: admin.id }, data: { authVersion: { increment: 1 } } });
    const page = failure === "anonymous" ? await accounts.guest() : admin.page;
    const before = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
    await postForm(page, form, { accountTier: "pro" });
    expect(await db.user.findUnique({ where: { id: actor.id } })).toEqual(before);
    expect(await tierEvents(admin.id)).toEqual([]);
  }
});

for (const state of ["basic", "pro", "trial", "expired"] as const) {
  test(`T10 ${state} accounts retain ordinary features, private ownership and independent extension rules`, async ({ accounts }) => {
    const actor = await accounts.create({ accountTier: state === "expired" ? "trial" : state, trialExpiresAt: state === "trial" ? new Date(Date.now() + DAY) : state === "expired" ? new Date(Date.now() - DAY) : null });
    const foreign = await accounts.create({ accountTier: "pro" });
    const foreignRole = await db.role.create({ data: { userId: foreign.id, title: `Foreign private role ${foreign.id}`, jobDesc: `Foreign private description ${foreign.id}` } });
    await actor.page.goto(`/account?userId=${foreign.id}`);
    const label = state === "expired" ? "Basic" : state[0].toUpperCase() + state.slice(1);
    await expectAccountType(actor.page, label);
    const details = actor.page.getByRole("region", { name: "Account details", exact: true });
    await expect(details).toContainText(actor.email);
    await expect(details).not.toContainText(foreign.email);
    await expect(actor.page.getByRole("button", { name: "Change password", exact: true })).toBeEnabled();
    expect((await actor.page.request.get("/api/extension/download")).status()).toBe(403);
    await actor.page.goto("/roles/new");
    const form = await snapshotForm(actor.page, "/roles/new", 'form:has(input[name="title"])');
    const title = `Ordinary ${state} role ${actor.id}`;
    expect((await postForm(actor.page, form, { title, userId: foreign.id })).ok()).toBe(true);
    expect(await db.role.count({ where: { userId: actor.id, title } })).toBe(1);
    expect(await db.role.count({ where: { userId: foreign.id, title } })).toBe(0);
    await actor.page.goto("/");
    await expect(actor.page.locator("main")).toContainText(title);
    await expect(actor.page.locator("main")).not.toContainText(foreignRole.title);
    expect((await actor.page.request.get(`/roles/${foreignRole.id}`)).status()).toBe(404);
    await actor.page.goto("/settings");
    await expect(actor.page.getByRole("button", { name: "Save settings", exact: true })).toBeEnabled();
    await expect(actor.page.getByRole("button", { name: /Generate a (capture|new) key/ })).toHaveCount(0);
    expect(await db.extensionAccess.findUnique({ where: { userId: actor.id } })).toBeNull();
  });
}
