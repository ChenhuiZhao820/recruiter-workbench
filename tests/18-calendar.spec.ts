import { test, expect, type Browser } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db, TEST_ADMIN_ID } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { bookingToken } from "../lib/booking-core.mjs";

// Calendar free/busy: the recruiter connects Google or Microsoft read-only and
// the booking page stops offering times they are busy. The providers are the
// local stub (tests/anthropic-stub.mjs); nothing here reaches Google or
// Microsoft. Fictional people and the disposable test database only.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const STUB = "http://localhost:8766";
const SECRET = "test-only-booking-link-secret-0000000000";
const EVERY_DAY = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, startMin: 8 * 60, endMin: 20 * 60 })));
let token = "";

async function stub(state: Record<string, unknown>) {
  return (await fetch(`${STUB}/__calendar`, { method: "POST", body: JSON.stringify(state) })).json();
}

async function slotsSeen(browser: Browser) {
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  try {
    await page.goto(`/book/${token}`);
    await expect(page.getByRole("heading", { level: 1, name: /Book a call with/ })).toBeVisible();
    return (await page.locator(".booking-slot input").evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value))));
  } finally {
    await context.close();
  }
}

test.beforeAll(async () => {
  await stub({ busy: [], fail: false, decline: false, revoked: [], tokenRequests: [], authorizeQueries: [] });
  await db.settings.update({ where: { userId: TEST_ADMIN_ID }, data: { bookingWindows: EVERY_DAY, bookingMinNoticeHours: 0, meetingLink: "https://meet.example/morven-room", recruiterName: "Morven Ellis" } });
  const role = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Calendar Test Role" } });
  const person = await db.person.create({ data: { userId: TEST_ADMIN_ID, fullName: "Wilhelmina Ostrander", searchText: "wilhelmina" } });
  const candidate = await db.candidate.create({ data: { roleId: role.id, personId: person.id, fullName: person.fullName, stage: "booking_pending" } });
  token = bookingToken(SECRET, candidate.id);
});

test.afterAll(async () => {
  await stub({ busy: [], fail: false, decline: false });
  await db.calendarConnection.deleteMany({ where: { userId: TEST_ADMIN_ID } });
});

test("K1 a declined permission connects nothing; an accepted one keeps only an encrypted token", async ({ page }) => {
  await page.goto("/settings/booking");
  const section = page.getByRole("region", { name: "Your calendar" });
  await expect(section.getByText(/reads only when you are busy, never what the events are/)).toBeVisible();

  await stub({ decline: true });
  await section.getByRole("link", { name: "Connect Google Calendar" }).click();
  await expect(page).toHaveURL(/calendar=declined/);
  await expect(page.getByRole("status").filter({ hasText: "permission was not given" })).toBeVisible();
  expect(await db.calendarConnection.count({ where: { userId: TEST_ADMIN_ID } })).toBe(0);

  await stub({ decline: false });
  await page.getByRole("link", { name: "Connect Google Calendar" }).click();
  await expect(page).toHaveURL(/calendar=connected/);
  await expect(page.getByText("Google Calendar connected on")).toBeVisible();
  const connection = await db.calendarConnection.findUniqueOrThrow({ where: { userId: TEST_ADMIN_ID } });
  expect(connection.provider).toBe("google");
  expect(connection.tokenCipher).not.toContain("stub-refresh");
  expect(await db.auditEvent.count({ where: { actorId: TEST_ADMIN_ID, action: "calendar.connected" } })).toBe(1);

  const state = await stub({});
  const asked = state.authorizeQueries.at(-1);
  expect(asked.scope).toBe("https://www.googleapis.com/auth/calendar.events.freebusy");
  expect(asked.access_type).toBe("offline");
  expect(asked.redirect_uri).toBe(`${BASE}/api/calendar/callback/google`);
  expect(state.tokenRequests.every((request: { hasSecret: boolean }) => request.hasSecret)).toBe(true);
});

