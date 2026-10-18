import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";
import { newNonce, shortlistToken } from "../lib/shortlist-core.mjs";

// Arranging a client interview by hand, once the client wants to meet someone:
// the recruiter sets the time agreed with both sides, or offers a few times
// the candidate picks from. The role has no weekly interview hours at all.
// A fresh account keeps it apart from other specs; fictional people only. The
// candidate and the client each play in a context with no session.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const SECRET = "test-only-shortlist-link-secret-00000000";
const DAY = 86_400_000;
let userId = "";
let roleId = "";

// A date some days ahead in London, as a date input wants it.
function dayAhead(days: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + days * DAY));
}

async function guest(browser: Browser) {
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] }, timezoneId: "Europe/London" });
  return { page: await context.newPage(), close: () => context.close() };
}

async function recruiter(browser: Browser, viewUserId?: string) {
  const actor = viewUserId ? await db.user.findFirstOrThrow({ where: { role: "admin" } }) : await db.user.findUniqueOrThrow({ where: { id: userId } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId: actor.id, authVersion: actor.authVersion, viewUserId: viewUserId ?? null, expiresAt: new Date(Date.now() + 3_600_000) } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] }, timezoneId: "Europe/London" });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  return { page: await context.newPage(), close: () => context.close() };
}

async function candidateOn(fullName: string, stage = "screened") {
  const person = await db.person.create({ data: { userId, fullName, headline: `${fullName.split(" ")[0]} - Data lead`, searchText: fullName.toLowerCase() } });
  const candidate = await db.candidate.create({ data: { roleId, fullName, personId: person.id, stage } });
  return { person, candidate };
}

async function linkIn(page: Page) {
  const body = await page.getByLabel("Email", { exact: true }).inputValue();
  const found = body.match(/http:\/\/localhost:3100\/book\/\S+/);
  expect(found, body).not.toBeNull();
  return found![0];
}

test.beforeAll(async () => {
  userId = (await db.user.create({ data: {
    email: `arrange-${randomUUID()}@test.capture.invalid`, name: "Arrange Recruiter", role: "recruiter", accountTier: "basic",
    settings: { create: { seenRelease: CURRENT_RELEASE, recruiterName: "Arrange Recruiter", bookingTimezone: "Europe/London" } },
  } })).id;
  // No interview hours: arranging must not need them.
  roleId = (await db.role.create({ data: { userId, title: "Arrange Test Data Lead", client: "Fernmoor Ltd" } })).id;
});

