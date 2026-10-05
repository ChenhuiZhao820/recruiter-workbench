import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db, TEST_ADMIN_ID } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";

// Screening assistant: paste a call, get a draft of four facts, confirm each
// against its quote, save to the person. The model is the local stub
// (tests/anthropic-stub.mjs); only fictional people and the disposable test
// database are used.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const STUB = "http://localhost:8766";
const DAY = 86_400_000;
const CALL = [
  "Morven: Thanks for making time. What are you looking for on salary?",
  "Imogen: I'd be looking for something around 85 to 95 thousand base.",
  "Morven: And your notice?",
  "Imogen: It's three months notice, but it's negotiable.",
  "Morven: Where are you based?",
  "Imogen: I'm based in Manchester and I'd want hybrid, two days in the office at most.",
].join("\n");
const VTT = [
  "WEBVTT",
  "",
  "1",
  "00:00:01.000 --> 00:00:04.000",
  "<v Morven Ellis>What are you looking for on salary?</v>",
  "",
  "2",
  "00:00:04.500 --> 00:00:09.000",
  "<v Imogen Achterberg>I'd be looking for something around 85 to 95 thousand base.</v>",
  "",
].join("\n");

let roleId = "";
const month = new Date().toISOString().slice(0, 7);

async function makeCandidate(fullName: string, options: { userId?: string; role?: string } = {}) {
  const userId = options.userId ?? TEST_ADMIN_ID;
  const role = options.role ?? roleId;
  const person = await db.person.create({ data: { userId, fullName, profileUrl: `https://www.linkedin.com/in/test-${randomUUID()}`, searchText: fullName.toLowerCase() } });
  return db.candidate.create({ data: { roleId: role, fullName, personId: person.id, stage: "booked" } });
}

async function stubCalls() {
  return (await fetch(`${STUB}/__last-screening`)).json();
}

async function generations(userId = TEST_ADMIN_ID) {
  return (await db.aiUsage.findUnique({ where: { userId_month: { userId, month } } }))?.generations ?? 0;
}

// The box opens on a click; a saved draft or an upload opens it already.
async function transcriptBox(page: Page) {
  const add = page.getByRole("button", { name: "Add meeting note or transcript" });
  if (await add.isVisible()) await add.click();
  return page.getByLabel("Transcript or notes");
}

async function paste(page: Page, text: string) {
  await (await transcriptBox(page)).fill(text);
  await page.getByRole("button", { name: "Summarise" }).click();
}

