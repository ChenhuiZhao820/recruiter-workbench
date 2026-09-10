import { test as base, expect, type APIResponse, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { db } from "./helpers";
import { hashPassword, hashToken } from "../lib/auth-crypto";

const BASE = "http://localhost:3100";
const PASSWORD = "TEST-ONLY-extension-password-3100!";
const EMPTY_STATE = { cookies: [], origins: [] };
const WEEK = 7 * 24 * 60 * 60 * 1000;
const DOWNLOAD = "/api/extension/download";
const ACTIVATION_FORM = '[aria-label="Browser extension"] form';
const secret = () => randomBytes(32).toString("base64url");
type Actor = { id: string; name: string; email: string; token: string; page: Page };
type Extensions = {
  create: (options?: { role?: "admin" | "recruiter"; activated?: boolean }) => Promise<Actor>;
  guest: () => Promise<Page>;
  secrets: string[];
};
type FormSnapshot = { url: string; fields: Record<string, string> };
let passwordHash: string;

const test = base.extend<{ extensions: Extensions }>({
  extensions: async ({ browser }, use) => {
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
        create: async ({ role = "recruiter", activated = false } = {}) => {
          const suffix = randomUUID();
          const user = await db.user.create({ data: {
            email: `extension-${role}-${suffix}@test.capture.invalid`, name: `Extension ${role} ${suffix}`, role, passwordHash,
            settings: { create: {} },
            ...(activated ? { extensionAccess: { create: { activatedAt: new Date() } } } : {}),
          } });
          const token = secret();
          secrets.push(token);
          await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
          const page = await guest();
          await page.context().addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
          return { id: user.id, name: user.name, email: user.email, token, page };
        },
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
      expect(externalRequests, "Extension access pages must not request external resources").toEqual([]);
      for (const value of secrets) expect(requestUrls.some((url) => url.includes(value)), "Secrets must never be sent in request URLs").toBe(false);
    }
  },
});

test.use({ storageState: EMPTY_STATE });
test.setTimeout(120_000);
test.beforeAll(async () => { passwordHash = await hashPassword(PASSWORD); });
test.afterAll(async () => { await db.$disconnect(); });

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

function issueSelector(actor: Actor) {
  return `article:has(input[value="${actor.id}"]) [aria-label="Extension access"] form`;
}

async function issueCode(admin: Actor, actor: Actor, extensions: Extensions, replace = false) {
  await admin.page.goto("/admin");
  const section = admin.page.locator("article", { hasText: actor.email }).getByRole("region", { name: "Extension access", exact: true });
  await section.getByRole("button", { name: replace ? "Replace extension code" : "Generate extension code", exact: true }).click();
  const output = section.getByLabel("New extension activation code", { exact: true });
  await expect(output).toBeVisible();
  await expect(output).toHaveAttribute("readonly", "");
  const code = await output.inputValue();
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  extensions.secrets.push(code);
  expect(admin.page.url()).toBe(`${BASE}/admin`);
  return code;
}

async function activate(actor: Actor, code: string, accepted = true) {
  await actor.page.goto("/account");
  const section = actor.page.getByRole("region", { name: "Browser extension", exact: true });
  await section.getByLabel("Extension activation code", { exact: true }).fill(code);
  await section.getByRole("button", { name: "Activate extension", exact: true }).click();
  if (accepted) await expect(section.getByRole("link", { name: "Download extension ZIP", exact: true })).toBeVisible();
  else {
    await expect(section.getByRole("alert")).toBeVisible();
    await expect(section.getByRole("link", { name: "Download extension ZIP", exact: true })).toHaveCount(0);
    expect((await db.extensionAccess.findUnique({ where: { userId: actor.id } }))?.activatedAt ?? null).toBeNull();
    expect((await actor.page.request.get(DOWNLOAD)).status()).toBe(403);
  }
  await expect(actor.page).toHaveURL(`${BASE}/account`);
}

async function activationSnapshot(actor: Actor) {
  await actor.page.goto("/account");
  const name = await actor.page.getByRole("region", { name: "Browser extension", exact: true }).getByLabel("Extension activation code", { exact: true }).getAttribute("name");
  expect(name).toBeTruthy();
  return { form: await snapshotForm(actor.page, "/account", ACTIVATION_FORM), field: name! };
}

