import { test, expect } from "@playwright/test";
import { db, TEST_ADMIN_ID, TEST_ADMIN_EMAIL } from "./helpers";
import { hashToken } from "../lib/auth-crypto";

// The extension's endpoint. The extension itself needs a real browser profile
// to test, but everything that decides what gets stored lives here.

test.describe.configure({ mode: "serial" });

const TOKEN = "test-capture-token-aaaaaaaaaaaaaaaaaaaa";
const BASE = "http://localhost:3100";
const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

let roleId = "";

test.beforeAll(async () => {
  await db.settings.upsert({
    where: { userId: TEST_ADMIN_ID },
    update: { captureTokenHash: hashToken(TOKEN) },
    create: { userId: TEST_ADMIN_ID, captureTokenHash: hashToken(TOKEN) },
  });
  const role = await db.role.create({
    data: { userId: TEST_ADMIN_ID, title: "Capture Target Role", jobDesc: "For the capture tests." },
  });
  roleId = role.id;
});

test("C1 no key, wrong key and switched-off capture are all refused", async ({ request }) => {
  const none = await request.post(`${BASE}/api/capture`, { data: { roleId, fullName: "A" } });
  expect(none.status()).toBe(401);

  const wrong = await request.post(`${BASE}/api/capture`, {
    headers: { "X-Capture-Token": "not-the-token" },
    data: { roleId, fullName: "A" },
  });
  expect(wrong.status()).toBe(401);

  // A null stored token hash means capture is off; an empty presented token must
  // not then count as a match.
  await db.settings.update({ where: { userId: TEST_ADMIN_ID }, data: { captureTokenHash: null } });
  const off = await request.post(`${BASE}/api/capture`, {
    headers: { "X-Capture-Token": "" },
    data: { roleId, fullName: "A" },
  });
  expect(off.status()).toBe(401);
  await db.settings.update({ where: { userId: TEST_ADMIN_ID }, data: { captureTokenHash: hashToken(TOKEN) } });

  expect(await db.candidate.count({ where: { roleId } })).toBe(0);
});

test("C2 a capture saves a candidate and normalises the profile link", async ({ request }) => {
  const response = await request.post(`${BASE}/api/capture`, {
    headers: { "X-Capture-Token": TOKEN },
    data: {
      roleId,
      fullName: "Priya Kaur",
      headline: "Finance Analyst at Widgets Aerospace",
      profileUrl: "www.linkedin.com/in/priya-kaur/",
      notes: "ACCA part-qualified, real month-end ownership.",
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.ok).toBe(true);
  expect(body.warning).toBeNull();

  const saved = await db.candidate.findFirst({ where: { roleId, fullName: "Priya Kaur" } });
  expect(saved!.profileUrl).toBe("https://www.linkedin.com/in/priya-kaur/");
  expect(saved!.notes).toContain("ACCA");
  expect(saved!.stage).toBe("sourced");
});

test("C3 the duplicate guard holds for one-click saves too", async ({ request }) => {
  const again = await request.post(`${BASE}/api/capture`, {
    headers: { "X-Capture-Token": TOKEN },
    data: {
      roleId,
      fullName: "Priya K",
      profileUrl: "https://www.linkedin.com/in/priya-kaur/",
    },
  });
  expect(again.status()).toBe(409);
  expect((await again.json()).error).toContain("already on this role");
  expect(await db.candidate.count({ where: { roleId } })).toBe(1);

  // Same name, no link: allowed, but it says so.
  const sameName = await request.post(`${BASE}/api/capture`, {
    headers: { "X-Capture-Token": TOKEN },
    data: { roleId, fullName: "Priya Kaur" },
  });
  expect(sameName.status()).toBe(201);
  expect((await sameName.json()).warning).toContain("already had someone called");
});

test("C4 bad input is refused with something a person can act on", async ({ request }) => {
  const noName = await request.post(`${BASE}/api/capture`, {
    headers: { "X-Capture-Token": TOKEN },
    data: { roleId, fullName: "   " },
  });
  expect(noName.status()).toBe(400);
  expect((await noName.json()).error).toContain("No name found");

  const noRole = await request.post(`${BASE}/api/capture`, {
    headers: { "X-Capture-Token": TOKEN },
    data: { roleId: "", fullName: "Someone" },
  });
  expect(noRole.status()).toBe(400);

  const goneRole = await request.post(`${BASE}/api/capture`, {
    headers: { "X-Capture-Token": TOKEN },
    data: { roleId: "does-not-exist", fullName: "Someone" },
  });
  expect(goneRole.status()).toBe(404);
});

test("C5 the role list is scoped to open roles", async ({ request }) => {
  const closed = await db.role.create({
    data: { userId: TEST_ADMIN_ID, title: "Closed Capture Role", status: "closed" },
  });
  const response = await request.get(`${BASE}/api/capture`, {
    headers: { "X-Capture-Token": TOKEN },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.account).toEqual({ id: TEST_ADMIN_ID, email: TEST_ADMIN_EMAIL, name: "Test Admin" });
  expect(Object.keys(body).sort()).toEqual(["account", "roles"]);
  const titles = body.roles.map((r: { title: string }) => r.title);
  expect(titles).toContain("Capture Target Role");
  expect(titles).not.toContain("Closed Capture Role");
  await db.role.delete({ where: { id: closed.id } });
});

test("C6 only an extension origin is allowed to read the response", async ({ request }) => {
  const fromExtension = await request.fetch(`${BASE}/api/capture`, {
    method: "OPTIONS",
    headers: { Origin: EXT_ORIGIN },
  });
  expect(fromExtension.status()).toBe(204);
  expect(fromExtension.headers()["access-control-allow-origin"]).toBe(EXT_ORIGIN);

  // A random site Paul happens to be visiting gets no allowance, so it cannot
  // read anything back even if it somehow knew the key.
  const fromWebPage = await request.fetch(`${BASE}/api/capture`, {
    method: "OPTIONS",
    headers: { Origin: "https://example.com" },
  });
  expect(fromWebPage.headers()["access-control-allow-origin"]).toBe("");
});

test("C7 a captured candidate behaves like any other", async ({ page }) => {
  await page.goto(`/roles/${roleId}`);
  // C3 deliberately left a second, bare "Priya Kaur" on this role, so pick the
  // captured one by the headline only it has.
  const card = page.locator("li.card", { hasText: "Finance Analyst at Widgets Aerospace" });
  await expect(card).toHaveCount(1);
  // The note appears twice: once displayed, once in the edit form behind it.
  await expect(card.locator("p", { hasText: "ACCA part-qualified" }).first()).toBeVisible();
  // The normalised link is a real outbound link, not a dead relative one.
  await expect(card.getByRole("link", { name: "Open profile" }).first()).toHaveAttribute(
    "href",
    "https://www.linkedin.com/in/priya-kaur/"
  );
});