async function accountPage(browser: Browser, accountTier: "basic" | "pro") {
  const suffix = randomUUID();
  const user = await db.user.create({ data: {
    email: `screening-${accountTier}-${suffix}@test.capture.invalid`, name: accountTier === "basic" ? "Basic Recruiter" : "Pro Recruiter", role: "recruiter", accountTier,
    settings: { create: { seenRelease: CURRENT_RELEASE } },
  } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  return { user, page: await context.newPage(), close: () => context.close() };
}

test.beforeAll(async () => {
  roleId = (await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Screening Test Platform Lead", client: "Halden Systems" } })).id;
});

test("S1 a call becomes four facts to check, an invented quote is caught, and nothing is saved until all four are confirmed", async ({ page }) => {
  const candidate = await makeCandidate("Imogen Achterberg");
  await page.goto(`/roles/${roleId}`);
  await page.locator("li.card", { hasText: "Imogen Achterberg" }).getByRole("link", { name: "Screening call", exact: true }).click();
  // The first visit compiles the page on the test server, which can be slow.
  await expect(page).toHaveURL(/\/screening$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Screening call with Imogen Achterberg" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add the call transcript" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Summarise" })).toBeDisabled();

  await paste(page, CALL);
  await expect(page.getByRole("heading", { name: "Check the four facts" })).toBeVisible();
  const salary = page.getByRole("region", { name: "Salary expectation" });
  await expect(salary.getByText("I'd be looking for something around 85 to 95 thousand base")).toBeVisible();
  const rtw = page.getByRole("region", { name: "Right to work" });
  await expect(rtw.getByText("No quote found.")).toBeVisible();
  await expect(rtw.getByText("indefinite leave")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save to their record" })).toBeDisabled();
  await expect(page.getByText("Confirm 4 more facts first.")).toBeVisible();

  const stored = await db.screening.findFirstOrThrow({ where: { candidateId: candidate.id } });
  expect(stored.status).toBe("summarized");
  expect(stored.summaryJson).not.toContain("secret_extra");
  expect(stored.transcriptDeleteAfter!.getTime() - stored.createdAt.getTime()).toBeGreaterThan(29 * DAY);
  expect(await db.person.findUniqueOrThrow({ where: { id: candidate.personId! } })).toMatchObject({ salaryMin: null, factsConfirmedAt: null });
  const request = await stubCalls();
  expect(request).toMatchObject({ model: "claude-opus-5-5", hasDocument: false, schemaOk: true, promptOk: true, fallbacks: "default" });
  expect(request.beta).toContain("server-side-fallback-2026-07-01");

  // A card cannot be confirmed empty.
  const location = page.getByRole("region", { name: "Location and remote" });
  await location.getByLabel("Based in").fill("");
  await location.getByLabel("Working pattern").selectOption("");
  await location.getByLabel("Note").fill("");
  await location.getByRole("button", { name: "Confirm" }).click();
  await expect(location.getByRole("alert")).toContainText('tick "Not discussed"');
  await location.getByLabel("Based in").fill("Manchester");
  await location.getByLabel("Working pattern").selectOption("hybrid");
  await location.getByRole("button", { name: "Confirm" }).click();
  await expect(location.getByText("Manchester, Hybrid")).toBeVisible();

  await salary.getByLabel("From (a year)").fill("88k");
  await salary.getByRole("button", { name: "Confirm" }).click();
  await expect(salary.getByText("£88,000 to £95,000 a year")).toBeVisible();
  await page.getByRole("region", { name: "Notice period" }).getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Confirm 1 more fact first.")).toBeVisible();
  await rtw.getByLabel("Not discussed").check();
  await rtw.getByRole("button", { name: "Confirm" }).click();
  await expect(rtw.getByText("Not discussed", { exact: true })).toBeVisible();

  // Editing a confirmed card reopens it.
  await page.getByRole("region", { name: "Notice period" }).getByRole("button", { name: "Edit" }).click();
  await expect(page.getByText("Confirm 1 more fact first.")).toBeVisible();
  await page.getByRole("region", { name: "Notice period" }).getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByRole("button", { name: "Save to their record" })).toBeEnabled();
  await page.getByLabel(/Imogen agreed to be put forward to Halden Systems/).check();
  await page.getByRole("button", { name: "Save to their record" }).click();
  await expect(page.getByRole("heading", { name: /^Confirmed / })).toBeVisible();
  await expect(page.getByText("Imogen agreed to be put forward to Halden Systems.")).toBeVisible();

  const person = await db.person.findUniqueOrThrow({ where: { id: candidate.personId! } });
  expect(person).toMatchObject({
    salaryMin: 88000, salaryMax: 95000, salaryCurrency: "GBP", noticeWeeks: 12,
    location: "Manchester", remotePreference: "hybrid", rightToWork: null,
    skillsSummary: "Kubernetes, Terraform",
  });
  expect(person.factsConfirmedAt).not.toBeNull();
  expect(person.searchText).toContain("kubernetes");
  expect((await db.candidate.findUniqueOrThrow({ where: { id: candidate.id } })).stage).toBe("screened");
  const confirmed = await db.screening.findUniqueOrThrow({ where: { id: stored.id } });
  expect(confirmed.status).toBe("confirmed");
  expect(confirmed.representConsentAt).not.toBeNull();

  const events = await db.usageEvent.findMany({ where: { userId: TEST_ADMIN_ID } });
  expect(events.filter((event) => event.kind === "quote_missing")).toHaveLength(1);
  expect(events.filter((event) => event.kind === "screening_confirmed")).toHaveLength(1);
  // Salary changed, the location note was cleared, and right to work was
  // marked not discussed: three edits.
  expect(events.filter((event) => event.kind === "ai_field_edited")).toHaveLength(3);
  expect(JSON.stringify(events)).not.toMatch(/Imogen|Manchester|85 to 95/);
  expect(await generations()).toBe(1);

  // The person page shows the facts and the screening.
  await page.getByRole("link", { name: /Open Imogen.s record/ }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${candidate.personId}$`));
  await expect(page.getByText("£88,000 to £95,000 a year")).toBeVisible();
  const screenings = page.getByRole("region", { name: /Screenings/ });
  await expect(screenings.getByText(/agreed to be put forward to Halden Systems/)).toBeVisible();
});

test("S2 an uploaded .vtt is read into the box and stored as speaker lines; the CV goes with the request and is not kept", async ({ page }) => {
  const candidate = await makeCandidate("Tobiah Rennick-Shaw");
  await page.goto(`/candidates/${candidate.id}/screening`);
  await page.getByLabel("Or upload the transcript file").setInputFiles({ name: "call.vtt", mimeType: "text/vtt", buffer: Buffer.from(VTT) });
  await expect(page.getByText("Read call.vtt. Check it below, then summarise.")).toBeVisible();
  await expect(page.getByLabel("Transcript or notes")).toHaveValue(/WEBVTT/);
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Page >>\n%%EOF\n");
  await page.getByLabel("CV (optional)").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "Summarise" }).click();
  await expect(page.getByRole("heading", { name: "Check the four facts" })).toBeVisible();

  const stored = await db.screening.findFirstOrThrow({ where: { candidateId: candidate.id } });
  expect(stored.transcriptSource).toBe("upload");
  expect(stored.transcript).toBe("Morven Ellis: What are you looking for on salary?\nImogen Achterberg: I'd be looking for something around 85 to 95 thousand base.");
  expect(JSON.stringify(stored)).not.toContain("PDF");
  expect((await stubCalls()).hasDocument).toBe(true);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Discard this summary" }).click();
  await expect(page.getByRole("heading", { name: "Add the call transcript" })).toBeVisible();
  expect(await db.screening.count({ where: { candidateId: candidate.id } })).toBe(0);
});

test("S3 a CV that is too long or not a PDF is refused before anything is sent", async ({ page }) => {
  const candidate = await makeCandidate("Ewa Szczepanska");
  const before = await generations();
  await page.goto(`/candidates/${candidate.id}/screening`);
  await (await transcriptBox(page)).fill(CALL);
  const pages = Array.from({ length: 6 }, (_, i) => `${i + 1} 0 obj << /Type /Page >>`).join("\n");
  await page.getByLabel("CV (optional)").setInputFiles({ name: "long.pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7\n${pages}\n`) });
  await page.getByRole("button", { name: "Summarise" }).click();
  await expect(page.locator('[data-form-message="error"]')).toContainText("That CV has 6 pages");
  await page.getByLabel("CV (optional)").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("not really a pdf") });
  await page.getByRole("button", { name: "Summarise" }).click();
  await expect(page.locator('[data-form-message="error"]')).toContainText("The CV must be a PDF");
  expect(await generations()).toBe(before);
  expect(await db.screening.count({ where: { candidateId: candidate.id } })).toBe(0);
});