async function generateKey(actor: Actor, extensions: Extensions) {
  await actor.page.goto("/settings");
  await actor.page.getByRole("button", { name: /Generate a (capture|new) key/ }).click();
  const output = actor.page.getByLabel("New capture key", { exact: true });
  await expect(output).toBeVisible();
  const key = await output.inputValue();
  expect(key).toMatch(/^[A-Za-z0-9_-]{24,128}$/);
  extensions.secrets.push(key);
  expect((await db.settings.findUniqueOrThrow({ where: { userId: actor.id } })).captureTokenHash).toBe(hashToken(key));
  return key;
}

async function expectCaptureDenied(page: Page, roleId: string, token?: string) {
  const headers: Record<string, string> = token ? { "X-Capture-Token": token } : {};
  expect((await page.request.get("/api/capture", { headers })).status()).toBe(401);
  expect((await page.request.post("/api/capture", { headers, data: { roleId, fullName: "Must not be captured" } })).status()).toBe(401);
  expect(await db.candidate.count({ where: { roleId } })).toBe(0);
}

async function expectPrivateDownload(response: APIResponse, status: number) {
  expect(response.status()).toBe(status);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["cache-control"]).toContain("private");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  if (status !== 200) expect(response.headers()["content-type"]).not.toContain("application/zip");
}