test("R1 a shortlist answer: the row offers Arrange interview, setting the agreed time books it and puts them on the client link", async ({ browser }, testInfo) => {
  const { person, candidate } = await candidateOn("Tomasz Wierzbicki");
  // The client asked on a custom shortlist, not on the role's link.
  await db.shortlist.create({ data: {
    userId, kind: "custom", title: "Data people for Fernmoor", client: "Fernmoor", access: "link", expiresAt: new Date(Date.now() + 30 * DAY),
    accesses: { create: { nonce: newNonce() } },
    items: { create: { personId: person.id, consentAt: new Date(Date.now() - DAY), position: 0, decision: "interview", decisionAt: new Date() } },
  } });
  const me = await recruiter(browser);
  try {
    const page = me.page;
    await page.goto(`/roles/${roleId}`);
    await page.locator("li.card", { hasText: "Tomasz Wierzbicki" }).getByRole("link", { name: "Arrange interview" }).click();
    await expect(page).toHaveURL(new RegExp(`/candidates/${candidate.id}/interview$`));
    await expect(page.getByRole("heading", { level: 1, name: "Arrange Tomasz’s interview" })).toBeVisible();
    await expect(page.getByText(/Fernmoor Ltd asked to meet Tomasz Wierzbicki on .*, on the shortlist “Data people for Fernmoor”/)).toBeVisible();
    // Consent for this client is already known from the shortlist: no tick is asked for.
    await expect(page.getByLabel(/agreed to be put forward/)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("arrange-choices.png"), fullPage: true });

    const set = page.getByRole("region", { name: "You agreed a time" });
    await set.getByLabel("Date").fill(dayAhead(3));
    await set.getByLabel("Time", { exact: true }).fill("14:30");
    await set.getByLabel("Where (optional)").fill("https://meet.example.com/fernmoor");
    await set.getByRole("button", { name: "Book the interview" }).click();

    const booked = page.getByRole("region", { name: "Interview booked" });
    await expect(booked).toContainText("14:30 (London time)");
    await expect(booked).toContainText("https://meet.example.com/fernmoor");
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(/The interview is booked for .* at 14:30 \(London time\)\./);
    // Told by email, from the recruiter's own inbox: a mailto: with the subject and body, nothing sent by Capture.
    await expect(page.getByLabel("Subject")).toHaveValue("Your interview with Fernmoor Ltd: Arrange Test Data Lead");
    await page.getByLabel("Tomasz’s email address").fill("tomasz@private.example");
    await expect(page.getByRole("link", { name: "Open in email" })).toHaveAttribute("href", /^mailto:tomasz@private\.example\?subject=Your%20interview%20with%20Fernmoor%20Ltd/);
    await page.screenshot({ path: testInfo.outputPath("arrange-booked.png"), fullPage: true });

    const booking = await db.booking.findFirstOrThrow({ where: { candidateId: candidate.id, kind: "interview", status: "booked" } });
    expect(booking.timeZone).toBe("Europe/London");
    expect(booking.meetingUrl).toBe("https://meet.example.com/fernmoor");
    expect(booking.endsAt.getTime() - booking.startsAt.getTime()).toBe(45 * 60_000);
    expect(await db.interviewSlot.count({ where: { bookingId: booking.id } })).toBe(1);
    expect((await db.candidate.findUniqueOrThrow({ where: { id: candidate.id } })).stage).toBe("interview");
    // On the role's link now, with the client's answer carried across.
    const onRole = await db.shortlistItem.findFirstOrThrow({ where: { personId: person.id, shortlist: { roleId } } });
    expect(onRole.candidateId).toBe(candidate.id);
    expect(onRole.decision).toBe("interview");

    // The candidate's link shows the booking; the client's page lists it.
    const link = await linkIn(page);
    const visitor = await guest(browser);
    try {
      await visitor.page.goto(link);
      await expect(visitor.page.getByRole("heading", { level: 1, name: "Your interview is booked, Tomasz" })).toBeVisible();
      const access = await db.shortlistAccess.findFirstOrThrow({ where: { shortlist: { roleId }, email: null, revokedAt: null } });
      await visitor.page.goto(`/s/${shortlistToken(SECRET, access.id, access.nonce)}`);
      const interviews = visitor.page.getByRole("region", { name: "Interviews" });
      await expect(interviews).toContainText("Tomasz Wierzbicki");
      await expect(interviews).toContainText("https://meet.example.com/fernmoor");
    } finally {
      await visitor.close();
    }

    // Sending the message is the recruiter's; Capture records it when told.
    await page.getByRole("button", { name: "Mark as sent" }).click();
    await expect.poll(() => db.outreachLog.count({ where: { candidateId: candidate.id } })).toBe(1);
    expect((await db.outreachLog.findFirstOrThrow({ where: { candidateId: candidate.id } })).renderedBody).toMatch(/^Your interview with Fernmoor Ltd: Arrange Test Data Lead\n\nHi Tomasz,/);
    // The address typed was only for the mailto: link, never stored.
    expect((await db.person.findUniqueOrThrow({ where: { id: person.id } })).email).toBeNull();
    // The row no longer offers to arrange it.
    await page.goto(`/roles/${roleId}`);
    const row = page.locator("li.card", { hasText: "Tomasz Wierzbicki" });
    await expect(row.getByRole("link", { name: "Arrange interview" })).toHaveCount(0);
    await expect(row.getByText("Interview with Fernmoor Ltd")).toBeVisible();
  } finally {
    await me.close();
  }
});

