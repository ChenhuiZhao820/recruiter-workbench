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

test("I1 a role's weekly hours set before still serve its interview link, and the Client link panel has no interview settings", async ({ page }) => {
  // The hours form and the "book straight away" switch are gone: interviews
  // are arranged on the candidate's own page. Hours a role already has still
  // offer times through {{interview_link}}, so the links already sent work.
  for (const id of [roleId, otherRoleId]) {
    await db.role.update({ where: { id }, data: { interviewWindows: EVERY_DAY, interviewTimezone: "Europe/London", interviewDurationMins: 45, interviewLocation: ROOM } });
  }
  await onLink(roleId, "Imogen Achterberg");
  await onLink(otherRoleId, "Sam Okafor");
  await page.goto(`/roles/${roleId}`);
  const panel = page.locator("details.client-link");
  await expect(panel.locator("summary").first()).toContainText(/Client link\s*· \d+ (person|people)/);
  await panel.locator("summary").first().click();
  await expect(panel.getByText("Interview hours")).toHaveCount(0);
  await expect(panel.getByText("Before an interview")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /book straight away/ })).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: /^Change stage for Imogen Achterberg/ })).toContainText("Client interview");
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
