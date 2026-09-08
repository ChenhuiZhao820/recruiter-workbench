import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from "./helpers";
import { hashPassword, hashToken, verifyPassword } from "../lib/auth-crypto";

const BASE = "http://localhost:3100";
const PASSWORD = "TEST-ONLY-recruiter-password-3100!";
const NEW_PASSWORD = "TEST-ONLY-replacement-password-3100!";
const EMPTY_STATE = { cookies: [], origins: [] };
const secret = () => randomBytes(32).toString("base64url");
type Actor = { id: string; name: string; email: string; token: string; page: Page; context: BrowserContext };
type Accounts = { create: (role?: "admin" | "recruiter") => Promise<Actor>; guest: () => Promise<Page> };
type FormSnapshot = { url: string; fields: Record<string, string> };
let passwordHash: string;

const test = base.extend<{ accounts: Accounts }>({
  accounts: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    const guest = async () => {
      const context = await browser.newContext({ baseURL: BASE, storageState: EMPTY_STATE });
      contexts.push(context);
      await context.route((url) => !["localhost", "127.0.0.1"].includes(url.hostname), (route) => route.abort());
      return context.newPage();
    };
    await use({
      guest,
      create: async (role = "recruiter") => {
        const suffix = randomUUID();
        const user = await db.user.create({ data: {
          email: `${role}-${suffix}@test.capture.invalid`, name: `${role} ${suffix}`, role, passwordHash,
          settings: { create: { recruiterName: `Recruiter ${suffix}` } },
        } });
        const token = secret();
        await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
        const page = await guest();
        const context = page.context();
        await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
        return { id: user.id, name: user.name, email: user.email, token, context, page };
      },
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

test.use({ storageState: EMPTY_STATE });
test.setTimeout(120_000);
test.beforeAll(async () => { passwordHash = await hashPassword(PASSWORD); });
test.afterAll(async () => { await db.$disconnect(); });

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function setPassword(page: Page, url: string, password = PASSWORD) {
  await page.goto(url);
  await expect(page.locator('input[name="token"]')).toHaveValue(new URLSearchParams(new URL(url).hash.slice(1)).get("token")!);
  await expect(page).toHaveURL(`${BASE}/activate`);
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Set password", exact: true }).click();
}

async function workspace(actor: Actor) {
  const role = await db.role.create({ data: { userId: actor.id, title: `Private role ${actor.id}`, jobDesc: `Private briefing input ${actor.id}` } });
  const candidate = await db.candidate.create({ data: { roleId: role.id, fullName: `Private candidate ${actor.id}`, notes: `Private notes ${actor.id}`, stage: "replied" } });
  const search = await db.savedSearch.create({ data: { userId: actor.id, roleId: role.id, name: `Private search ${actor.id}`, keywords: `Private keywords ${actor.id}` } });
  const template = await db.messageTemplate.create({ data: { userId: actor.id, name: `Private template ${actor.id}`, body: `Private message ${actor.id} for {{first_name}}` } });
  return { role, candidate, search, template };
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
  expect(Object.keys(fields).some((key) => /^\$ACTION_(ID|REF)_/.test(key)), "A real server-action form must be posted, not a no-op request").toBe(true);
  return { url, fields };
}

async function postForm(page: Page, form: FormSnapshot, changes: Record<string, string>, origin: string | null = BASE) {
  return page.request.post(form.url, { multipart: { ...form.fields, ...changes }, headers: origin === null ? {} : { Origin: origin } });
}

async function captureKey(actor: Actor) {
  await actor.page.goto("/settings");
  await actor.page.getByRole("button", { name: /Generate a (capture|new) key/ }).click();
  const input = actor.page.getByLabel("New capture key", { exact: true });
  await expect(input).toBeVisible();
  const token = await input.inputValue();
  expect(token).toMatch(/^[A-Za-z0-9_-]{24,128}$/);
  const settings = await db.settings.findUniqueOrThrow({ where: { userId: actor.id } });
  expect(settings.captureTokenHash).toBe(hashToken(token));
  expect(settings.captureTokenHash).not.toBe(token);
  expect(settings).not.toHaveProperty("captureToken");
  return token;
}

async function expectAudit(actorId: string, targetUserId: string, action: string) {
  await expect.poll(() => db.auditEvent.count({ where: { actorId, targetUserId, action } })).toBe(1);
}

async function expectCaptureDenied(page: Page, token: string, roleId: string) {
  const headers = { "X-Capture-Token": token };
  expect((await page.request.get("/api/capture", { headers })).status()).toBe(401);
  expect((await page.request.post("/api/capture", { headers, data: { roleId, fullName: "Must not be captured" } })).status()).toBe(401);
}

test("A1 unauthenticated workspaces redirect and a website cookie is not a capture key", async ({ accounts }) => {
  const page = await accounts.guest();
  for (const route of ["/", "/roles/new", "/searches", "/templates", "/followups", "/settings", "/account", "/admin", "/roles/nonexistent", "/candidates/nonexistent/outreach"]) {
    await page.goto(route);
    await expect(page).toHaveURL(`${BASE}/login`);
    await expect(page.getByRole("heading", { name: "Sign in to Capture" })).toBeVisible();
    await expect(page).toHaveTitle("Capture");
    await expect(page.getByRole("banner").getByRole("link", { name: "Capture", exact: true })).toBeVisible();
  }
  const actor = await accounts.create();
  expect((await actor.page.request.get("/api/capture")).status()).toBe(401);
  await expectCaptureDenied(actor.page, actor.token, "nonexistent");
});

test("A2 login rejects bad credentials, creates a hashed session and logout revokes it", async ({ accounts }) => {
  const page = await accounts.guest();
  await login(page, TEST_ADMIN_EMAIL, "not-the-test-password");
  await expect(page.locator("main").getByRole("alert")).toHaveText("Email or password is incorrect, or this account is unavailable.");
  expect((await page.context().cookies()).find((cookie) => cookie.name === "capture_session")).toBeUndefined();
  await login(page, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
  await expect(page).toHaveURL(`${BASE}/`);
  await expect(page).toHaveTitle("Capture");
  await expect(page.getByRole("banner").getByRole("link", { name: "Capture", exact: true })).toBeVisible();
  const cookie = (await page.context().cookies()).find((entry) => entry.name === "capture_session")!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const session = await db.session.findUniqueOrThrow({ where: { tokenHash: hashToken(cookie.value) }, include: { user: true } });
  expect(session.user.email).toBe(TEST_ADMIN_EMAIL);
  expect(session.tokenHash).not.toBe(cookie.value);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${BASE}/login`);
  expect(await db.session.findUnique({ where: { tokenHash: session.tokenHash } })).toBeNull();
  await page.context().addCookies([cookie]);
  await page.goto("/settings");
  await expect(page).toHaveURL(`${BASE}/login`);
});

test("A3 admin creation uses fragment-only activation, consumes once and records audit events", async ({ accounts }) => {
  const admin = await accounts.create("admin");
  const email = `activated-${randomUUID()}@test.capture.invalid`;
  await admin.page.goto("/admin");
  const create = admin.page.getByRole("region", { name: "Create account", exact: true });
  await create.getByLabel("Name", { exact: true }).fill("Activated Recruiter");
  await create.getByLabel("Email", { exact: true }).fill(email);
  await create.getByRole("button", { name: "Create account", exact: true }).click();
  const link = create.getByLabel("One-time setup link");
  await expect(link).toBeVisible();
  const activationUrl = await link.inputValue();
  const url = new URL(activationUrl);
  expect(url.origin).toBe(BASE);
  expect(url.pathname).toBe("/activate");
  expect(url.search).toBe("");
  const raw = new URLSearchParams(url.hash.slice(1)).get("token")!;
  expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(user).toMatchObject({ role: "recruiter", active: true, passwordHash: null });
  expect(await db.activationToken.findUnique({ where: { tokenHash: hashToken(raw) } })).toMatchObject({ userId: user.id });
  await expectAudit(admin.id, user.id, "account_created");
  await create.getByLabel("Name", { exact: true }).fill("Duplicate account");
  await create.getByLabel("Email", { exact: true }).fill(email);
  await create.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(create.getByRole("alert")).toHaveText("An account already uses this email address.");
  expect(await db.user.count({ where: { email } })).toBe(1);
  const guest = await accounts.guest();
  await login(guest, email);
  await expect(guest.locator("main").getByRole("alert")).toContainText("account is unavailable");
  const requestUrls: string[] = [];
  guest.on("request", (request) => requestUrls.push(request.url()));
  await setPassword(guest, activationUrl);
  await expect(guest).toHaveURL(`${BASE}/login?activated=1`);
  expect(requestUrls.every((requestUrl) => !requestUrl.includes(raw))).toBe(true);
  expect(await db.activationToken.count({ where: { userId: user.id } })).toBe(0);
  const activated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(activated.passwordHash).not.toBe(PASSWORD);
  expect(await verifyPassword(PASSWORD, activated.passwordHash)).toBe(true);
  await expectAudit(user.id, user.id, "password_set");
  await setPassword(guest, activationUrl, NEW_PASSWORD);
  await expect(guest.locator("main").getByRole("alert")).toContainText("already been used");
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(activated.passwordHash);
  await login(guest, email);
  await expect(guest).toHaveURL(`${BASE}/`);
  expect(await db.role.count({ where: { userId: user.id } })).toBe(0);
  await expect(guest.getByRole("link", { name: "Accounts", exact: true })).toHaveCount(0);
  await admin.page.reload();
  await expect(admin.page.getByLabel("One-time setup link")).toHaveCount(0);
  await expect(admin.page.getByRole("region", { name: "Audit history" })).toContainText("account created");
  const audit = JSON.stringify(await db.auditEvent.findMany({ where: { targetUserId: user.id } }));
  for (const privateValue of [PASSWORD, NEW_PASSWORD, raw, activated.passwordHash!]) expect(audit).not.toContain(privateValue);
});

test("A4 reset links expire and reissuing invalidates the previous fragment token", async ({ accounts }) => {
  const admin = await accounts.create("admin");
  const actor = await accounts.create();
  await admin.page.goto("/admin");
  const card = admin.page.locator("article", { hasText: actor.email });
  await card.locator("summary").click();
  await card.getByRole("button", { name: "Generate setup/reset link" }).click();
  const link = card.getByLabel("One-time setup link");
  await expect(link).toBeVisible();
  const first = await link.inputValue();
  const tokenHash = hashToken(new URLSearchParams(new URL(first).hash.slice(1)).get("token")!);
  await db.activationToken.update({ where: { tokenHash }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const guest = await accounts.guest();
  await setPassword(guest, first);
  await expect(guest.locator("main").getByRole("alert")).toContainText("expired");
  expect((await db.user.findUniqueOrThrow({ where: { id: actor.id } })).passwordHash).toBe(passwordHash);
  await card.getByRole("button", { name: "Generate setup/reset link" }).click();
  await expect(link).not.toHaveValue(first);
  const second = await link.inputValue();
  expect(await db.activationToken.findUnique({ where: { tokenHash } })).toBeNull();
  await setPassword(guest, first);
  await expect(guest.locator("main").getByRole("alert")).toContainText("already been used");
  const key = await captureKey(actor);
  await setPassword(guest, second, NEW_PASSWORD);
  await expect(guest).toHaveURL(`${BASE}/login?activated=1`);
  expect(await db.session.count({ where: { userId: actor.id } })).toBe(0);
  await expectCaptureDenied(guest, key, "nonexistent");
  await actor.page.goto("/");
  await expect(actor.page).toHaveURL(`${BASE}/login`);
  expect(await db.auditEvent.count({ where: { actorId: admin.id, targetUserId: actor.id, action: "activation_link_issued" } })).toBe(2);
});

test("A5 role, search, template, candidate and follow-up pages isolate both workspaces", async ({ accounts }) => {
  const alice = await accounts.create();
  const bob = await accounts.create();
  const a = await workspace(alice);
  const b = await workspace(bob);
  for (const [actor, own, other] of [[alice, a, b], [bob, b, a]] as const) {
    for (const [url, visible, hidden] of [
      ["/", own.role.title, other.role.title],
      ["/searches", own.search.name, other.search.name],
      ["/templates", own.template.name, other.template.name],
      ["/followups", own.candidate.fullName, other.candidate.fullName],
      [`/roles/${own.role.id}`, own.candidate.fullName, other.candidate.fullName],
    ]) {
      await actor.page.goto(url);
      await expect(actor.page.locator("main")).toContainText(visible);
      await expect(actor.page.locator("main")).not.toContainText(hidden);
    }
    for (const url of [`/roles/${other.role.id}`, `/roles/${other.role.id}/edit`, `/searches/${other.search.id}/edit`, `/candidates/${other.candidate.id}/outreach`]) {
      await actor.page.goto(url);
      await expect(actor.page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
      const html = await actor.page.content();
      for (const secretText of [other.role.title, other.role.jobDesc!, other.search.name, other.candidate.fullName, other.candidate.notes!, other.template.body]) expect(html).not.toContain(secretText);
    }
    await actor.page.goto(`/candidates/${own.candidate.id}/outreach?template=${other.template.id}`);
    await expect(actor.page.getByRole("region", { name: "Message preview" })).toContainText(`Private message ${actor.id}`);
    await expect(actor.page.locator("main")).not.toContainText(other.template.name);
    await expect(actor.page.locator("main")).not.toContainText(other.template.body);
    await actor.page.goto(`/searches/new?roleId=${other.role.id}`);
    await expect(actor.page.locator("main")).not.toContainText(other.role.title);
    await expect(actor.page.locator(`option[value="${other.role.id}"]`)).toHaveCount(0);
  }
});

test("A6 forged form IDs cannot edit foreign records or attach a foreign role", async ({ accounts }) => {
  const alice = await accounts.create();
  const bob = await accounts.create();
  const a = await workspace(alice);
  const b = await workspace(bob);
  const cases: { url: string; selector: string; own: string; foreign: string; change: Record<string, string>; verify: () => Promise<unknown>; field: string; value: string }[] = [
    { url: `/roles/${a.role.id}/edit`, selector: 'form:has(input[name="title"])', own: a.role.id, foreign: b.role.id, change: { title: "Own role updated" }, verify: () => db.role.findUniqueOrThrow({ where: { id: a.role.id } }), field: "title", value: "Own role updated" },
    { url: `/searches/${a.search.id}/edit`, selector: 'form:has(input[name="name"])', own: a.search.id, foreign: b.search.id, change: { name: "Own search updated" }, verify: () => db.savedSearch.findUniqueOrThrow({ where: { id: a.search.id } }), field: "name", value: "Own search updated" },
    { url: "/templates", selector: `form:has(input[value="${a.template.id}"]):has(input[name="name"])`, own: a.template.id, foreign: b.template.id, change: { name: "Own template updated" }, verify: () => db.messageTemplate.findUniqueOrThrow({ where: { id: a.template.id } }), field: "name", value: "Own template updated" },
    { url: `/roles/${a.role.id}`, selector: `form:has(input[value="${a.candidate.id}"]):has(input[name="fullName"])`, own: a.candidate.id, foreign: b.candidate.id, change: { fullName: "Own candidate updated" }, verify: () => db.candidate.findUniqueOrThrow({ where: { id: a.candidate.id } }), field: "fullName", value: "Own candidate updated" },
  ];
  for (const entry of cases) {
    const form = await snapshotForm(alice.page, entry.url, entry.selector);
    const changes = entry.change;
    const good = await postForm(alice.page, form, { ...changes, id: entry.own });
    expect(good.ok()).toBe(true);
    expect(await entry.verify()).toHaveProperty(entry.field, entry.value);
    const bad = await postForm(alice.page, form, { ...changes, id: entry.foreign });
    expect(await bad.text()).toContain("could not be found");
  }
  expect(await db.role.findUnique({ where: { id: b.role.id } })).toEqual(b.role);
  expect(await db.savedSearch.findUnique({ where: { id: b.search.id } })).toEqual(b.search);
  expect(await db.messageTemplate.findUnique({ where: { id: b.template.id } })).toEqual(b.template);
  expect(await db.candidate.findUnique({ where: { id: b.candidate.id } })).toEqual(b.candidate);
  const add = await snapshotForm(alice.page, `/roles/${a.role.id}`, 'form:has(input[name="roleId"]):has(input[name="fullName"])');
  expect((await postForm(alice.page, add, { fullName: "Own positive control" })).ok()).toBe(true);
  expect(await db.candidate.count({ where: { roleId: a.role.id, fullName: "Own positive control" } })).toBe(1);
  expect(await (await postForm(alice.page, add, { roleId: b.role.id, fullName: "Foreign injection" })).text()).toContain("could not be found");
  const create = await snapshotForm(alice.page, "/searches/new", 'form:has(input[name="name"])');
  expect((await postForm(alice.page, create, { roleId: a.role.id, name: "Own linked control" })).ok()).toBe(true);
  expect(await db.savedSearch.count({ where: { userId: alice.id, roleId: a.role.id, name: "Own linked control" } })).toBe(1);
  expect(await (await postForm(alice.page, create, { roleId: b.role.id, name: "Foreign linked injection" })).text()).toContain("could not be found");
  const edit = await snapshotForm(alice.page, `/searches/${a.search.id}/edit`, 'form:has(input[name="name"])');
  expect(await (await postForm(alice.page, edit, { roleId: b.role.id })).text()).toContain("could not be found");
  expect((await db.savedSearch.findUniqueOrThrow({ where: { id: a.search.id } })).roleId).toBe(a.role.id);
  expect(await db.candidate.count({ where: { roleId: b.role.id } })).toBe(1);
  expect(await db.savedSearch.count({ where: { userId: alice.id, roleId: b.role.id } })).toBe(0);
});

test("A7 outreach rejects foreign candidates and templates without stage or log side effects", async ({ accounts }) => {
  const alice = await accounts.create();
  const bob = await accounts.create();
  const a = await workspace(alice);
  const b = await workspace(bob);
  const form = await snapshotForm(alice.page, `/candidates/${a.candidate.id}/outreach`, 'form:has(input[name="candidateId"])');
  expect((await postForm(alice.page, form, {})).ok()).toBe(true);
  expect(await db.outreachLog.count({ where: { candidateId: a.candidate.id, templateId: a.template.id } })).toBe(1);
  const ownBefore = await db.candidate.findUniqueOrThrow({ where: { id: a.candidate.id } });
  const attempts: Record<string, string>[] = [{ candidateId: b.candidate.id }, { templateId: b.template.id }, { candidateId: b.candidate.id, templateId: b.template.id }];
  for (const changes of attempts) {
    const response = await postForm(alice.page, form, changes);
    expect(response.ok()).toBe(true);
    expect(await db.candidate.findUnique({ where: { id: a.candidate.id } })).toEqual(ownBefore);
    expect(await db.candidate.findUnique({ where: { id: b.candidate.id } })).toEqual(b.candidate);
    expect(await db.outreachLog.count({ where: { candidateId: a.candidate.id } })).toBe(1);
    expect(await db.outreachLog.count({ where: { candidateId: b.candidate.id } })).toBe(0);
  }
});

test("A8 independent settings and one-time hashed keys scope capture GET and POST", async ({ accounts }) => {
  const alice = await accounts.create();
  const bob = await accounts.create();
  const a = await workspace(alice);
  const b = await workspace(bob);
  const bobSettings = await db.settings.findUniqueOrThrow({ where: { userId: bob.id } });
  await alice.page.goto("/settings");
  await alice.page.getByLabel(/Your name/).fill("Alice only");
  await alice.page.getByLabel(/Calendar link/).fill("https://calendar.example.invalid/alice");
  await alice.page.getByLabel("Chase a booking after (days)").fill("3");
  await alice.page.getByRole("button", { name: "Save settings" }).click();
  await expect(alice.page.locator('[data-form-message="notice"]')).toContainText("Settings saved");
  expect(await db.settings.findUnique({ where: { userId: bob.id } })).toEqual(bobSettings);
  await bob.page.goto("/settings");
  await expect(bob.page.getByLabel(/Your name/)).toHaveValue(bobSettings.recruiterName);
  const aliceKey = await captureKey(alice);
  const bobKey = await captureKey(bob);
  expect(aliceKey).not.toBe(bobKey);
  const guest = await accounts.guest();
  for (const [actor, own, other, token] of [[alice, a, b, aliceKey], [bob, b, a, bobKey]] as const) {
    const headers = { "X-Capture-Token": token };
    const list = await guest.request.get("/api/capture", { headers });
    expect(list.status()).toBe(200);
    expect(await list.json()).toEqual({ account: { id: actor.id, email: actor.email, name: actor.name }, roles: [{ id: own.role.id, title: own.role.title, client: null }] });
    const denied = await guest.request.post("/api/capture", { headers, data: { roleId: other.role.id, fullName: "Foreign capture injection" } });
    expect(denied.status()).toBe(404);
    const accepted = await guest.request.post("/api/capture", { headers, data: { roleId: own.role.id, fullName: `Captured for ${actor.id}` } });
    expect(accepted.status()).toBe(201);
    expect(await accepted.json()).toMatchObject({ ok: true, fullName: `Captured for ${actor.id}`, warning: null });
    expect(await db.candidate.count({ where: { roleId: other.role.id, fullName: "Foreign capture injection" } })).toBe(0);
    await actor.page.reload();
    await expect(actor.page.getByLabel("New capture key", { exact: true })).toHaveCount(0);
    expect(await actor.page.content()).not.toContain(token);
    expect(await actor.page.content()).not.toContain(hashToken(token));
  }
  const cookieMismatch = await bob.page.request.get("/api/capture", { headers: { "X-Capture-Token": aliceKey } });
  expect((await cookieMismatch.json()).account.id).toBe(alice.id);
  const rotated = await captureKey(alice);
  expect(rotated).not.toBe(aliceKey);
  await expectCaptureDenied(guest, aliceKey, a.role.id);
  expect((await guest.request.get("/api/capture", { headers: { "X-Capture-Token": bobKey } })).status()).toBe(200);
  await alice.page.getByRole("button", { name: "Switch capture off" }).click();
  await expect(alice.page.locator('[data-form-message="notice"]')).toContainText("Capture switched off");
  await expectCaptureDenied(guest, rotated, a.role.id);
});

test("A9 admin view is not impersonation and blocks disabled UI and crafted workspace mutations", async ({ accounts }) => {
  const admin = await accounts.create("admin");
  const recruiter = await accounts.create();
  const own = await workspace(admin);
  const target = await workspace(recruiter);
  const keyRequestPromise = admin.page.waitForRequest((request) => request.method() === "POST" && Boolean(request.headers()["next-action"]));
  const adminKey = await captureKey(admin);
  const keyRequest = await keyRequestPromise;
  const recruiterKey = await captureKey(recruiter);
  const ownSettings = await db.settings.findUniqueOrThrow({ where: { userId: admin.id } });
  const targetSettings = await db.settings.findUniqueOrThrow({ where: { userId: recruiter.id } });
  await admin.page.goto("/admin");
  await admin.page.locator("article", { hasText: recruiter.email }).getByRole("button", { name: "View workspace (read-only)" }).click();
  await expect(admin.page).toHaveURL(`${BASE}/`);
  await expect(admin.page.getByRole("status")).toContainText(`Read-only workspace: ${recruiter.name}`);
  await expect(admin.page.getByRole("status")).toContainText(`You are still signed in as ${admin.name}`);
  expect(await db.session.findUnique({ where: { tokenHash: hashToken(admin.token) } })).toMatchObject({ userId: admin.id, viewUserId: recruiter.id });
  await expect(admin.page.locator("main")).toContainText(target.role.title);
  await expect(admin.page.locator("main")).not.toContainText(own.role.title);
  await expectAudit(admin.id, recruiter.id, "workspace_view_started");
  const cases: { url: string; button: string; selector: string; changes: Record<string, string> }[] = [
    { url: `/roles/${target.role.id}/edit`, button: "Save role", selector: 'form:has(input[name="title"])', changes: { title: "Read-only injection" } },
    { url: `/roles/${target.role.id}`, button: "Add candidate", selector: 'form:has(input[name="roleId"]):has(input[name="fullName"])', changes: { fullName: "Read-only injection" } },
    { url: `/searches/${target.search.id}/edit`, button: "Save search", selector: 'form:has(input[name="name"])', changes: { name: "Read-only injection" } },
    { url: "/templates", button: "Create template", selector: 'form:has(input[id="new-tname"])', changes: { name: "Read-only injection", body: "Must not save", kind: "message" } },
    { url: `/candidates/${target.candidate.id}/outreach`, button: "Mark as sent", selector: 'form:has(input[name="candidateId"])', changes: { renderedBody: "Read-only injection" } },
    { url: "/settings", button: "Save settings", selector: 'form:has(input[name="recruiterName"])', changes: { recruiterName: "Read-only injection" } },
    { url: "/roles/new", button: "Create role", selector: 'form:has(input[name="title"])', changes: { title: "Read-only injection" } },
  ];
  for (const entry of cases) {
    await admin.page.goto(entry.url);
    await expect(admin.page.getByRole("button", { name: entry.button, exact: true })).toBeDisabled();
    const form = await snapshotForm(admin.page, entry.url, entry.selector);
    const response = await postForm(admin.page, form, entry.changes);
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(await response.text()).toContain("read-only");
  }
  await admin.page.goto("/settings");
  await expect(admin.page.getByText("Capture keys are private.", { exact: false })).toBeVisible();
  await expect(admin.page.getByRole("button", { name: /Generate a (capture|new) key/ })).toHaveCount(0);
  expect(await admin.page.content()).not.toContain(recruiterKey);
  expect(await admin.page.content()).not.toContain(hashToken(recruiterKey));
  const regenerate = await admin.page.request.post("/settings", {
    headers: { Origin: BASE, "Next-Action": keyRequest.headers()["next-action"], "Content-Type": keyRequest.headers()["content-type"] },
    data: keyRequest.postDataBuffer()!,
  });
  expect(regenerate.status()).toBeGreaterThanOrEqual(400);
  expect(await regenerate.text()).toContain("read-only");
  const ownCapture = await admin.page.request.get("/api/capture", { headers: { "X-Capture-Token": adminKey } });
  expect((await ownCapture.json()).account.id).toBe(admin.id);
  expect(await db.role.findUnique({ where: { id: target.role.id } })).toEqual(target.role);
  expect(await db.savedSearch.findUnique({ where: { id: target.search.id } })).toEqual(target.search);
  expect(await db.candidate.findUnique({ where: { id: target.candidate.id } })).toEqual(target.candidate);
  expect(await db.outreachLog.count({ where: { candidateId: target.candidate.id } })).toBe(0);
  expect(await db.role.count({ where: { userId: { in: [admin.id, recruiter.id] } } })).toBe(2);
  expect(await db.messageTemplate.count({ where: { userId: { in: [admin.id, recruiter.id] } } })).toBe(2);
  expect(await db.settings.findUnique({ where: { userId: admin.id } })).toEqual(ownSettings);
  expect(await db.settings.findUnique({ where: { userId: recruiter.id } })).toEqual(targetSettings);
  await admin.page.getByRole("button", { name: "Return to my workspace" }).click();
  await expect(admin.page).toHaveURL(`${BASE}/`);
  await expect(admin.page.locator("main")).toContainText(own.role.title);
  await expect(admin.page.locator("main")).not.toContainText(target.role.title);
  expect((await db.session.findUniqueOrThrow({ where: { tokenHash: hashToken(admin.token) } })).viewUserId).toBeNull();
  await expectAudit(admin.id, recruiter.id, "workspace_view_ended");
});

test("A10 disabling an account revokes every session, activation link and capture key", async ({ accounts }) => {
  const admin = await accounts.create("admin");
  const actor = await accounts.create();
  const data = await workspace(actor);
  const key = await captureKey(actor);
  const second = await accounts.guest();
  await login(second, actor.email);
  await expect(second).toHaveURL(`${BASE}/`);
  expect(await db.session.count({ where: { userId: actor.id } })).toBe(2);
  await db.activationToken.create({ data: { userId: actor.id, tokenHash: hashToken(secret()), expiresAt: new Date(Date.now() + 60_000) } });
  await admin.page.goto("/admin");
  const card = admin.page.locator("article", { hasText: actor.email });
  await card.getByRole("button", { name: "Disable account" }).click();
  await expect(card.locator('[data-form-message="notice"]')).toContainText("Account disabled");
  expect(await db.user.findUnique({ where: { id: actor.id } })).toMatchObject({ active: false, authVersion: 1 });
  expect(await db.session.count({ where: { userId: actor.id } })).toBe(0);
  expect(await db.activationToken.count({ where: { userId: actor.id } })).toBe(0);
  expect((await db.settings.findUniqueOrThrow({ where: { userId: actor.id } })).captureTokenHash).toBeNull();
  for (const page of [actor.page, second]) {
    await page.goto("/settings");
    await expect(page).toHaveURL(`${BASE}/login`);
  }
  await expectCaptureDenied(second, key, data.role.id);
  await login(second, actor.email);
  await expect(second.locator("main").getByRole("alert")).toContainText("account is unavailable");
  await expectAudit(admin.id, actor.id, "account_disabled");
  await card.getByRole("button", { name: "Enable account" }).click();
  await expect(card.locator('[data-form-message="notice"]')).toContainText("Account enabled");
  await actor.page.goto("/");
  await expect(actor.page).toHaveURL(`${BASE}/login`);
  await expectCaptureDenied(second, key, data.role.id);
  await expectAudit(admin.id, actor.id, "account_enabled");
});

test("A11 password change verifies the current password and revokes all sessions and capture", async ({ accounts }) => {
  const actor = await accounts.create();
  const data = await workspace(actor);
  const key = await captureKey(actor);
  const second = await accounts.guest();
  await login(second, actor.email);
  await expect(second).toHaveURL(`${BASE}/`);
  await db.activationToken.create({ data: { userId: actor.id, tokenHash: hashToken(secret()), expiresAt: new Date(Date.now() + 60_000) } });
  await actor.page.goto("/account");
  await actor.page.getByLabel("Current password", { exact: true }).fill("wrong-current-password");
  await actor.page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await actor.page.getByLabel("Confirm new password", { exact: true }).fill(NEW_PASSWORD);
  await actor.page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(actor.page.locator("main").getByRole("alert")).toHaveText("The current password is incorrect.");
  expect(await db.session.count({ where: { userId: actor.id } })).toBe(2);
  expect((await second.request.get("/api/capture", { headers: { "X-Capture-Token": key } })).status()).toBe(200);
  await actor.page.getByLabel("Current password", { exact: true }).fill(PASSWORD);
  await actor.page.getByLabel("Confirm new password", { exact: true }).fill("TEST-ONLY-mismatching-password");
  await actor.page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(actor.page.locator("main").getByRole("alert")).toHaveText("The two passwords do not match.");
  await actor.page.getByLabel("Confirm new password", { exact: true }).fill(NEW_PASSWORD);
  await actor.page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(actor.page).toHaveURL(`${BASE}/login?changed=1`);
  expect(await db.session.count({ where: { userId: actor.id } })).toBe(0);
  expect(await db.activationToken.count({ where: { userId: actor.id } })).toBe(0);
  await second.goto("/settings");
  await expect(second).toHaveURL(`${BASE}/login`);
  await expectCaptureDenied(second, key, data.role.id);
  await login(second, actor.email, PASSWORD);
  await expect(second.locator("main").getByRole("alert")).toContainText("password is incorrect");
  await login(second, actor.email, NEW_PASSWORD);
  await expect(second).toHaveURL(`${BASE}/`);
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  expect(user.authVersion).toBe(1);
  expect(await verifyPassword(NEW_PASSWORD, user.passwordHash)).toBe(true);
  await expectAudit(actor.id, actor.id, "password_changed");
});

test("A12 origin checks reject missing and foreign origins without changing settings", async ({ accounts }) => {
  const actor = await accounts.create();
  const form = await snapshotForm(actor.page, "/settings", 'form:has(input[name="recruiterName"])');
  expect((await postForm(actor.page, form, { recruiterName: "Same origin control" })).ok()).toBe(true);
  const before = await db.settings.findUniqueOrThrow({ where: { userId: actor.id } });
  expect(before.recruiterName).toBe("Same origin control");
  for (const origin of [null, "http://localhost:3999", "https://attacker.example.invalid"]) {
    const response = await postForm(actor.page, form, { recruiterName: "Origin injection" }, origin);
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(await db.settings.findUnique({ where: { userId: actor.id } })).toEqual(before);
  }
});

test("A13 recruiter cannot invoke administrative actions copied from an administrator page", async ({ accounts }) => {
  const admin = await accounts.create("admin");
  const actor = await accounts.create();
  const target = await accounts.create();
  const create = await snapshotForm(admin.page, "/admin", 'form:has(input[id="new-email"])');
  const view = await snapshotForm(admin.page, "/admin", `form:has(input[value="${target.id}"]):not(:has(input[name="active"]))`);
  const disable = await snapshotForm(admin.page, "/admin", `form:has(input[value="${target.id}"]):has(input[name="active"])`);
  const before = await db.user.count();
  for (const [form, changes] of [[create, { name: "Escalation", email: `forged-${randomUUID()}@test.capture.invalid` }], [view, { userId: target.id }], [disable, { userId: target.id, active: "false" }]] as [FormSnapshot, Record<string, string>][]) {
    const response = await postForm(actor.page, form, changes);
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(await response.text()).toContain("Administrator access is required");
  }
  expect(await db.user.count()).toBe(before);
  expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).active).toBe(true);
  expect((await db.session.findUniqueOrThrow({ where: { tokenHash: hashToken(actor.token) } })).viewUserId).toBeNull();
  expect(await db.auditEvent.count({ where: { actorId: actor.id } })).toBe(0);
  await actor.page.goto("/admin");
  await expect(actor.page.getByRole("heading", { name: "Account administration" })).toHaveCount(0);
  expect(await actor.page.content()).not.toContain(target.email);
});

test("A14 expired and auth-version-stale session cookies cannot restore a workspace", async ({ accounts }) => {
  for (const failure of ["expired", "version"] as const) {
    const actor = await accounts.create();
    await actor.page.goto("/settings");
    await expect(actor.page.getByRole("button", { name: "Save settings" })).toBeEnabled();
    if (failure === "expired") await db.session.update({ where: { tokenHash: hashToken(actor.token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    else await db.user.update({ where: { id: actor.id }, data: { authVersion: { increment: 1 } } });
    await actor.page.goto("/settings");
    await expect(actor.page).toHaveURL(`${BASE}/login`);
  }
});