test("R2 offering times: the candidate's link shows exactly those, the pick is booked, and the rest stop being offered", async ({ browser }, testInfo) => {
  const { person, candidate } = await candidateOn("Ines Halloran", "submitted");
  const shortlist = await db.shortlist.findFirstOrThrow({ where: { roleId } });
  await db.shortlistItem.create({ data: { shortlistId: shortlist.id, personId: person.id, candidateId: candidate.id, consentAt: new Date(), position: 1, decision: "interview", decisionAt: new Date() } });
  const me = await recruiter(browser);
  try {
    const page = me.page;
    await page.goto(`/candidates/${candidate.id}/interview`);
    const offer = page.getByRole("region", { name: "Offer a few times" });
    await offer.getByLabel("Date 1").fill(dayAhead(2));
    await offer.getByLabel("Time 1").fill("10:00");
    await offer.getByLabel("Date 2").fill(dayAhead(4));
    await offer.getByLabel("Time 2").fill("16:15");
    await offer.getByLabel("Where (optional)").fill("Fernmoor House, 2 Quay Street, Manchester");
    await offer.getByRole("button", { name: "Offer these times" }).click();

    const waiting = page.getByRole("region", { name: "Waiting for Ines to choose" });
    await expect(waiting.getByRole("list", { name: "Times offered" }).locator("li")).toHaveCount(2);
    await expect(waiting).toContainText("16:15 (London time)");
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(/pick the time that suits you best here\?/);
    await expect(page.getByLabel("Subject")).toHaveValue("Interview with Fernmoor Ltd: please choose a time");
    await page.screenshot({ path: testInfo.outputPath("arrange-offered.png"), fullPage: true });
    await page.goto(`/roles/${roleId}`);
    await expect(page.locator("li.card", { hasText: "Ines Halloran" }).getByText("Times offered, waiting for Ines")).toBeVisible();

    await page.goto(`/candidates/${candidate.id}/interview`);
    const link = await linkIn(page);
    const visitor = await guest(browser);
    try {
      await visitor.page.goto(link);
      await expect(visitor.page.getByRole("heading", { level: 1, name: "Book your interview with Fernmoor Ltd" })).toBeVisible();
      await expect(visitor.page.locator(".booking-slot")).toHaveCount(2);
      await expect(visitor.page.getByText("It is at Fernmoor House, 2 Quay Street, Manchester.")).toBeVisible();
      await visitor.page.locator(".booking-slot").nth(1).click();
      await visitor.page.getByLabel("Email address").fill("ines@private.example");
      await visitor.page.getByLabel(/I have read how my details are used/).check();
      await visitor.page.getByRole("button", { name: "Book this interview" }).click();
      await expect(visitor.page.getByRole("heading", { level: 1, name: "Your interview is booked, Ines" })).toBeVisible();
      await expect(visitor.page.getByText("Fernmoor House, 2 Quay Street, Manchester")).toBeVisible();
    } finally {
      await visitor.close();
    }
    const stored = await db.interviewOffer.findFirstOrThrow({ where: { candidateId: candidate.id } });
    const booking = await db.booking.findFirstOrThrow({ where: { candidateId: candidate.id, kind: "interview", status: "booked" } });
    expect(stored.bookingId).toBe(booking.id);
    expect(booking.place).toBe("Fernmoor House, 2 Quay Street, Manchester");
    expect(booking.timeZone).toBe("Europe/London");
    expect(JSON.parse(stored.times)[1]).toBe(booking.startsAt.getTime());
    // The recruiter hears of it, and the page now shows the booking.
    expect(await db.notification.count({ where: { userId, kind: "interview_booked", bookingId: booking.id } })).toBe(1);
    await page.reload();
    await expect(page.getByRole("region", { name: "Interview booked" })).toContainText("16:15 (London time)");
  } finally {
    await me.close();
  }
});

