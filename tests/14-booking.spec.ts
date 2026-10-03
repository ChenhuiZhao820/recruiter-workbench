import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db, TEST_ADMIN_ID } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";
import { bookingToken } from "../lib/booking-core.mjs";

// Booking page: the recruiter sets their hours, each candidate gets a signed
// link, and the candidate books with no account. Fictional people and the
// disposable test database only; the second browser context plays the
// candidate and carries no session.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const SECRET = "test-only-booking-link-secret-0000000000";
const EVERY_DAY = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, startMin: 8 * 60, endMin: 20 * 60 })));
let roleId = "";

async function candidateOn(role: string, fullName: string, options: { userId?: string; stage?: string; doNotContact?: boolean } = {}) {
  const person = await db.person.create({ data: {
    userId: options.userId ?? TEST_ADMIN_ID, fullName, profileUrl: `https://www.linkedin.com/in/test-${randomUUID()}`,
    searchText: fullName.toLowerCase(), doNotContact: Boolean(options.doNotContact),
  } });
  return db.candidate.create({ data: { roleId: role, fullName, personId: person.id, stage: options.stage ?? "booking_pending" } });
}

async function guest(browser: Browser) {
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] }, timezoneId: "Europe/Lisbon" });
  return { page: await context.newPage(), close: () => context.close() };
}

async function book(page: Page, email: string, slotIndex = 0) {
  await page.locator(".booking-slot").nth(slotIndex).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel(/I have read how my details are used/).check();
  await page.getByRole("button", { name: "Book this call" }).click();
}