test("S4 a reply in the wrong shape, a refusal or an outage keeps the transcript and refunds the summary", async ({ page }) => {
  const candidate = await makeCandidate("Callum O'Driscoll");
  const before = await generations();
  await page.goto(`/candidates/${candidate.id}/screening`);
  await paste(page, `${CALL}\nSTUB_BADJSON`);
  await expect(page.locator('[data-form-message="error"]')).toContainText("shape that could not be read");
  expect(await generations()).toBe(before);
  const draft = await db.screening.findFirstOrThrow({ where: { candidateId: candidate.id } });
  expect(draft.status).toBe("draft");

  await page.reload();
  await expect(page.getByText(/not summarised yet/)).toBeVisible();
  await expect(page.getByLabel("Transcript or notes")).toHaveValue(/STUB_BADJSON/);
  await paste(page, `${CALL}\nSTUB_REFUSE`);
  await expect(page.locator('[data-form-message="error"]')).toContainText("declined this transcript");
  await paste(page, `${CALL}\nSTUB_DOWN`);
  await expect(page.locator('[data-form-message="error"]')).toContainText("could not be reached");
  expect(await generations()).toBe(before);
  expect(await db.screening.count({ where: { candidateId: candidate.id } })).toBe(1);

  // One malformed reply is retried once and then succeeds.
  await paste(page, `${CALL}\nSTUB_MALFORMED_ONCE`);
  await expect(page.getByRole("heading", { name: "Check the four facts" })).toBeVisible();
  expect(await generations()).toBe(before + 1);
  expect(await db.screening.count({ where: { candidateId: candidate.id } })).toBe(1);
});