test("R3 guards: consent asked when unknown, a clash with the client's other interview refused, a withdrawn offer closes the link, foreign ids and read-only views", async ({ browser }) => {
  const { candidate } = await candidateOn("Wren Ashdown");
  const tomasz = await db.booking.findFirstOrThrow({ where: { candidate: { fullName: "Tomasz Wierzbicki", roleId } } });
  const me = await recruiter(browser);
  try {
    const page = me.page;
    await page.goto(`/candidates/${candidate.id}/interview`);
    await expect(page.getByText("Fernmoor Ltd has not said they want to meet Wren Ashdown yet.", { exact: false })).toBeVisible();
    const set = page.getByRole("region", { name: "You agreed a time" });
    const london = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(tomasz.startsAt);
    await set.getByLabel("Date").fill(dayAhead(3));
    await set.getByLabel("Time", { exact: true }).fill(london);
    // Without the tick the server refuses even if the browser is talked past it.
    await set.getByLabel(/Wren Ashdown agreed to be put forward to Fernmoor Ltd/).evaluate((box) => box.removeAttribute("required"));
    await set.getByRole("button", { name: "Book the interview" }).click();
    await expect(set.locator('[data-form-message="error"]')).toContainText("Tick that Wren Ashdown agreed to be put forward to Fernmoor Ltd.");
    // With the tick, the same time as Tomasz's interview with this client clashes.
    await set.getByLabel(/Wren Ashdown agreed to be put forward/).check();
    await set.getByRole("button", { name: "Book the interview" }).click();
    await expect(set.locator('[data-form-message="error"]')).toContainText("Another interview with Fernmoor Ltd overlaps that time.");
    expect(await db.booking.count({ where: { candidateId: candidate.id } })).toBe(0);

    // Offer, then withdraw: the link stops offering anything.
    const offer = page.getByRole("region", { name: "Offer a few times" });
    await offer.getByLabel(/Wren Ashdown agreed to be put forward/).check();
    await offer.getByLabel("Date 1").fill(dayAhead(5));
    await offer.getByLabel("Time 1").fill("09:30");
    await offer.getByRole("button", { name: "Offer these times" }).click();
    const link = await linkIn(page);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Withdraw these times" }).click();
    await expect(page.getByRole("region", { name: "Offer a few times" })).toBeVisible();
    const visitor = await guest(browser);
    try {
      await visitor.page.goto(link);
      await expect(visitor.page.getByRole("heading", { level: 1, name: "This link is no longer active" })).toBeVisible();
    } finally {
      await visitor.close();
    }

    // Another account's candidate is not found.
    const other = await db.user.create({ data: { email: `arrange-other-${randomUUID()}@test.capture.invalid`, name: "Other", role: "recruiter", settings: { create: { seenRelease: CURRENT_RELEASE } } } });
    const theirRole = await db.role.create({ data: { userId: other.id, title: "Theirs", client: "Fernmoor Ltd" } });
    const theirs = await db.candidate.create({ data: { roleId: theirRole.id, fullName: "Not Yours" } });
    expect((await page.goto(`/candidates/${theirs.id}/interview`))?.status()).toBe(404);
  } finally {
    await me.close();
  }

  // An administrator viewing the workspace read-only sees the page but cannot arrange.
  const viewer = await recruiter(browser, userId);
  try {
    await viewer.page.goto(`/candidates/${candidate.id}/interview`);
    await expect(viewer.page.getByRole("button", { name: "Book the interview" })).toBeDisabled();
    await expect(viewer.page.getByRole("button", { name: "Offer these times" })).toBeDisabled();
  } finally {
    await viewer.close();
  }
});

test("R4 the page fits a phone", async ({ browser }) => {
  const { candidate } = await candidateOn("Pia Morland");
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  try {
    const page = await context.newPage();
    await page.goto(`/candidates/${candidate.id}/interview`);
    await expect(page.getByRole("region", { name: "Offer a few times" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await context.close();
  }
});