test.beforeAll(async () => {
  roleId = (await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Booking Test Platform Lead", client: "Halden Systems" } })).id;
  await db.settings.update({ where: { userId: TEST_ADMIN_ID }, data: { recruiterName: "Morven Ellis" } });
});

test("B1 the recruiter sets up the booking page, and a template's {{booking_link}} becomes each candidate's own link", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("link", { name: "Set up booking page" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Booking page" })).toBeVisible();
  await expect(page.getByText(/Booking links start working once you add the hours you take calls and a meeting link or the phone option/)).toBeVisible();

  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
    await page.getByLabel(day, { exact: true }).check();
    await page.getByLabel(`${day} from`).fill("08:00");
    await page.getByLabel(`${day} until`).fill("20:00");
  }
  await page.getByLabel("Minimum notice (hours)").fill("0");
  await page.getByLabel("Meeting link").fill("http://not-secure.example/room");
  await page.getByRole("button", { name: "Save booking page" }).click();
  await expect(page.locator('[data-form-message="error"]')).toContainText("full https:// address");
  await page.getByLabel("Meeting link").fill("https://meet.example/morven-room");
  await page.getByLabel("Offer a phone call").check();
  await page.getByRole("button", { name: "Save booking page" }).click();
  await expect(page.locator('[data-form-message="notice"]')).toContainText("Booking page saved");
  const settings = await db.settings.findUniqueOrThrow({ where: { userId: TEST_ADMIN_ID } });
  expect(settings).toMatchObject({ meetingLink: "https://meet.example/morven-room", offerPhone: true, bookingMinNoticeHours: 0, bookingTimezone: "Europe/London" });
  expect(JSON.parse(settings.bookingWindows)).toHaveLength(7);

  const candidate = await candidateOn(roleId, "Imogen Achterberg");
  await db.messageTemplate.create({ data: { userId: TEST_ADMIN_ID, name: "Booking invite", kind: "message", body: "Hi {{first_name}}, grab a time here: {{booking_link}}" } });
  await page.goto(`/candidates/${candidate.id}/outreach`);
  await expect(page.getByText(new RegExp(`grab a time here: http://localhost:3100/book/${candidate.id}\\.\\d+\\.[A-Za-z0-9_-]{43}`))).toBeVisible();
  await page.goto(`/roles/${roleId}`);
  await expect(page.locator("li.card", { hasText: "Imogen Achterberg" }).getByRole("button", { name: "Copy booking link" })).toBeVisible();
});

test("B2 a candidate with no account books a time; the call is recorded, they move to Booked, and both sides get a calendar file", async ({ browser, page }) => {
  const candidate = await db.candidate.findFirstOrThrow({ where: { roleId, fullName: "Imogen Achterberg" } });
  const token = bookingToken(SECRET, candidate.id);
  const visitor = await guest(browser);
  try {
    await visitor.page.goto(`/book/${token}`);
    await expect(visitor.page.getByRole("heading", { level: 1, name: "Book a call with Morven Ellis" })).toBeVisible();
    await expect(visitor.page.getByText("Booking Test Platform Lead")).toBeVisible();
    await expect(visitor.page.getByText("Halden Systems")).toHaveCount(0);
    await expect(visitor.page.getByRole("navigation")).toHaveCount(0);
    await expect(visitor.page.getByLabel("Time zone")).toHaveValue("Europe/Lisbon");
    await visitor.page.getByText("How your details are used").click();
    await expect(visitor.page.getByText(/ico\.org\.uk/)).toBeVisible();

    // The consent box is required; the browser refuses the form without it.
    await visitor.page.locator(".booking-slot").first().click();
    await visitor.page.getByLabel("Email address").fill("imogen@example.test");
    await visitor.page.getByRole("button", { name: "Book this call" }).click();
    expect(await db.booking.count({ where: { candidateId: candidate.id } })).toBe(0);

    await visitor.page.getByLabel("Phone call").check();
    await visitor.page.getByLabel("Phone number to call you on").fill("+44 7700 900123");
    await visitor.page.getByLabel(/Keep my details for future roles/).check();
    await visitor.page.getByLabel(/I have read how my details are used/).check();
    await visitor.page.getByRole("button", { name: "Book this call" }).click();
    await expect(visitor.page.getByRole("heading", { level: 1, name: "You are booked in, Imogen" })).toBeVisible();
    await expect(visitor.page.getByText("Morven Ellis will call you on +44 7700 900123")).toBeVisible();

    const ics = await visitor.page.request.get(`/book/${token}/ics`);
    expect(ics.status()).toBe(200);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    expect(await ics.text()).toMatch(/BEGIN:VEVENT[\s\S]*SUMMARY:Call with Morven Ellis: Booking Test Platform Lead/);
  } finally {
    await visitor.close();
  }

  const booking = await db.booking.findFirstOrThrow({ where: { candidateId: candidate.id } });
  expect(booking).toMatchObject({ mode: "phone", phone: "+44 7700 900123", email: "imogen@example.test", status: "booked", userId: TEST_ADMIN_ID });
  expect(booking.endsAt.getTime() - booking.startsAt.getTime()).toBe(30 * 60_000);
  expect(await db.bookedSlot.count({ where: { bookingId: booking.id } })).toBe(1);
  const person = await db.person.findUniqueOrThrow({ where: { id: candidate.personId! } });
  expect(person).toMatchObject({ email: "imogen@example.test", emailSource: "booking" });
  expect(person.emailConsentAt).not.toBeNull();
  expect((await db.candidate.findUniqueOrThrow({ where: { id: candidate.id } })).stage).toBe("booked");
  expect(await db.auditEvent.count({ where: { actorId: TEST_ADMIN_ID, action: "booking.created" } })).toBe(1);
  expect(await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "booking_link_used" } })).toBe(1);

  // The recruiter sees the call, and its calendar file is theirs alone.
  await page.goto(`/roles/${roleId}`);
  const card = page.locator("li.card", { hasText: "Imogen Achterberg" });
  await expect(card.getByText("Call booked")).toBeVisible();
  await expect(card.getByRole("link", { name: "Add to Google Calendar" })).toHaveAttribute("href", /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  const mine = await page.request.get(`/api/bookings/${booking.id}/ics`);
  expect(mine.status()).toBe(200);
  expect(await mine.text()).toContain("SUMMARY:Screening call: Imogen Achterberg (Booking Test Platform Lead)");
  await page.goto("/followups");
  await expect(page.getByRole("region", { name: "Calls this week" }).getByText("Imogen Achterberg")).toBeVisible();
});

