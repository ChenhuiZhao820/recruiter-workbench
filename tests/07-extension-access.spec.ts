import { test as base, expect, type APIResponse, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { db } from "./helpers";
import { CURRENT_RELEASE } from "../lib/release";
import { hashPassword, hashToken } from "../lib/auth-crypto";

const BASE = "http://localhost:3100";
const PASSWORD = "TEST-ONLY-extension-password-3100!";
const EMPTY_STATE = { cookies: [], origins: [] };
const WEEK = 7 * 24 * 60 * 60 * 1000;
const DOWNLOAD = "/api/extension/download";
const secret = () => randomBytes(32).toString("base64url");
type Actor = { id: string; name: string; email: string; token: string; page: Page };
type Extensions = {
  create: (options?: { role?: "admin" | "recruiter"; plan?: Plan }) => Promise<Actor>;
  guest: () => Promise<Page>;
  secrets: string[];
};
// The extension comes with a plan. "granted" is an account an administrator
// made (Basic), "trial" a self-serve one in its first week, "ended" a
// self-serve one whose trial is over with nothing paid.
type Plan = "granted" | "trial" | "ended";
const PLAN_FIELDS: Record<Plan, object> = {
  granted: { accountTier: "basic" },
  trial: { accountTier: "trial", signupSource: "self", trialExpiresAt: new Date(Date.now() + WEEK) },
  ended: { accountTier: "trial", signupSource: "self", trialExpiresAt: new Date(Date.now() - 60_000) },
};
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
        create: async ({ role = "recruiter", plan = "granted" } = {}) => {
          const suffix = randomUUID();
          const user = await db.user.create({ data: {
            email: `extension-${role}-${suffix}@test.capture.invalid`, name: `Extension ${role} ${suffix}`, role, passwordHash,
            // These tests are not about the release notice; an unread one
            // would send a sign-in somewhere else. `tests/11-whats-new.spec.ts`
            // covers that on its own accounts.
            settings: { create: { seenRelease: CURRENT_RELEASE } },
            ...PLAN_FIELDS[plan],
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

async function generateKey(actor: Actor, extensions: Extensions) {
  await actor.page.goto("/settings");
  await actor.page.getByRole("button", { name: /Generate (an extension|a new) key/ }).click();
  const output = actor.page.getByLabel("New extension key", { exact: true });
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
  expect(manifest.permissions).toEqual(["activeTab", "scripting", "sidePanel", "storage"]);
  expect(manifest.side_panel).toEqual({ default_path: "popup.html" });
  expect(manifest.host_permissions).toEqual(["http://localhost/*", "http://127.0.0.1/*"]);
  expect(manifest.optional_permissions).toBeUndefined();
  // LinkedIn ships as an optional origin and nothing more: the download grants
  // no page access, the recruiter grants it in the panel or not at all.
  expect(manifest.optional_host_permissions).toEqual(["https://*.linkedin.com/*"]);
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

test("E1 an account whose trial ended is locked, including an existing extension key and forged key generation", async ({ extensions }) => {
  const actor = await extensions.create({ plan: "ended" });
  const admin = await extensions.create({ role: "admin" });
  const guest = await extensions.guest();
  const role = await db.role.create({ data: { userId: actor.id, title: "Locked private role" } });
  await expectPrivateDownload(await guest.request.get(DOWNLOAD), 401);
  await expectPrivateDownload(await actor.page.request.get(DOWNLOAD), 403);
  await expectCaptureDenied(guest, role.id);
  await expectCaptureDenied(actor.page, role.id, actor.token);
  await actor.page.goto("/account");
  const section = actor.page.getByRole("region", { name: "Browser extension", exact: true });
  await expect(section.getByRole("link", { name: "Choose a plan", exact: true })).toHaveAttribute("href", "/billing");
  await expect(section.getByRole("link", { name: "Download extension ZIP", exact: true })).toHaveCount(0);
  await actor.page.goto("/settings");
  await expect(actor.page.getByRole("button", { name: /Generate (an extension|a new) key/ })).toHaveCount(0);
  const existingKey = secret();
  extensions.secrets.push(existingKey);
  await db.settings.update({ where: { userId: actor.id }, data: { captureTokenHash: hashToken(existingKey) } });
  await expectCaptureDenied(guest, role.id, existingKey);
  await expectCaptureDenied(actor.page, role.id, existingKey);
  const requestPromise = admin.page.waitForRequest((request) => request.method() === "POST" && Boolean(request.headers()["next-action"]));
  await generateKey(admin, extensions);
  const request = await requestPromise;
  const before = await db.settings.findUniqueOrThrow({ where: { userId: actor.id } });
  await actor.page.request.post("/settings", {
    headers: { Origin: BASE, "Next-Action": request.headers()["next-action"], "Content-Type": request.headers()["content-type"] },
    data: request.postDataBuffer()!,
  });
  expect(await db.settings.findUnique({ where: { userId: actor.id } })).toEqual(before);
  await expectPrivateDownload(await actor.page.request.get(`${DOWNLOAD}?userId=${admin.id}`), 403);
});

test("E2 a plan alone opens the extension: downloads are reusable, keys are separate and stop with the plan", async ({ extensions }) => {
  const actor = await extensions.create({ plan: "trial" });
  const foreign = await extensions.create();
  const role = await db.role.create({ data: { userId: actor.id, title: "Authorized private role" } });
  const otherRole = await db.role.create({ data: { userId: foreign.id, title: "Foreign private role" } });
  // Your account points to Settings, where the download, the key and switching off live together.
  await actor.page.goto("/account");
  await expect(actor.page.getByRole("region", { name: "Browser extension", exact: true }).getByRole("link", { name: "Open Settings", exact: true })).toHaveAttribute("href", "/settings#connections-heading");
  await actor.page.goto("/settings");
  const section = actor.page.getByRole("region", { name: "Browser extension", exact: true });
  const link = section.getByRole("link", { name: "Download extension ZIP", exact: true });
  await expect(link).toHaveAttribute("href", DOWNLOAD);
  const [download] = await Promise.all([actor.page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  expect(await download.failure()).toBeNull();
  const privateValues = [actor.token, actor.email, PASSWORD, passwordHash];
  await expectZip(actor.page, privateValues);
  await expectCaptureDenied(actor.page, role.id);
  const key = await generateKey(actor, extensions);
  const guest = await extensions.guest();
  const headers = { "X-Capture-Token": key };
  const listed = await guest.request.get("/api/capture", { headers });
  expect(listed.status()).toBe(200);
  expect(await listed.json()).toEqual({
    account: { id: actor.id, name: actor.name, email: actor.email, plan: "Pro trial" },
    roles: [{ id: role.id, title: role.title, client: null }],
    extension: { version: expect.any(String) },
    // A trial has the finder; this server's searches are the stub's.
    emailFinder: { remaining: 50, quota: 50, trial: true },
  });
  expect((await guest.request.post("/api/capture", { headers, data: { roleId: otherRole.id, fullName: "Foreign injection", userId: foreign.id } })).status()).toBe(404);
  expect((await guest.request.post("/api/capture", { headers, data: { roleId: role.id, fullName: "Authorized capture", userId: foreign.id } })).status()).toBe(201);
  expect(await db.candidate.count({ where: { roleId: otherRole.id } })).toBe(0);
  // A forwarded copy is the same files for everyone: nothing in it is the account's.
  const ownContents = await expectZip(actor.page, [...privateValues, key, hashToken(key)]);
  const foreignContents = await expectZip(foreign.page, [...privateValues, key, hashToken(key), foreign.token, foreign.email]);
  expect(foreignContents).toBe(ownContents);

  // The trial ends: the same key stops, and so does the download.
  await db.user.update({ where: { id: actor.id }, data: { trialExpiresAt: new Date(Date.now() - 1000) } });
  expect((await guest.request.get("/api/capture", { headers })).status()).toBe(401);
  await expectPrivateDownload(await actor.page.request.get(DOWNLOAD), 403);
  // A subscription brings both back, with the key the account already had.
  await db.user.update({ where: { id: actor.id }, data: { billingPlan: "lite", billingStatus: "active" } });
  expect((await guest.request.get("/api/capture", { headers })).status()).toBe(200);
  await expectPrivateDownload(await actor.page.request.get(DOWNLOAD), 200);
  // Signing out and back in changes nothing about it.
  await actor.page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(actor.page).toHaveURL(`${BASE}/login`);
  await expectPrivateDownload(await actor.page.request.get(DOWNLOAD), 401);
  await actor.page.getByLabel("Email", { exact: true }).fill(actor.email);
  await actor.page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await actor.page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(actor.page).toHaveURL(`${BASE}/`);
  await expectZip(actor.page, [...privateValues, key, hashToken(key)]);
  await expectAuditPrivate([actor, foreign], [key, hashToken(key)]);
});

test("E3 administrators need no plan, and a read-only view downloads and generates nothing", async ({ extensions }) => {
  const admin = await extensions.create({ role: "admin" });
  const actor = await extensions.create();
  await expectZip(admin.page, [admin.token, admin.email, PASSWORD, passwordHash]);
  await admin.page.goto(`/admin/${actor.id}`);
  await admin.page.locator("article", { hasText: actor.email }).getByRole("button", { name: "View workspace (read-only)", exact: true }).click();
  await expect(admin.page).toHaveURL(`${BASE}/`);
  expect((await db.session.findUniqueOrThrow({ where: { tokenHash: hashToken(admin.token) } })).viewUserId).toBe(actor.id);
  await expectPrivateDownload(await admin.page.request.get(DOWNLOAD), 403);
  await admin.page.goto("/account");
  await expect(admin.page.getByRole("region", { name: "Browser extension", exact: true }).getByRole("link", { name: "Download extension ZIP", exact: true })).toHaveCount(0);
  await admin.page.goto("/settings");
  await expect(admin.page.getByRole("button", { name: /Generate (an extension|a new) key/ })).toHaveCount(0);
  expect((await db.settings.findUniqueOrThrow({ where: { userId: actor.id } })).captureTokenHash).toBeNull();
});
