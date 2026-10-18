import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db, TEST_ADMIN_ID } from "./helpers";
import { bookingToken } from "../lib/booking-core.mjs";
import { newNonce, shortlistToken } from "../lib/shortlist-core.mjs";

// Client interviews: the client's hours on the role, a signed link a
// candidate books from once the client asked to meet them, and the client's
// own view of what is booked. Fictional people and the disposable test
// database only; guest contexts carry no session.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const BOOKING_SECRET = "test-only-booking-link-secret-0000000000";
const SHORTLIST_SECRET = "test-only-shortlist-link-secret-00000000";
const EVERY_DAY = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, startMin: 8 * 60, endMin: 20 * 60 })));
const ROOM = "https://teams.example/halden-interviews";
let roleId = "";
let otherRoleId = "";
let clientLink = "";

async function guest(browser: Browser) {
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] }, timezoneId: "Europe/London" });
  return { page: await context.newPage(), close: () => context.close() };
}

// Someone on a role's client link, with what the client answered.
async function onLink(role: string, fullName: string, decision: string | null = "interview") {
  const person = await db.person.create({ data: { userId: TEST_ADMIN_ID, fullName, headline: "Platform engineer", searchText: fullName.toLowerCase() } });
  const candidate = await db.candidate.create({ data: { roleId: role, fullName, personId: person.id, stage: "submitted", submittedAt: new Date() } });
  let shortlist = await db.shortlist.findUnique({ where: { roleId: role } });
  if (!shortlist) {
    const r = await db.role.findUniqueOrThrow({ where: { id: role } });
    shortlist = await db.shortlist.create({ data: { userId: TEST_ADMIN_ID, kind: "role", roleId: role, title: r.title, client: r.client, access: "link", accesses: { create: { nonce: newNonce() } } } });
  }
  await db.shortlistItem.create({ data: { shortlistId: shortlist.id, personId: person.id, candidateId: candidate.id, consentAt: new Date(), decision, decisionAt: decision ? new Date() : null } });
  return { person, candidate };
}

function interviewLink(candidateId: string) {
  return `/book/${bookingToken(BOOKING_SECRET, candidateId, new Date(), "interview")}`;
}

async function book(page: Page, email: string, slot = 0) {
  await page.locator(".booking-slot").nth(slot).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel(/I have read how my details are used/).check();
  await page.getByRole("button", { name: "Book this interview" }).click();
}