test("B3 two candidates choosing the same time at once end with one booking", async ({ browser }) => {
  const first = await candidateOn(roleId, "Tobiah Rennick-Shaw");
  const second = await candidateOn(roleId, "Ewa Szczepanska");
  const a = await guest(browser);
  const b = await guest(browser);
  try {
    await a.page.goto(`/book/${bookingToken(SECRET, first.id)}`);
    await b.page.goto(`/book/${bookingToken(SECRET, second.id)}`);
    const firstSlot = await a.page.locator(".booking-slot input").first().getAttribute("value");
    expect(await b.page.locator(".booking-slot input").first().getAttribute("value")).toBe(firstSlot);
    for (const [visitor, email] of [[a, "tobiah@example.test"], [b, "ewa@example.test"]] as const) {
      await visitor.page.locator(".booking-slot").first().click();
      await visitor.page.getByLabel("Email address").fill(email);
      await visitor.page.getByLabel(/I have read how my details are used/).check();
    }
    await Promise.all([
      a.page.getByRole("button", { name: "Book this call" }).click(),
      b.page.getByRole("button", { name: "Book this call" }).click(),
    ]);
    const outcomes = await Promise.all([a.page, b.page].map(async (page) => {
      await expect(page.getByRole("heading", { name: /You are booked in/ }).or(page.locator('[data-form-message="error"]'))).toBeVisible();
      return page.getByRole("heading", { name: /You are booked in/ }).isVisible();
    }));
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const loser = outcomes[0] ? b.page : a.page;
    await expect(loser.locator('[data-form-message="error"]')).toContainText(/just booked that time|no longer free/);
    expect(await db.booking.count({ where: { startsAt: new Date(Number(firstSlot)), status: "booked" } })).toBe(1);
    // The taken time is no longer offered.
    await loser.reload();
    await expect(loser.locator(`.booking-slot input[value="${firstSlot}"]`)).toHaveCount(0);
  } finally {
    await a.close();
    await b.close();
  }
});

test("B4 a forged, altered or expired link opens nothing, and neither does a closed role or someone not to be contacted", async ({ browser }) => {
  const candidate = await candidateOn(roleId, "Callum O'Driscoll");
  const good = bookingToken(SECRET, candidate.id);
  const [id, day, signature] = good.split(".");
  const visitor = await guest(browser);
  try {
    for (const token of [
      `${id}.${day}.${signature.slice(0, -2)}xx`,
      bookingToken("another-secret-of-thirty-two-chars-xx", candidate.id),
      bookingToken(SECRET, candidate.id, new Date(Date.now() - 40 * 86_400_000)),
      `${id}.${Number(day) + 3}.${signature}`,
    ]) {
      await visitor.page.goto(`/book/${token}`);
      await expect(visitor.page.getByRole("heading", { level: 1, name: "This link has expired" })).toBeVisible();
      expect((await visitor.page.request.get(`/book/${token}/ics`)).status()).toBe(404);
    }

    const blocked = await candidateOn(roleId, "Saoirse Pemberton-Ade", { doNotContact: true });
    await visitor.page.goto(`/book/${bookingToken(SECRET, blocked.id)}`);
    await expect(visitor.page.getByRole("heading", { level: 1, name: "This link is no longer active" })).toBeVisible();

    const closedRole = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Closed Booking Role", status: "closed" } });
    const closed = await candidateOn(closedRole.id, "Odhran Vasquez-Beale");
    await visitor.page.goto(`/book/${bookingToken(SECRET, closed.id)}`);
    await expect(visitor.page.getByRole("heading", { level: 1, name: "This link is no longer active" })).toBeVisible();

    const placed = await candidateOn(roleId, "Ines Caetano-Lowe", { stage: "placed" });
    await visitor.page.goto(`/book/${bookingToken(SECRET, placed.id)}`);
    await expect(visitor.page.getByRole("heading", { level: 1, name: "This link is no longer active" })).toBeVisible();
    expect(await db.booking.count({ where: { candidateId: { in: [blocked.id, closed.id, placed.id] } } })).toBe(0);
  } finally {
    await visitor.close();
  }
});