test("S5 the monthly cap refuses before calling the model and keeps the transcript", async ({ page }) => {
  const candidate = await makeCandidate("Saoirse Pemberton-Ade");
  const previous = await generations();
  await db.aiUsage.upsert({ where: { userId_month: { userId: TEST_ADMIN_ID, month } }, create: { userId: TEST_ADMIN_ID, month, generations: 100 }, update: { generations: 100 } });
  try {
    await page.goto(`/candidates/${candidate.id}/screening`);
    await expect(page.getByText("100 of 100")).toBeVisible();
    await paste(page, CALL);
    await expect(page.locator('[data-form-message="error"]')).toContainText("this month's 100 screening summaries");
    expect(await generations()).toBe(100);
    const draft = await db.screening.findFirstOrThrow({ where: { candidateId: candidate.id } });
    expect(draft).toMatchObject({ status: "draft", transcript: CALL });
  } finally {
    await db.aiUsage.update({ where: { userId_month: { userId: TEST_ADMIN_ID, month } }, data: { generations: previous } });
  }
});

test("S6 a transcript past its date is hidden at once and removed by the next screening action; one can also be deleted early", async ({ page }) => {
  const old = await makeCandidate("Odhran Vasquez-Beale");
  const expired = await db.screening.create({ data: {
    candidateId: old.id, status: "draft", transcript: "Morven: an old call", transcriptSource: "paste",
    transcriptDeleteAfter: new Date(Date.now() - DAY),
  } });
  await page.goto(`/candidates/${old.id}/screening`);
  await expect(page.getByText("an old call")).toHaveCount(0);
  await expect(page.getByLabel("Transcript or notes")).toBeHidden();
  await expect(await transcriptBox(page)).toHaveValue("");

  const fresh = await makeCandidate("Ines Caetano-Lowe");
  await page.goto(`/candidates/${fresh.id}/screening`);
  await paste(page, CALL);
  await expect(page.getByRole("heading", { name: "Check the four facts" })).toBeVisible();
  expect((await db.screening.findUniqueOrThrow({ where: { id: expired.id } })).transcript).toBeNull();

  await expect(page.getByText(/The transcript is kept until/)).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete transcript now" }).click();
  await expect(page.getByText("The transcript has been deleted. What you confirmed stays.")).toBeVisible();
  const current = await db.screening.findFirstOrThrow({ where: { candidateId: fresh.id } });
  expect(current.transcript).toBeNull();
  expect(current.summaryJson).not.toBeNull();
});