test.beforeAll(async () => {
  roleId = (await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Interview Test Platform Lead", client: "Halden Systems" } })).id;
  otherRoleId = (await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Interview Test Data Lead", client: "Halden Systems Ltd" } })).id;
  await db.settings.update({ where: { userId: TEST_ADMIN_ID }, data: { recruiterName: "Morven Ellis", bookingWindows: EVERY_DAY, bookingTimezone: "Europe/London", bookingMinNoticeHours: 0, bookingDurationMins: 45, bookingHorizonDays: 21, meetingLink: "https://meet.example/morven" } });
});

test("I1 interview hours open filled in, are saved on the role, and fill in the next role for the same client", async ({ page }) => {
  await onLink(roleId, "Imogen Achterberg");
  await page.goto(`/roles/${roleId}`);
  const panel = page.locator("details.client-link");
  await panel.locator("summary").first().click();
  const hours = panel.locator("details.interview-hours");
  await expect(hours.getByText("Not set yet")).toBeVisible();
  await hours.locator("summary").click();
  await expect(hours.getByText(/Filled in from your own booking hours/)).toBeVisible();
  await hours.getByLabel("Interview length").selectOption("45");
  await hours.getByLabel(/Where/).fill(ROOM);
  await hours.getByRole("button", { name: "Save interview hours" }).click();
  await expect(hours.locator('[data-form-message="notice"]')).toContainText("Saved");
  const role = await db.role.findUniqueOrThrow({ where: { id: roleId } });
  const byDay = (json: string) => (JSON.parse(json) as { day: number }[]).sort((x, y) => x.day - y.day);
  expect(byDay(role.interviewWindows)).toEqual(byDay(EVERY_DAY));
  expect([role.interviewTimezone, role.interviewDurationMins, role.interviewLocation]).toEqual(["Europe/London", 45, ROOM]);

  // "Halden Systems Ltd" is the same client: its role offers these hours.
  await onLink(otherRoleId, "Sam Okafor");
  await page.goto(`/roles/${otherRoleId}`);
  await page.locator("details.client-link summary").first().click();
  const other = page.locator("details.interview-hours");
  await expect(other.getByText(/ready to copy from another Halden Systems Ltd role/)).toBeVisible();
  await other.locator("summary").click();
  await expect(other.getByLabel(/Where/)).toHaveValue(ROOM);
  await other.getByRole("button", { name: "Save interview hours" }).click();
  await expect(other.locator('[data-form-message="notice"]')).toContainText("Saved");
});

test("I2 {{interview_link}} is a gap until the client asks to meet them, and the follow-up offers the link", async ({ page }) => {
  const template = await db.messageTemplate.create({ data: { userId: TEST_ADMIN_ID, name: `Interview invite ${randomUUID().slice(0, 6)}`, kind: "message", body: "Hi {{first_name}}, book here: {{interview_link}}" } });
  const { candidate: waiting } = await onLink(roleId, "Priya Raman", null);
  await page.goto(`/candidates/${waiting.id}/outreach?template=${template.id}`);
  await expect(page.getByRole("region", { name: "Message preview" })).toContainText("book here: [MISSING: interview_link]");

  const imogen = await db.candidate.findFirstOrThrow({ where: { roleId, fullName: "Imogen Achterberg" } });
  await page.goto(`/candidates/${imogen.id}/outreach?template=${template.id}`);
  await expect(page.getByRole("region", { name: "Message preview" })).toContainText(new RegExp(`book here: http://localhost:3100/book/${imogen.id}\\.\\d+\\.i\\.`));

  // Other specs may leave people waiting in the same group, so the run is
  // started for Imogen alone, the way the list's Start button addresses it.
  await page.goto(`/followups/run?c=m.${imogen.id}&i=0`);
  await expect(page.getByLabel("Message")).toHaveValue(new RegExp(`You can pick a time for the interview that suits you here: http://localhost:3100/book/${imogen.id}\\.`));
});

test("I3 the candidate books the client's time: it names the client, moves them to Client interview, and leaves the recruiter's own diary alone", async ({ browser, page }, testInfo) => {
  const imogen = await db.candidate.findFirstOrThrow({ where: { roleId, fullName: "Imogen Achterberg" } });
  const candidate = await guest(browser);
  let booked = 0;
  try {
    await candidate.page.goto(interviewLink(imogen.id));
    await expect(candidate.page.getByRole("heading", { level: 1, name: "Book your interview with Halden Systems" })).toBeVisible();
    await expect(candidate.page.getByText(/It is a video call/)).toBeVisible();
    await candidate.page.screenshot({ path: testInfo.outputPath("interview-booking.png") });
    booked = Number(await candidate.page.locator(".booking-slot input").first().getAttribute("value"));
    // A day's notice at the earliest.
    expect(booked - Date.now()).toBeGreaterThan(23 * 3_600_000);
    await book(candidate.page, "imogen@example.test");
    await expect(candidate.page.getByRole("heading", { name: "Your interview is booked, Imogen" })).toBeVisible();
    await expect(candidate.page.getByText(ROOM)).toBeVisible();
    const ics = await candidate.page.request.get(`${interviewLink(imogen.id)}/ics`);
    expect(await ics.text()).toContain("SUMMARY:Interview with Halden Systems: Interview Test Platform Lead");
  } finally {
    await candidate.close();
  }
  const after = await db.candidate.findUniqueOrThrow({ where: { id: imogen.id } });
  expect(after.stage).toBe("interview");
  const booking = await db.booking.findFirstOrThrow({ where: { candidateId: imogen.id, kind: "interview" } });
  expect([booking.mode, booking.meetingUrl, booking.endsAt.getTime() - booking.startsAt.getTime()]).toEqual(["video", ROOM, 45 * 60_000]);
  expect(await db.interviewSlot.findUnique({ where: { bookingId: booking.id } })).not.toBeNull();
  expect(await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "interview_booked" } })).toBe(1);

  // A screening call at the same time is still on offer: the recruiter is not in the interview.
  const screeningCandidate = await db.candidate.create({ data: { roleId, fullName: "Screening Person", stage: "booking_pending" } });
  const screening = await guest(browser);
  try {
    await screening.page.goto(`/book/${bookingToken(BOOKING_SECRET, screeningCandidate.id)}`);
    await expect(screening.page.locator(`.booking-slot input[value="${booked}"]`)).toHaveCount(1);
  } finally {
    await screening.close();
  }

  await page.goto(`/roles/${roleId}`);
  await expect(page.locator("li.card", { hasText: "Imogen Achterberg" }).getByText("Interview with Halden Systems")).toBeVisible();
  await expect(page.getByLabel("Change stage for Imogen Achterberg")).toHaveValue("interview");
});