function zipContents(body: Buffer) {
  expect(body.subarray(0, 4).toString("hex")).toBe("504b0304");
  const end = body.lastIndexOf(Buffer.from("504b0506", "hex"));
  expect(end).toBeGreaterThan(0);
  const count = body.readUInt16LE(end + 10);
  let offset = body.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let entry = 0; entry < count; entry++) {
    expect(body.readUInt32LE(offset)).toBe(0x02014b50);
    const method = body.readUInt16LE(offset + 10);
    const size = body.readUInt32LE(offset + 20);
    const nameLength = body.readUInt16LE(offset + 28);
    const extraLength = body.readUInt16LE(offset + 30);
    const commentLength = body.readUInt16LE(offset + 32);
    const local = body.readUInt32LE(offset + 42);
    const name = body.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    expect(body.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + body.readUInt16LE(local + 26) + body.readUInt16LE(local + 28);
    const compressed = body.subarray(start, start + size);
    expect([0, 8]).toContain(method);
    files.set(name, (method === 8 ? inflateRawSync(compressed) : compressed).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  expect(files.size).toBeGreaterThan(1);
  return files;
}

async function expectZip(page: Page, privateValues: string[]) {
  const response = await page.request.get(DOWNLOAD);
  await expectPrivateDownload(response, 200);
  expect(response.headers()["content-type"]).toMatch(/^application\/zip(?:;|$)/);
  expect(response.headers()["content-disposition"]).toMatch(/^attachment;/);
  const files = zipContents(await response.body());
  const manifestName = Array.from(files.keys()).find((name) => /(^|\/)manifest\.json$/.test(name));
  expect(manifestName).toBeTruthy();
  const manifest = JSON.parse(files.get(manifestName!)!);
  expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage"]);
  expect(manifest.host_permissions).toEqual(["http://localhost/*", "http://127.0.0.1/*"]);
  expect(manifest.optional_permissions).toBeUndefined();
  expect(manifest.optional_host_permissions).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.background).toBeUndefined();
  const contents = Array.from(files.values()).join("\n");
  expect(contents).toContain(BASE);
  for (const value of privateValues) expect(contents).not.toContain(value);
  return contents;
}

async function expectAuditPrivate(actors: Actor[], values: string[]) {
  const events = await db.auditEvent.findMany({ where: { OR: [{ actorId: { in: actors.map((actor) => actor.id) } }, { targetUserId: { in: actors.map((actor) => actor.id) } }] } });
  const audit = JSON.stringify(events);
  for (const value of [...values, PASSWORD, passwordHash, ...actors.map((actor) => actor.token)]) expect(audit).not.toContain(value);
}

test("E1 new recruiters are locked, including pre-existing capture keys and forged key generation", async ({ extensions }) => {
  const actor = await extensions.create();
  const admin = await extensions.create({ role: "admin" });
  const guest = await extensions.guest();
  const role = await db.role.create({ data: { userId: actor.id, title: "Locked private role" } });
  expect(await db.extensionAccess.findUnique({ where: { userId: actor.id } })).toBeNull();
  await expectPrivateDownload(await guest.request.get(DOWNLOAD), 401);
  await expectPrivateDownload(await actor.page.request.get(DOWNLOAD), 403);
  await expectCaptureDenied(guest, role.id);
  await expectCaptureDenied(actor.page, role.id, actor.token);
  await actor.page.goto("/account");
  const section = actor.page.getByRole("region", { name: "Browser extension", exact: true });
  await expect(section.getByLabel("Extension activation code", { exact: true })).toBeVisible();
  await expect(section.getByRole("link", { name: "Download extension ZIP", exact: true })).toHaveCount(0);
  await actor.page.goto("/settings");
  await expect(actor.page.getByRole("link", { name: "Activate extension in your account", exact: true })).toHaveAttribute("href", "/account");
  await expect(actor.page.getByRole("button", { name: /Generate a (capture|new) key/ })).toHaveCount(0);
  const existingKey = secret();
  extensions.secrets.push(existingKey);
  await db.settings.update({ where: { userId: actor.id }, data: { captureTokenHash: hashToken(existingKey) } });
  await expectCaptureDenied(guest, role.id, existingKey);
  await expectCaptureDenied(actor.page, role.id, existingKey);
  const pendingCode = secret();
  extensions.secrets.push(pendingCode);
  await db.extensionAccess.create({ data: { userId: actor.id, codeHash: hashToken(pendingCode), expiresAt: new Date(Date.now() + WEEK) } });
  await expectCaptureDenied(guest, role.id, existingKey);
  await expectPrivateDownload(await actor.page.request.get(DOWNLOAD), 403);
  const requestPromise = admin.page.waitForRequest((request) => request.method() === "POST" && Boolean(request.headers()["next-action"]));
  await generateKey(admin, extensions);
  const request = await requestPromise;
  const before = await db.settings.findUniqueOrThrow({ where: { userId: actor.id } });
  const forged = await actor.page.request.post("/settings", {
    headers: { Origin: BASE, "Next-Action": request.headers()["next-action"], "Content-Type": request.headers()["content-type"] },
    data: request.postDataBuffer()!,
  });
  expect(forged.status()).toBe(200);
  expect(await forged.text()).toContain("Extension activation is required");
  expect(await db.settings.findUnique({ where: { userId: actor.id } })).toEqual(before);
  await expectPrivateDownload(await actor.page.request.get(`${DOWNLOAD}?userId=${admin.id}`), 403);
});

test("E2 admin codes are unique, hashed, account-bound, seven-day and replaceable", async ({ extensions }) => {
  const admin = await extensions.create({ role: "admin" });
  const alice = await extensions.create();
  const bob = await extensions.create();
  const started = Date.now();
  const first = await issueCode(admin, alice, extensions);
  const pending = await db.extensionAccess.findUniqueOrThrow({ where: { userId: alice.id } });
  expect(pending).toMatchObject({ userId: alice.id, codeHash: hashToken(first), activatedAt: null });
  expect(pending.codeHash).not.toBe(first);
  expect(pending.expiresAt!.getTime()).toBeGreaterThanOrEqual(started + WEEK);
  expect(pending.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + WEEK);
  expect(await db.auditEvent.count({ where: { actorId: admin.id, targetUserId: alice.id } })).toBe(1);
  expect((await db.settings.findUniqueOrThrow({ where: { userId: alice.id } })).captureTokenHash).toBeNull();
  await admin.page.reload();
  await expect(admin.page.getByLabel("New extension activation code", { exact: true })).toHaveCount(0);
  expect(await admin.page.content()).not.toContain(first);
  expect(await admin.page.content()).not.toContain(hashToken(first));
  const bobCode = await issueCode(admin, bob, extensions);
  expect(bobCode).not.toBe(first);
  await activate(bob, first, false);
  const malformed = await activationSnapshot(alice);
  const invalid = await postForm(alice.page, malformed.form, { [malformed.field]: "not-an-extension-code" });
  expect(await invalid.text()).toContain("invalid, expired");
  expect(await db.extensionAccess.findUnique({ where: { userId: alice.id } })).toEqual(pending);
  await activate(alice, secret(), false);
  const second = await issueCode(admin, alice, extensions, true);
  expect(second).not.toBe(first);
  expect(await db.extensionAccess.findUnique({ where: { codeHash: hashToken(first) } })).toBeNull();
  await activate(alice, first, false);
  await db.extensionAccess.update({ where: { userId: alice.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const expired = await db.extensionAccess.findUniqueOrThrow({ where: { userId: alice.id } });
  await activate(alice, second, false);
  expect(await db.extensionAccess.findUnique({ where: { userId: alice.id } })).toEqual(expired);
  const third = await issueCode(admin, alice, extensions, true);
  expect(new Set([first, second, third, bobCode]).size).toBe(4);
  await activate(alice, third);
  expect((await db.extensionAccess.findUniqueOrThrow({ where: { userId: alice.id } })).activatedAt).not.toBeNull();
  expect((await db.extensionAccess.findUniqueOrThrow({ where: { userId: bob.id } })).activatedAt).toBeNull();
  await expectAuditPrivate([admin, alice, bob], [first, second, third, bobCode, hashToken(first), hashToken(third)]);
});

test("E3 activation persists across reload and sign-in, downloads remain reusable and keys are separate", async ({ extensions }) => {
  const admin = await extensions.create({ role: "admin" });
  const actor = await extensions.create();
  const foreign = await extensions.create({ activated: true });
  const role = await db.role.create({ data: { userId: actor.id, title: "Authorized private role" } });
  const otherRole = await db.role.create({ data: { userId: foreign.id, title: "Foreign private role" } });
  const code = await issueCode(admin, actor, extensions);
  const { form, field } = await activationSnapshot(actor);
  await activate(actor, code);
  const access = await db.extensionAccess.findUniqueOrThrow({ where: { userId: actor.id } });
  expect(access).toMatchObject({ codeHash: null, expiresAt: null });
  expect(access.activatedAt).not.toBeNull();
  expect((await db.settings.findUniqueOrThrow({ where: { userId: actor.id } })).captureTokenHash).toBeNull();
  await expectCaptureDenied(actor.page, role.id);
  const section = actor.page.getByRole("region", { name: "Browser extension", exact: true });
  const link = section.getByRole("link", { name: "Download extension ZIP", exact: true });
  await expect(link).toHaveAttribute("href", DOWNLOAD);
  expect(await link.evaluate((element) => element.tagName)).toBe("A");
  const [download] = await Promise.all([actor.page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  expect(await download.failure()).toBeNull();
  const privateValues = [code, hashToken(code), actor.token, actor.email, PASSWORD, passwordHash];
  await expectZip(actor.page, privateValues);
  await actor.page.reload();
  await expect(link).toBeVisible();
  await expect(section.getByLabel("Extension activation code", { exact: true })).toHaveCount(0);
  expect(await actor.page.content()).not.toContain(code);
  await expectZip(actor.page, privateValues);
  await postForm(actor.page, form, { [field]: code });
  expect(await db.extensionAccess.findUnique({ where: { userId: actor.id } })).toEqual(access);
  expect(await db.auditEvent.count({ where: { actorId: actor.id, targetUserId: actor.id } })).toBe(1);
  await actor.page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(actor.page).toHaveURL(`${BASE}/login`);
  await expectPrivateDownload(await actor.page.request.get(DOWNLOAD), 401);
  await actor.page.getByLabel("Email", { exact: true }).fill(actor.email);
  await actor.page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await actor.page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(actor.page).toHaveURL(`${BASE}/`);
  await actor.page.goto("/account");
  await expect(link).toBeVisible();
  expect(await db.extensionAccess.findUnique({ where: { userId: actor.id } })).toEqual(access);
  await expectZip(actor.page, privateValues);
  const key = await generateKey(actor, extensions);
  expect(key).not.toBe(code);
  const guest = await extensions.guest();
  const headers = { "X-Capture-Token": key };
  const listed = await guest.request.get("/api/capture", { headers });
  expect(listed.status()).toBe(200);
  expect(await listed.json()).toEqual({ account: { id: actor.id, name: actor.name, email: actor.email }, roles: [{ id: role.id, title: role.title, client: null }] });
  expect((await guest.request.post("/api/capture", { headers, data: { roleId: otherRole.id, fullName: "Foreign injection", userId: foreign.id } })).status()).toBe(404);
  expect((await guest.request.post("/api/capture", { headers, data: { roleId: role.id, fullName: "Authorized capture", userId: foreign.id } })).status()).toBe(201);
  expect(await db.candidate.count({ where: { roleId: role.id, fullName: "Authorized capture" } })).toBe(1);
  expect(await db.candidate.count({ where: { roleId: otherRole.id } })).toBe(0);
  const ownContents = await expectZip(actor.page, [...privateValues, key, hashToken(key)]);
  const foreignContents = await expectZip(foreign.page, [...privateValues, key, hashToken(key), foreign.token, foreign.email]);
  expect(foreignContents).toBe(ownContents);
  await expectAuditPrivate([admin, actor, foreign], [code, hashToken(code), key, hashToken(key)]);
});

test("E4 crafted concurrent redemption consumes once and cannot override the authenticated owner", async ({ extensions }) => {
  const admin = await extensions.create({ role: "admin" });
  const alice = await extensions.create();
  const bob = await extensions.create();
  const code = await issueCode(admin, alice, extensions);
  const bobSnapshot = await activationSnapshot(bob);
  const before = await db.extensionAccess.findUniqueOrThrow({ where: { userId: alice.id } });
  const forged = await postForm(bob.page, bobSnapshot.form, { [bobSnapshot.field]: code, userId: alice.id });
  expect(forged.status()).toBeLessThan(500);
  expect(await db.extensionAccess.findUnique({ where: { userId: alice.id } })).toEqual(before);
  expect(await db.extensionAccess.findUnique({ where: { userId: bob.id } })).toBeNull();
  expect(await db.auditEvent.count({ where: { actorId: bob.id } })).toBe(0);
  const { form, field } = await activationSnapshot(alice);
  const responses = await Promise.all([
    postForm(alice.page, form, { [field]: code, userId: bob.id }),
    postForm(alice.page, form, { [field]: code, userId: bob.id }),
  ]);
  for (const response of responses) expect(response.status()).toBeLessThan(500);
  const activated = await db.extensionAccess.findUniqueOrThrow({ where: { userId: alice.id } });
  expect(activated).toMatchObject({ codeHash: null, expiresAt: null });
  expect(activated.activatedAt).not.toBeNull();
  expect(await db.extensionAccess.findUnique({ where: { userId: bob.id } })).toBeNull();
  expect(await db.auditEvent.count({ where: { actorId: alice.id, targetUserId: alice.id } })).toBe(1);
  await postForm(alice.page, form, { [field]: code });
  expect(await db.extensionAccess.findUnique({ where: { userId: alice.id } })).toEqual(activated);
  expect(await db.auditEvent.count({ where: { actorId: alice.id, targetUserId: alice.id } })).toBe(1);
  expect((await db.settings.findUniqueOrThrow({ where: { userId: alice.id } })).captureTokenHash).toBeNull();
  await expectPrivateDownload(await alice.page.request.get(DOWNLOAD), 200);
  await expectPrivateDownload(await bob.page.request.get(`${DOWNLOAD}?userId=${alice.id}`), 403);
});

test("E5 recruiters and read-only administrators cannot issue or redeem through copied forms", async ({ extensions }) => {
  const admin = await extensions.create({ role: "admin" });
  const actor = await extensions.create();
  const target = await extensions.create();
  const code = await issueCode(admin, actor, extensions);
  const issue = await snapshotForm(admin.page, "/admin", issueSelector(target));
  const redeem = await activationSnapshot(actor);
  const denied = await postForm(actor.page, { ...issue, url: "/account" }, { userId: target.id });
  expect(denied.status()).toBe(200);
  expect(await denied.text()).toContain("Administrator access is required");
  expect(await db.extensionAccess.findUnique({ where: { userId: target.id } })).toBeNull();
  expect(await db.auditEvent.count({ where: { actorId: actor.id } })).toBe(0);
  await admin.page.goto("/admin");
  await admin.page.locator("article", { hasText: actor.email }).getByRole("button", { name: "View workspace (read-only)", exact: true }).click();
  await expect(admin.page).toHaveURL(`${BASE}/`);
  expect((await db.session.findUniqueOrThrow({ where: { tokenHash: hashToken(admin.token) } })).viewUserId).toBe(actor.id);
  await admin.page.goto("/account");
  const section = admin.page.getByRole("region", { name: "Browser extension", exact: true });
  await expect(section).toContainText(/return.*workspace/i);
  await expect(section.locator("form")).toHaveCount(0);
  await expect(section.getByLabel("Extension activation code", { exact: true })).toHaveCount(0);
  await expect(section.getByRole("link", { name: "Download extension ZIP", exact: true })).toHaveCount(0);
  await expectPrivateDownload(await admin.page.request.get(DOWNLOAD), 403);
  const before = await db.extensionAccess.findMany({ where: { userId: { in: [admin.id, actor.id, target.id] } }, orderBy: { userId: "asc" } });
  const auditCount = await db.auditEvent.count({ where: { actorId: admin.id } });
  for (const [form, changes] of [[issue, { userId: target.id }], [redeem.form, { [redeem.field]: code, userId: actor.id }]] as [FormSnapshot, Record<string, string>][]) {
    const response = await postForm(admin.page, form, changes);
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(await response.text()).toContain("read-only");
  }
  expect(await db.extensionAccess.findMany({ where: { userId: { in: [admin.id, actor.id, target.id] } }, orderBy: { userId: "asc" } })).toEqual(before);
  expect(await db.auditEvent.count({ where: { actorId: admin.id } })).toBe(auditCount);
  await admin.page.getByRole("button", { name: "Return to my workspace", exact: true }).click();
  await expect(admin.page).toHaveURL(`${BASE}/`);
  await expectPrivateDownload(await admin.page.request.get(DOWNLOAD), 200);
  await activate(actor, code);
  await admin.page.goto("/admin");
  await admin.page.locator("article", { hasText: actor.email }).getByRole("button", { name: "View workspace (read-only)", exact: true }).click();
  await expect(admin.page).toHaveURL(`${BASE}/`);
  await admin.page.goto("/account");
  await expect(section.getByRole("link", { name: "Download extension ZIP", exact: true })).toHaveCount(0);
  await expect(section.locator("form")).toHaveCount(0);
  await expectPrivateDownload(await admin.page.request.get(DOWNLOAD), 403);
});

test("E6 admin own-workspace bypass needs no activation and newly created accounts receive no grant", async ({ extensions }) => {
  const admin = await extensions.create({ role: "admin" });
  expect(await db.extensionAccess.findUnique({ where: { userId: admin.id } })).toBeNull();
  await admin.page.goto("/account");
  const section = admin.page.getByRole("region", { name: "Browser extension", exact: true });
  await expect(section.getByRole("link", { name: "Download extension ZIP", exact: true })).toHaveAttribute("href", DOWNLOAD);
  await expect(section.getByLabel("Extension activation code", { exact: true })).toHaveCount(0);
  await expectZip(admin.page, [admin.token, admin.email, PASSWORD, passwordHash]);
  const key = await generateKey(admin, extensions);
  const role = await db.role.create({ data: { userId: admin.id, title: "Admin own capture role" } });
  const guest = await extensions.guest();
  const headers = { "X-Capture-Token": key };
  const listed = await guest.request.get("/api/capture", { headers });
  expect(listed.status()).toBe(200);
  expect((await listed.json()).account.id).toBe(admin.id);
  expect((await guest.request.post("/api/capture", { headers, data: { roleId: role.id, fullName: "Admin own capture" } })).status()).toBe(201);
  expect(await db.extensionAccess.findUnique({ where: { userId: admin.id } })).toBeNull();
  await admin.page.goto("/admin");
  const create = admin.page.getByRole("region", { name: "Create account", exact: true });
  const email = `extension-created-${randomUUID()}@test.capture.invalid`;
  await create.getByLabel("Name", { exact: true }).fill("Extension locked new account");
  await create.getByLabel("Email", { exact: true }).fill(email);
  await create.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(create.getByLabel("One-time setup link", { exact: true })).toBeVisible();
  const user = await db.user.findUniqueOrThrow({ where: { email }, include: { extensionAccess: true, settings: true } });
  expect(user.extensionAccess).toBeNull();
  expect(user.settings?.captureTokenHash ?? null).toBeNull();
  await expect(admin.page.locator("article", { hasText: email }).getByRole("region", { name: "Extension access", exact: true }).getByRole("button", { name: "Generate extension code", exact: true })).toBeVisible();
});

test("E7 missing and foreign origins cannot issue or redeem extension grants", async ({ extensions }) => {
  const admin = await extensions.create({ role: "admin" });
  const actor = await extensions.create();
  const target = await extensions.create();
  const code = await issueCode(admin, actor, extensions);
  const issue = await snapshotForm(admin.page, "/admin", issueSelector(target));
  const { form, field } = await activationSnapshot(actor);
  const before = await db.extensionAccess.findUniqueOrThrow({ where: { userId: actor.id } });
  for (const origin of [null, "http://localhost:3999", "https://attacker.example.invalid"]) {
    expect((await postForm(admin.page, issue, { userId: target.id }, origin)).status()).toBeGreaterThanOrEqual(400);
    expect((await postForm(actor.page, form, { [field]: code }, origin)).status()).toBeGreaterThanOrEqual(400);
    expect(await db.extensionAccess.findUnique({ where: { userId: target.id } })).toBeNull();
    expect(await db.extensionAccess.findUnique({ where: { userId: actor.id } })).toEqual(before);
  }
  expect(await db.auditEvent.count({ where: { actorId: actor.id } })).toBe(0);
  await activate(actor, code);
});