test("S7 a Basic account sees no screening anywhere and its routes are not found", async ({ browser }) => {
  const basic = await accountPage(browser, "basic");
  try {
    const role = await db.role.create({ data: { userId: basic.user.id, title: "Basic Role" } });
    const candidate = await makeCandidate("Basic Candidate", { userId: basic.user.id, role: role.id });
    await basic.page.goto(`/roles/${role.id}`);
    await expect(basic.page.getByRole("link", { name: "Draft outreach" })).toBeVisible();
    await expect(basic.page.getByRole("link", { name: "Screening call", exact: true })).toHaveCount(0);
    await basic.page.goto(`/people/${candidate.personId}`);
    await expect(basic.page.getByRole("heading", { level: 1, name: "Basic Candidate" })).toBeVisible();
    await expect(basic.page.getByRole("link", { name: "Screening call", exact: true })).toHaveCount(0);
    await expect(basic.page.getByRole("heading", { name: "Confirmed details" })).toHaveCount(0);
    const response = await basic.page.goto(`/candidates/${candidate.id}/screening`);
    expect(response?.status()).toBe(404);
  } finally {
    await basic.close();
  }
});

test("S8 another account's candidate is not found, and a read-only Admin view of a Pro workspace cannot change anything", async ({ page, browser }) => {
  const pro = await accountPage(browser, "pro");
  try {
    const role = await db.role.create({ data: { userId: pro.user.id, title: "Pro Role", client: "Orrin Labs" } });
    const candidate = await makeCandidate("Tamsin Okoro-Lindqvist", { userId: pro.user.id, role: role.id });
    await db.screening.create({ data: { candidateId: candidate.id, status: "draft", transcript: CALL, transcriptSource: "paste", transcriptDeleteAfter: new Date(Date.now() + DAY) } });

    // Admin's own workspace cannot reach it.
    expect((await page.goto(`/candidates/${candidate.id}/screening`))?.status()).toBe(404);

    const token = process.env.CAPTURE_TEST_SESSION_TOKEN!;
    await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: pro.user.id } });
    try {
      await page.goto(`/candidates/${candidate.id}/screening`);
      await expect(page.getByRole("heading", { level: 1, name: "Screening call with Tamsin Okoro-Lindqvist" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Summarise" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Delete transcript now" })).toHaveCount(0);
    } finally {
      await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: null } });
    }
  } finally {
    await pro.close();
  }
});