test("I4 two people cannot take one time with the same client, across its roles", async ({ browser }) => {
  const imogenBooking = await db.booking.findFirstOrThrow({ where: { kind: "interview", status: "booked", candidate: { roleId } } });
  const sam = await db.candidate.findFirstOrThrow({ where: { roleId: otherRoleId, fullName: "Sam Okafor" } });
  const other = await guest(browser);
  try {
    await other.page.goto(interviewLink(sam.id));
    await expect(other.page.getByRole("heading", { level: 1, name: "Book your interview with Halden Systems Ltd" })).toBeVisible();
    await expect(other.page.locator(`.booking-slot input[value="${imogenBooking.startsAt.getTime()}"]`)).toHaveCount(0);
    // Forcing the taken time is refused on the server.
    await other.page.locator(".booking-slot").first().click();
    await other.page.locator(".booking-slot input").first().evaluate((input, value) => { (input as HTMLInputElement).value = String(value); }, imogenBooking.startsAt.getTime());
    await other.page.getByLabel("Email address").fill("sam@example.test");
    await other.page.getByLabel(/I have read how my details are used/).check();
    await other.page.getByRole("button", { name: "Book this interview" }).click();
    await expect(other.page.locator('[data-form-message="error"]')).toContainText(/no longer free|just booked/);
  } finally {
    await other.close();
  }
  expect(await db.booking.count({ where: { candidateId: sam.id, kind: "interview" } })).toBe(0);
});

test("I5 the client sees the interview on their page, and 'Can't make this time' frees it and puts the candidate back in front of the recruiter", async ({ browser, page }, testInfo) => {
  const shortlist = await db.shortlist.findUniqueOrThrow({ where: { roleId }, include: { accesses: true } });
  const access = shortlist.accesses.find((entry) => !entry.email && !entry.revokedAt)!;
  clientLink = `/s/${shortlistToken(SHORTLIST_SECRET, access.id, access.nonce)}`;
  const imogen = await db.candidate.findFirstOrThrow({ where: { roleId, fullName: "Imogen Achterberg" } });
  // The recruiter wrote to her after the client's answer, so she has left
  // "Client wants to meet" until the client cancels.
  await db.outreachLog.create({ data: { candidateId: imogen.id, renderedBody: "Book here", kind: "message", sentAt: new Date() } });

  const client = await guest(browser);
  try {
    await client.page.goto(clientLink);
    const interviews = client.page.getByRole("region", { name: "Interviews" });
    await expect(interviews.getByText("Imogen Achterberg")).toBeVisible();
    await expect(interviews.getByText(ROOM)).toBeVisible();
    await client.page.screenshot({ path: testInfo.outputPath("client-interviews.png") });
    // An answer cannot change once the interview is booked.
    await expect(client.page.locator(".client-entry", { hasText: "Imogen Achterberg" }).getByRole("button", { name: "Change your answer" })).toHaveCount(0);
    await expect(client.page.locator(".client-entry", { hasText: "Imogen Achterberg" }).getByText("Your interview with Imogen is booked.")).toBeVisible();
    const ics = await client.page.request.get(`${clientLink}/interviews/${(await db.booking.findFirstOrThrow({ where: { candidateId: imogen.id, kind: "interview", status: "booked" } })).id}`);
    expect(await ics.text()).toContain("SUMMARY:Interview: Imogen Achterberg (Interview Test Platform Lead)");

    client.page.once("dialog", (dialog) => dialog.accept());
    await interviews.getByRole("button", { name: "Can't make this time" }).click();
    await expect(client.page.getByRole("region", { name: "Interviews" })).toHaveCount(0);
  } finally {
    await client.close();
  }
  expect((await db.candidate.findUniqueOrThrow({ where: { id: imogen.id } })).stage).toBe("submitted");
  expect(await db.interviewSlot.count({ where: { booking: { candidateId: imogen.id } } })).toBe(0);
  await page.goto("/followups");
  await expect(page.getByRole("region", { name: "Client wants to meet" }).getByText("Imogen Achterberg")).toBeVisible();

  // Her link offers the booking form again.
  const candidate = await guest(browser);
  try {
    await candidate.page.goto(interviewLink(imogen.id));
    await expect(candidate.page.getByRole("button", { name: "Book this interview" })).toBeVisible();
  } finally {
    await candidate.close();
  }
});