test("B5 cancelling frees the time and puts the candidate back to booking pending", async ({ page, browser }) => {
  const candidate = await db.candidate.findFirstOrThrow({ where: { roleId, fullName: "Imogen Achterberg" } });
  const booking = await db.booking.findFirstOrThrow({ where: { candidateId: candidate.id, status: "booked" } });
  await page.goto(`/roles/${roleId}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("li.card", { hasText: "Imogen Achterberg" }).getByRole("button", { name: "Cancel call" }).click();
  await expect(page.locator("li.card", { hasText: "Imogen Achterberg" }).getByText("Call booked")).toHaveCount(0);
  expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("cancelled");
  expect(await db.bookedSlot.count({ where: { bookingId: booking.id } })).toBe(0);
  expect((await db.candidate.findUniqueOrThrow({ where: { id: candidate.id } })).stage).toBe("booking_pending");
  expect((await page.request.get(`/api/bookings/${booking.id}/ics`)).status()).toBe(404);

  const visitor = await guest(browser);
  try {
    await visitor.page.goto(`/book/${bookingToken(SECRET, candidate.id)}`);
    await expect(visitor.page.locator(`.booking-slot input[value="${booking.startsAt.getTime()}"]`)).toHaveCount(1);
  } finally {
    await visitor.close();
  }
});

test("B6 a Basic account has the booking page too; another account's calendar files and a read-only view are refused", async ({ browser, page }) => {
  const suffix = randomUUID();
  const basic = await db.user.create({ data: {
    email: `booking-basic-${suffix}@test.capture.invalid`, name: "Basic Recruiter", role: "recruiter", accountTier: "basic",
    settings: { create: { seenRelease: CURRENT_RELEASE, recruiterName: "Basic Recruiter", bookingWindows: EVERY_DAY, bookingMinNoticeHours: 0, offerPhone: true } },
  } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId: basic.id, authVersion: basic.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  const basicPage = await context.newPage();
  try {
    await basicPage.goto("/settings/booking");
    await expect(basicPage.getByText(/Booking links are working/)).toBeVisible();
    const role = await db.role.create({ data: { userId: basic.id, title: "Basic Booking Role" } });
    const candidate = await candidateOn(role.id, "Tamsin Okoro-Lindqvist", { userId: basic.id });
    const visitor = await guest(browser);
    try {
      await visitor.page.goto(`/book/${bookingToken(SECRET, candidate.id)}`);
      await expect(visitor.page.getByLabel("Phone number to call you on")).toBeVisible();
      await visitor.page.getByLabel("Phone number to call you on").fill("+44 7700 900456");
      await book(visitor.page, "tamsin@example.test");
      await expect(visitor.page.getByRole("heading", { name: /You are booked in/ })).toBeVisible();
    } finally {
      await visitor.close();
    }
    const booking = await db.booking.findFirstOrThrow({ where: { candidateId: candidate.id } });
    expect((await basicPage.request.get(`/api/bookings/${booking.id}/ics`)).status()).toBe(200);
    // Admin's own session cannot fetch another account's calendar file.
    expect((await page.request.get(`/api/bookings/${booking.id}/ics`)).status()).toBe(404);

    const adminToken = process.env.CAPTURE_TEST_SESSION_TOKEN!;
    await db.session.update({ where: { tokenHash: hashToken(adminToken) }, data: { viewUserId: basic.id } });
    try {
      await page.goto("/settings/booking");
      await expect(page.getByRole("button", { name: "Save booking page" })).toBeDisabled();
      expect((await page.request.get(`/api/bookings/${booking.id}/ics`)).status()).toBe(403);
      await page.goto(`/roles/${role.id}`);
      await expect(page.locator("li.card", { hasText: "Tamsin" }).getByText("Call booked")).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancel call" })).toHaveCount(0);
    } finally {
      await db.session.update({ where: { tokenHash: hashToken(adminToken) }, data: { viewUserId: null } });
    }
  } finally {
    await context.close();
  }
});

test("B7 the candidate's page fits a phone without sideways scrolling", async ({ browser }) => {
  const candidate = await candidateOn(roleId, "Ngozi Abernethy-Kaur");
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] }, viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  try {
    await page.goto(`/book/${bookingToken(SECRET, candidate.id)}`);
    await expect(page.getByRole("heading", { level: 1, name: /Book a call with/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  } finally {
    await context.close();
  }
});

test("B8 a person's page lists their calls: upcoming, done and cancelled, with a calendar file only for what is ahead", async ({ page }) => {
  const candidate = await candidateOn(roleId, "Lachlan Odum-Pryce", { stage: "booked" });
  const at = (days: number) => new Date(Date.now() + days * 86_400_000);
  const make = (startsAt: Date, status: string, mode = "video") => db.booking.create({ data: {
    candidateId: candidate.id, userId: TEST_ADMIN_ID, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    mode, phone: mode === "phone" ? "+44 7700 900789" : null, meetingUrl: mode === "video" ? "https://meet.example/morven-room" : null,
    email: "lachlan@example.test", consentAt: new Date(), noticeVersion: "test", status,
  } });
  const upcoming = await make(at(3), "booked", "phone");
  await make(at(-10), "booked");
  await make(at(-20), "cancelled");

  await page.goto(`/people/${candidate.personId}`);
  const calls = page.getByRole("region", { name: /Calls/ });
  await expect(calls.getByRole("heading", { name: /Calls/ })).toContainText("3");
  const rows = calls.locator(".person-role-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Upcoming");
  await expect(rows.nth(0)).toContainText("phone +44 7700 900789");
  await expect(rows.nth(1)).toContainText("Done");
  await expect(rows.nth(2)).toContainText("Cancelled");
  await expect(calls.getByRole("link", { name: "Calendar file" })).toHaveCount(1);
  await expect(calls.getByRole("link", { name: "Calendar file" })).toHaveAttribute("href", `/api/bookings/${upcoming.id}/ics`);
  await expect(calls.getByRole("link", { name: "Booking Test Platform Lead" }).first()).toHaveAttribute("href", `/roles/${roleId}`);

  // Somebody else's calls never appear, and a read-only view offers no file.
  const other = await db.user.create({ data: { email: `calls-other-${randomUUID()}@test.capture.invalid`, name: "Other Recruiter", role: "recruiter", accountTier: "basic", settings: { create: {} } } });
  const token = process.env.CAPTURE_TEST_SESSION_TOKEN!;
  await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: other.id } });
  try {
    expect((await page.goto(`/people/${candidate.personId}`))?.status()).toBe(404);
    const otherRole = await db.role.create({ data: { userId: other.id, title: "Other Role" } });
    const theirs = await candidateOn(otherRole.id, "Viewed Person", { userId: other.id });
    await db.booking.create({ data: { candidateId: theirs.id, userId: other.id, startsAt: at(2), endsAt: at(2.02), mode: "video", meetingUrl: "https://meet.example/x", email: "v@example.test", consentAt: new Date(), noticeVersion: "test" } });
    await page.goto(`/people/${theirs.personId}`);
    await expect(page.getByRole("region", { name: /Calls/ }).getByText("Upcoming")).toBeVisible();
    await expect(page.getByRole("link", { name: "Calendar file" })).toHaveCount(0);
  } finally {
    await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: null } });
  }
});