test("S9 the screening page fits a phone without sideways scrolling", async ({ page }) => {
  const candidate = await makeCandidate("Ngozi Abernethy-Kaur");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/candidates/${candidate.id}/screening`);
  await paste(page, CALL);
  await expect(page.getByRole("heading", { name: "Check the four facts" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("S10 a reused draft starts its own 30 days, and a summary the server abandoned can be retried", async ({ page }) => {
  const reused = await makeCandidate("Fenella Ashworth-Grieve");
  const draft = await db.screening.create({ data: {
    candidateId: reused.id, status: "draft", transcript: "Morven: an old note", transcriptSource: "manual",
    transcriptDeleteAfter: new Date(Date.now() - DAY),
  } });
  await page.goto(`/candidates/${reused.id}/screening`);
  await paste(page, CALL);
  await expect(page.getByRole("heading", { name: "Check the four facts" })).toBeVisible();
  const after = await db.screening.findUniqueOrThrow({ where: { id: draft.id } });
  expect(after.transcript).toBe(CALL);
  expect(after.transcriptDeleteAfter!.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);

  const busy = await makeCandidate("Lachlan Odum-Pryce");
  const claim = await db.screening.create({ data: { candidateId: busy.id, status: "working", transcript: CALL, transcriptSource: "paste", transcriptDeleteAfter: new Date(Date.now() + DAY) } });
  await page.goto(`/candidates/${busy.id}/screening`);
  await expect(page.getByRole("heading", { name: "Summarising the call" })).toBeVisible();
  await db.screening.update({ where: { id: claim.id }, data: { updatedAt: new Date(Date.now() - 10 * 60_000) } });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Add the call transcript" })).toBeVisible();
  await expect(page.getByLabel("Transcript or notes")).toHaveValue(CALL);
  await page.getByRole("button", { name: "Summarise" }).click();
  await expect(page.getByRole("heading", { name: "Check the four facts" })).toBeVisible();
  expect(await db.screening.count({ where: { candidateId: busy.id } })).toBe(1);
});

test("S11 the box opens on a click, a summary in flight shows its progress, and a transcript the recruiter chose not to keep is never stored", async ({ page }) => {
  const candidate = await makeCandidate("Rosalind Featherstone-Obi");
  await page.goto(`/candidates/${candidate.id}/screening`);
  await expect(page.getByRole("heading", { name: "Add the call transcript" })).toBeVisible();
  await expect(page.getByLabel("Transcript or notes")).toBeHidden();
  await expect(page.getByText(/Usually under a minute|A PDF of up to 5 pages|A \.txt or \.vtt file/)).toHaveCount(0);
  await page.getByRole("button", { name: "Add meeting note or transcript" }).click();
  await expect(page.getByLabel("Transcript or notes")).toBeFocused();

  await page.getByLabel("Transcript or notes").fill(`${CALL}\nSTUB_SLOW`);
  await page.getByLabel(/Don.t keep the transcript in Capture/).check();
  await page.getByRole("button", { name: "Summarise" }).click();
  const progress = page.getByRole("progressbar", { name: "Summarising the call" });
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute("aria-valuetext", /.+/);
  await expect(page.getByRole("heading", { name: "Check the four facts" })).toBeVisible();
  await expect(progress).toHaveCount(0);

  const stored = await db.screening.findFirstOrThrow({ where: { candidateId: candidate.id } });
  expect(stored).toMatchObject({ status: "summarized", transcript: null, transcriptDeleteAfter: null, transcriptSource: "paste" });
  await expect(page.getByText("The transcript has been deleted.")).toBeVisible();

  // A failed summary with nothing kept leaves no draft behind.
  const failing = await makeCandidate("Bartholomew Achebe-Lund");
  await page.goto(`/candidates/${failing.id}/screening`);
  await page.getByRole("button", { name: "Add meeting note or transcript" }).click();
  await page.getByLabel("Transcript or notes").fill(`${CALL}\nSTUB_DOWN`);
  await page.getByLabel(/Don.t keep the transcript in Capture/).check();
  await page.getByRole("button", { name: "Summarise" }).click();
  await expect(page.locator('[data-form-message="error"]')).toContainText("Nothing was kept");
  expect(await db.screening.count({ where: { candidateId: failing.id } })).toBe(0);
});

test("S12 the box folds away keeping what is in it, and what is in it can be summarised later", async ({ page }) => {
  const candidate = await makeCandidate("Fausto Artico-Brennan");
  await page.goto(`/candidates/${candidate.id}/screening`);
  await page.getByRole("button", { name: "Add meeting note or transcript" }).click();
  const box = page.getByLabel("Transcript or notes");
  await box.fill("Spoke for ten minutes. Open to hybrid in Leeds, four weeks notice.");
  await page.getByRole("button", { name: "Fold away" }).click();
  await expect(box).toBeHidden();
  const reopen = page.getByRole("button", { name: /Show your note \(\d+ characters\)/ });
  await expect(reopen).toBeFocused();
  await reopen.click();
  await expect(box).toHaveValue("Spoke for ten minutes. Open to hybrid in Leeds, four weeks notice.");
  // Folded away, it is still what Summarise sends.
  await page.getByRole("button", { name: "Fold away" }).click();
  await page.getByRole("button", { name: "Summarise" }).click();
  await expect(page.getByRole("heading", { name: "Check the four facts" })).toBeVisible();
  expect((await db.screening.findFirstOrThrow({ where: { candidateId: candidate.id } })).transcript).toMatch(/four weeks notice/);
});