test("I6 no link for a declined answer, a closed role or do not contact, and a screening link cannot book an interview", async ({ browser }) => {
  const { candidate: declined } = await onLink(roleId, "Rory Quill", "declined");
  const { candidate: dnc, person } = await onLink(roleId, "Dana Marsh");
  await db.person.update({ where: { id: person.id }, data: { doNotContact: true } });
  const visitor = await guest(browser);
  try {
    for (const id of [declined.id, dnc.id]) {
      await visitor.page.goto(interviewLink(id));
      await expect(visitor.page.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();
    }
    const imogen = await db.candidate.findFirstOrThrow({ where: { roleId, fullName: "Imogen Achterberg" } });
    const screening = bookingToken(BOOKING_SECRET, imogen.id);
    const [id, day, sig] = screening.split(".");
    await visitor.page.goto(`/book/${id}.${day}.i.${sig}`);
    await expect(visitor.page.getByRole("heading", { name: "This link has expired" })).toBeVisible();

    await db.role.update({ where: { id: roleId }, data: { status: "closed" } });
    await visitor.page.goto(interviewLink(imogen.id));
    await expect(visitor.page.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();
    await db.role.update({ where: { id: roleId }, data: { status: "open" } });
  } finally {
    await visitor.close();
  }
});

test("I7 the recruiter cancels an interview from the role page and the candidate goes back to Submitted", async ({ browser, page }) => {
  const sam = await db.candidate.findFirstOrThrow({ where: { roleId: otherRoleId, fullName: "Sam Okafor" } });
  const candidate = await guest(browser);
  try {
    await candidate.page.goto(interviewLink(sam.id));
    await book(candidate.page, "sam@example.test");
    await expect(candidate.page.getByRole("heading", { name: "Your interview is booked, Sam" })).toBeVisible();
  } finally {
    await candidate.close();
  }
  await page.goto(`/roles/${otherRoleId}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("li.card", { hasText: "Sam Okafor" }).getByRole("button", { name: "Cancel interview" }).click();
  await expect(page.locator("li.card", { hasText: "Sam Okafor" }).getByText("Interview with Halden Systems Ltd")).toHaveCount(0);
  expect((await db.candidate.findUniqueOrThrow({ where: { id: sam.id } })).stage).toBe("submitted");
  expect(await db.interviewSlot.count({ where: { booking: { candidateId: sam.id } } })).toBe(0);
});

test("I8 with 'Candidates book straight away', being put forward is enough: no answer is asked, the link works and Follow-ups lists them", async ({ browser, page }, testInfo) => {
  const role = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Interview Test Straight Away", client: "Marsh & Pike", interviewWindows: EVERY_DAY, interviewTimezone: "Europe/London", interviewDurationMins: 30 } });
  const { candidate } = await onLink(role.id, "Tobias Lindqvist", null);
  await page.goto(`/roles/${role.id}`);
  await page.locator("details.client-link summary").first().click();
  await page.getByRole("button", { name: "Candidates book straight away" }).click();
  await expect(page.getByRole("button", { name: "Candidates book straight away" })).toHaveAttribute("aria-pressed", "true");
  await page.locator("details.client-link .client-link-panel").screenshot({ path: testInfo.outputPath("review-switch.png") });
  expect((await db.role.findUniqueOrThrow({ where: { id: role.id } })).clientReviewFirst).toBe(false);

  await page.goto("/followups");
  await expect(page.getByRole("region", { name: "Client wants to meet" }).getByText("Tobias Lindqvist")).toBeVisible();

  const shortlist = await db.shortlist.findUniqueOrThrow({ where: { roleId: role.id }, include: { accesses: true } });
  const client = await guest(browser);
  try {
    await client.page.goto(`/s/${shortlistToken(SHORTLIST_SECRET, shortlist.accesses[0].id, shortlist.accesses[0].nonce)}`);
    await expect(client.page.getByText("Tobias is invited to book an interview with you.")).toBeVisible();
    await expect(client.page.getByRole("button", { name: /Interview|Not for us/ })).toHaveCount(0);
    await client.page.goto(interviewLink(candidate.id));
    await expect(client.page.getByRole("button", { name: "Book this interview" })).toBeVisible();
  } finally {
    await client.close();
  }

  // Back to reviewing first: the same person now waits for an answer again.
  await page.goto(`/roles/${role.id}`);
  await page.locator("details.client-link summary").first().click();
  await page.getByRole("button", { name: "Marsh & Pike reviews first" }).click();
  await expect(page.getByRole("button", { name: "Marsh & Pike reviews first" })).toHaveAttribute("aria-pressed", "true");
  const visitor = await guest(browser);
  try {
    await visitor.page.goto(interviewLink(candidate.id));
    await expect(visitor.page.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();
  } finally {
    await visitor.close();
  }
});

test("I9 a client who wants to meet someone on a role without hours sets their own, once, and never over the recruiter's", async ({ browser }, testInfo) => {
  const role = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Interview Test Client Hours", client: "Fenwick Labs" } });
  const { candidate } = await onLink(role.id, "Odile Marchetti");
  const shortlist = await db.shortlist.findUniqueOrThrow({ where: { roleId: role.id }, include: { accesses: true } });
  const link = `/s/${shortlistToken(SHORTLIST_SECRET, shortlist.accesses[0].id, shortlist.accesses[0].nonce)}`;
  const client = await guest(browser);
  try {
    await client.page.goto(link);
    const panel = client.page.getByRole("region", { name: "When could you interview?" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Times are in Europe/London.")).toBeVisible();
    await panel.screenshot({ path: testInfo.outputPath("client-hours.png") });
    await panel.getByLabel("Friday", { exact: true }).uncheck();
    await panel.getByLabel("An interview lasts").selectOption("60");
    await panel.getByRole("button", { name: "Save these hours" }).click();
    await expect(client.page.getByRole("region", { name: "When could you interview?" })).toHaveCount(0);
  } finally {
    await client.close();
  }
  const saved = await db.role.findUniqueOrThrow({ where: { id: role.id } });
  expect(JSON.parse(saved.interviewWindows).map((w: { day: number }) => w.day)).toEqual([1, 2, 3, 4]);
  expect([saved.interviewTimezone, saved.interviewDurationMins]).toEqual(["Europe/London", 60]);
  expect(await db.auditEvent.count({ where: { action: "role.interview_hours_from_client" } })).toBe(1);
  // The candidate can now book within them.
  const candidatePage = await guest(browser);
  try {
    await candidatePage.page.goto(interviewLink(candidate.id));
    await expect(candidatePage.page.getByText("60 minutes.")).toBeVisible();
  } finally {
    await candidatePage.close();
  }

  // A role with the recruiter's own hours never asks the client.
  const recruiterSet = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Interview Test Recruiter Hours", client: "Fenwick Labs", interviewWindows: EVERY_DAY, interviewTimezone: "Europe/Paris", interviewDurationMins: 45 } });
  await onLink(recruiterSet.id, "Ravi Chandran");
  const theirs = await db.shortlist.findUniqueOrThrow({ where: { roleId: recruiterSet.id }, include: { accesses: true } });
  const other = await guest(browser);
  try {
    await other.page.goto(`/s/${shortlistToken(SHORTLIST_SECRET, theirs.accesses[0].id, theirs.accesses[0].nonce)}`);
    await expect(other.page.getByRole("heading", { level: 2, name: "Ravi Chandran" })).toBeVisible();
    await expect(other.page.getByRole("region", { name: "When could you interview?" })).toHaveCount(0);
  } finally {
    await other.close();
  }
  expect((await db.role.findUniqueOrThrow({ where: { id: recruiterSet.id } })).interviewTimezone).toBe("Europe/Paris");
});