test("K2 busy time in the calendar is not offered, and a calendar that cannot be read leaves the weekly hours and warns the recruiter", async ({ browser, page }) => {
  const before = await slotsSeen(browser);
  expect(before.length).toBeGreaterThan(3);
  await stub({ busy: [{ start: before[0], end: before[1] + 60_000 }], fail: false });
  const busyNow = await slotsSeen(browser);
  expect(busyNow).not.toContain(before[0]);
  expect(busyNow).not.toContain(before[1]);
  expect(busyNow).toContain(before[2]);

  await stub({ fail: true });
  const failing = await slotsSeen(browser);
  expect(failing).toContain(before[0]);
  expect((await db.calendarConnection.findUniqueOrThrow({ where: { userId: TEST_ADMIN_ID } })).lastErrorAt).not.toBeNull();
  await page.goto("/settings/booking");
  await expect(page.getByRole("alert").filter({ hasText: "could not be read" })).toBeVisible();

  await stub({ fail: false });
  expect(await slotsSeen(browser)).not.toContain(before[0]);
  expect((await db.calendarConnection.findUniqueOrThrow({ where: { userId: TEST_ADMIN_ID } })).lastErrorAt).toBeNull();
});

test("K3 a forged or someone else's sign-in reply attaches nothing", async ({ page }) => {
  const before = await db.calendarConnection.findUniqueOrThrow({ where: { userId: TEST_ADMIN_ID } });
  await page.goto("/api/calendar/callback/microsoft?code=stub-code-microsoft&state=forged.state.value.x.y");
  await expect(page).toHaveURL(/calendar=failed/);
  await page.goto("/api/calendar/callback/microsoft?code=stub-code-microsoft");
  await expect(page).toHaveURL(/calendar=failed/);
  const after = await db.calendarConnection.findUniqueOrThrow({ where: { userId: TEST_ADMIN_ID } });
  expect(after.provider).toBe("google");
  expect(after.tokenCipher).toBe(before.tokenCipher);
});

test("K4 Microsoft works the same way, replacing Google, and disconnecting gives access back and deletes the token", async ({ browser, page }) => {
  await page.goto("/settings/booking");
  await expect(page.getByRole("link", { name: "Reconnect" })).toBeVisible();
  await page.goto("/api/calendar/connect/microsoft");
  await expect(page).toHaveURL(/calendar=connected/);
  await expect(page.getByText("Outlook / Microsoft 365 connected on")).toBeVisible();
  expect((await db.calendarConnection.findUniqueOrThrow({ where: { userId: TEST_ADMIN_ID } })).provider).toBe("microsoft");

  const free = await slotsSeen(browser);
  await stub({ busy: [{ start: free[0], end: free[0] + 30 * 60_000 }] });
  expect(await slotsSeen(browser)).not.toContain(free[0]);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toBeVisible();
  expect(await db.calendarConnection.count({ where: { userId: TEST_ADMIN_ID } })).toBe(0);
  expect(await db.auditEvent.count({ where: { actorId: TEST_ADMIN_ID, action: "calendar.disconnected" } })).toBe(1);
  expect(await slotsSeen(browser)).toContain(free[0]);
});

test("K5 a read-only Admin view cannot connect or disconnect someone else's calendar", async ({ page, request }) => {
  const other = await db.user.create({ data: { email: `calendar-other-${randomUUID()}@test.capture.invalid`, name: "Other Recruiter", role: "recruiter", settings: { create: {} } } });
  await db.calendarConnection.create({ data: { userId: other.id, provider: "google", tokenCipher: "v1.x.y.z", scope: "freebusy" } });
  const session = process.env.CAPTURE_TEST_SESSION_TOKEN!;
  await db.session.update({ where: { tokenHash: hashToken(session) }, data: { viewUserId: other.id } });
  try {
    await page.goto("/settings/booking");
    await expect(page.getByText("Google Calendar connected on")).toBeVisible();
    await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Connect / })).toHaveCount(0);
    expect((await request.get(`${BASE}/api/calendar/connect/google`, { maxRedirects: 0 })).status()).toBe(403);
  } finally {
    await db.session.update({ where: { tokenHash: hashToken(session) }, data: { viewUserId: null } });
  }
  expect(await db.calendarConnection.count({ where: { userId: other.id } })).toBe(1);
});
