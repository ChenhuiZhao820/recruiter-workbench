import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";
import { newNonce, shortlistToken } from "../lib/shortlist-core.mjs";

// CVs on client pages: a client reads the CV where there is one and the
// confirmed facts where there is not, never the LinkedIn profile. An upload
// cannot skip the contact-details check, a replaced CV reaches an open link at
// once, and putting someone without a CV forward asks first. A fresh account
// of its own; fictional people only; the client has no session.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const SECRET = "test-only-shortlist-link-secret-00000000";
const DAY = 86_400_000;
const PDF_A = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% first version\n%%EOF\n");
const PDF_B = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% second version\n%%EOF\n");
let userId = "";
let roleId = "";
let link = "";

async function recruiter(browser: Browser, viewUserId?: string) {
  const actor = viewUserId ? await db.user.findFirstOrThrow({ where: { role: "admin" } }) : await db.user.findUniqueOrThrow({ where: { id: userId } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId: actor.id, authVersion: actor.authVersion, viewUserId: viewUserId ?? null, expiresAt: new Date(Date.now() + 3_600_000) } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  return { page: await context.newPage(), close: () => context.close() };
}

async function guest(browser: Browser) {
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  return { page: await context.newPage(), close: () => context.close() };
}

// A screened candidate on the role, with confirmed facts and a LinkedIn
// address, who agreed to be put forward to this client.
async function candidateOn(fullName: string) {
  const person = await db.person.create({ data: {
    userId, fullName, headline: `${fullName.split(" ")[0]} - Product designer`, searchText: fullName.toLowerCase(),
    profileUrl: `https://www.linkedin.com/in/cv-test-${randomUUID()}`,
    salaryMin: 70000, salaryMax: 80000, salaryCurrency: "GBP", noticeWeeks: 8, location: "Leeds", remotePreference: "hybrid",
    rightToWork: "has_right", skillsSummary: "Figma, research", factsConfirmedAt: new Date(Date.now() - DAY),
  } });
  const candidate = await db.candidate.create({ data: { roleId, fullName, personId: person.id, stage: "screened" } });
  await db.screening.create({ data: { candidateId: candidate.id, status: "confirmed", transcriptSource: "paste", confirmedAt: new Date(), representConsentAt: new Date(Date.now() - DAY) } });
  return { person, candidate };
}

async function uploadOn(page: Page, prefix: string, file: Buffer, name = "Designer CV.pdf") {
  await page.locator(`#${prefix}-file`).setInputFiles({ name, mimeType: "application/pdf", buffer: file });
  await page.locator(`#${prefix}-contacts`).check();
  await page.getByRole("button", { name: /Upload CV|Replace CV|Upload and continue/ }).click();
}

test.beforeAll(async () => {
  userId = (await db.user.create({ data: {
    email: `cv-${randomUUID()}@test.capture.invalid`, name: "CV Recruiter", role: "recruiter", accountTier: "basic",
    settings: { create: { seenRelease: CURRENT_RELEASE, recruiterName: "CV Recruiter" } },
  } })).id;
  roleId = (await db.role.create({ data: { userId, title: "CV Test Product Designer", client: "Larchwood Studio" } })).id;
  const shortlist = await db.shortlist.create({ data: {
    userId, kind: "role", roleId, title: "CV Test Product Designer", client: "Larchwood Studio", access: "link",
    accesses: { create: { nonce: newNonce() } },
  }, include: { accesses: true } });
  link = `/s/${shortlistToken(SECRET, shortlist.accesses[0].id, shortlist.accesses[0].nonce)}`;
});

test("V1 an upload cannot skip the contact-details check, in the page or around it", async ({ browser }, testInfo) => {
  const { person } = await candidateOn("Ottilie Brand");
  const me = await recruiter(browser);
  try {
    const page = me.page;
    await page.goto(`/people/${person.id}`);
    const section = page.getByRole("region", { name: "CV" });
    await expect(section.getByText("No CV yet.")).toBeVisible();
    await section.locator("#person-cv-file").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: PDF_A });
    const upload = section.getByRole("button", { name: "Upload CV" });
    // The notice sits between the file and the button, and the button waits for its tick.
    await expect(section.getByText(/The client sees this PDF exactly as it is/)).toBeVisible();
    await expect(upload).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("cv-upload.png"), fullPage: true });
    // Talked past in the browser, the server still refuses it.
    await upload.evaluate((button) => button.removeAttribute("disabled"));
    await section.locator("#person-cv-contacts").evaluate((box) => box.removeAttribute("required"));
    await upload.click();
    await expect(section.locator('[data-form-message="error"]')).toContainText("Tick that you have dealt with the contact details");
    expect(await db.personCv.count({ where: { personId: person.id } })).toBe(0);
    // A file that is not a PDF is refused too.
    await section.locator("#person-cv-file").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("PK\u0003\u0004 not a pdf") });
    await section.locator("#person-cv-contacts").check();
    await upload.click();
    await expect(section.locator('[data-form-message="error"]')).toContainText("The CV must be a PDF");
    await uploadOn(page, "person-cv", PDF_A, "Ottilie Brand CV.pdf");
    await expect(section.getByRole("link", { name: "Ottilie Brand CV.pdf" })).toBeVisible();
    const cv = await db.personCv.findUniqueOrThrow({ where: { personId: person.id } });
    expect(Buffer.from(cv.data).equals(PDF_A)).toBe(true);
    expect(cv.contactsCheckedAt).not.toBeNull();
    // The recruiter can open their own copy.
    const own = await page.request.get(`/api/people/${person.id}/cv`);
    expect(own.headers()["content-type"]).toBe("application/pdf");
  } finally {
    await me.close();
  }
});

test("V2 the client reads the CV where there is one and the facts where there is not, never LinkedIn, and a replaced CV shows at once", async ({ browser }, testInfo) => {
  const ottilie = await db.person.findFirstOrThrow({ where: { userId, fullName: "Ottilie Brand" } });
  const withCv = await db.candidate.findFirstOrThrow({ where: { roleId, personId: ottilie.id } });
  const { person: noCv, candidate: noCvCandidate } = await candidateOn("Rafe Lindqvist");
  const shortlist = await db.shortlist.findUniqueOrThrow({ where: { roleId } });
  await db.shortlistItem.create({ data: { shortlistId: shortlist.id, personId: ottilie.id, candidateId: withCv.id, consentAt: new Date(), position: 0 } });
  await db.shortlistItem.create({ data: { shortlistId: shortlist.id, personId: noCv.id, candidateId: noCvCandidate.id, consentAt: new Date(), position: 1 } });

  const client = await guest(browser);
  try {
    await client.page.goto(link);
    const ottilieEntry = client.page.locator(".client-entry", { hasText: "Ottilie Brand" });
    const frame = ottilieEntry.locator("iframe.client-cv-frame");
    await expect(frame).toBeVisible();
    await expect(ottilieEntry.locator(".client-facts")).toHaveCount(0);
    const first = (await frame.getAttribute("src"))!;
    expect(first).toMatch(new RegExp(`^${link}/cv/[a-z0-9]+\\?v=\\d+$`));
    const served = await client.page.request.get(first);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("application/pdf");
    expect(served.headers()["cache-control"]).toContain("no-store");
    expect(served.headers()["x-frame-options"]).toBe("SAMEORIGIN");
    expect(Buffer.from(await served.body()).equals(PDF_A)).toBe(true);
    // Without a CV, the confirmed facts as before.
    const rafeEntry = client.page.locator(".client-entry", { hasText: "Rafe Lindqvist" });
    await expect(rafeEntry.locator("iframe")).toHaveCount(0);
    await expect(rafeEntry).toContainText("£70,000 to £80,000 a year");
    // Never a LinkedIn address, with or without a CV.
    expect(await client.page.content()).not.toContain("linkedin.com");
    await client.page.screenshot({ path: testInfo.outputPath("client-cv.png"), fullPage: true });

    // The recruiter replaces Ottilie's CV while the link is open; the client's next look has it.
    const me = await recruiter(browser);
    try {
      await me.page.goto(`/people/${ottilie.id}`);
      await me.page.getByRole("region", { name: "CV" }).getByText("Replace the CV").click();
      await uploadOn(me.page, "person-cv", PDF_B);
      await expect(me.page.getByRole("region", { name: "CV" }).locator('[data-form-message="notice"]')).toBeVisible();
    } finally {
      await me.close();
    }
    await client.page.reload();
    const second = (await client.page.locator(".client-entry", { hasText: "Ottilie Brand" }).locator("iframe.client-cv-frame").getAttribute("src"))!;
    expect(second).not.toBe(first);
    expect(Buffer.from(await (await client.page.request.get(second)).body()).equals(PDF_B)).toBe(true);
    // Even the old address now serves the new file: it is read live.
    expect(Buffer.from(await (await client.page.request.get(first)).body()).equals(PDF_B)).toBe(true);
  } finally {
    await client.close();
  }
});

test("V3 a CV is served only through a live link to someone still on it", async ({ browser }) => {
  const ottilie = await db.person.findFirstOrThrow({ where: { userId, fullName: "Ottilie Brand" } });
  const item = await db.shortlistItem.findFirstOrThrow({ where: { personId: ottilie.id, shortlist: { roleId } } });
  const rafeItem = await db.shortlistItem.findFirstOrThrow({ where: { person: { fullName: "Rafe Lindqvist", userId }, shortlist: { roleId } } });
  const client = await guest(browser);
  try {
    const ok = await client.page.request.get(`${link}/cv/${item.id}`);
    expect(ok.status()).toBe(200);
    // A forged token, someone with no CV, and an item from another page are not found.
    const forged = link.slice(0, -4) + "AAAA";
    expect((await client.page.request.get(`${forged}/cv/${item.id}`)).status()).toBe(404);
    expect((await client.page.request.get(`${link}/cv/${rafeItem.id}`)).status()).toBe(404);
    const other = await db.user.create({ data: { email: `cv-other-${randomUUID()}@test.capture.invalid`, name: "Other", role: "recruiter", settings: { create: { seenRelease: CURRENT_RELEASE } } } });
    const theirPerson = await db.person.create({ data: { userId: other.id, fullName: "Not Theirs", searchText: "not theirs" } });
    await db.personCv.create({ data: { personId: theirPerson.id, fileName: "x.pdf", sizeBytes: PDF_A.length, sha256: "x", data: PDF_A, contactsCheckedAt: new Date() } });
    const theirShortlist = await db.shortlist.create({ data: { userId: other.id, kind: "custom", title: "Theirs", client: "X", access: "link", expiresAt: new Date(Date.now() + DAY), items: { create: { personId: theirPerson.id, consentAt: new Date(), position: 0 } } }, include: { items: true } });
    expect((await client.page.request.get(`${link}/cv/${theirShortlist.items[0].id}`)).status()).toBe(404);
    // Someone rejected leaves the page, and their CV with them.
    await db.candidate.update({ where: { id: item.candidateId! }, data: { stage: "rejected" } });
    expect((await client.page.request.get(`${link}/cv/${item.id}`)).status()).toBe(404);
    await db.candidate.update({ where: { id: item.candidateId! }, data: { stage: "submitted" } });
    // A closed link serves nothing.
    await db.shortlistAccess.updateMany({ where: { shortlist: { roleId } }, data: { revokedAt: new Date() } });
    expect((await client.page.request.get(`${link}/cv/${item.id}`)).status()).toBe(404);
    await db.shortlistAccess.updateMany({ where: { shortlist: { roleId } }, data: { revokedAt: null } });
    // Deleting the CV puts the facts back.
    await db.personCv.delete({ where: { personId: ottilie.id } });
    await client.page.goto(link);
    await expect(client.page.locator(".client-entry", { hasText: "Ottilie Brand" })).toContainText("£70,000 to £80,000 a year");
  } finally {
    await client.close();
  }
});

test("V4 putting forward someone without a CV asks first: cancel, skip for now, or upload it there", async ({ browser }, testInfo) => {
  const { person: skip, candidate: skipCandidate } = await candidateOn("Juno Achterberg");
  const { person: upload, candidate: uploadCandidate } = await candidateOn("Pell Okonjo");
  const me = await recruiter(browser);
  try {
    const page = me.page;
    await page.goto(`/roles/${roleId}`);
    const juno = page.locator("li.card", { hasText: "Juno Achterberg" });
    await juno.getByRole("button", { name: "Put forward to Larchwood Studio" }).click();
    const dialog = page.getByRole("dialog", { name: "No CV for Juno yet" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Larchwood Studio will not see a CV for Juno Achterberg, only the details you confirmed.");
    await page.screenshot({ path: testInfo.outputPath("no-cv-dialog.png") });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await db.shortlistItem.count({ where: { personId: skip.id } })).toBe(0);

    await juno.getByRole("button", { name: "Put forward to Larchwood Studio" }).click();
    await page.getByRole("dialog", { name: "No CV for Juno yet" }).getByRole("button", { name: "Skip for now" }).click();
    await expect(juno.getByText("On the client link")).toBeVisible();
    expect((await db.shortlistItem.findFirstOrThrow({ where: { personId: skip.id } })).candidateId).toBe(skipCandidate.id);
    // The row keeps saying so until a CV arrives.
    await expect(juno.getByRole("link", { name: "No CV · Upload" })).toHaveAttribute("href", `/people/${skip.id}#cv-heading`);

    // Upload it there: the same contact-details check, then it goes ahead by itself.
    const pell = page.locator("li.card", { hasText: "Pell Okonjo" });
    await pell.getByRole("button", { name: "Put forward to Larchwood Studio" }).click();
    const second = page.getByRole("dialog", { name: "No CV for Pell yet" });
    await expect(second.getByRole("button", { name: "Upload and continue" })).toBeDisabled();
    await second.locator("#no-cv-upload-file").setInputFiles({ name: "Pell CV.pdf", mimeType: "application/pdf", buffer: PDF_A });
    await expect(second.getByRole("button", { name: "Upload and continue" })).toBeDisabled();
    await second.locator("#no-cv-upload-contacts").check();
    await second.getByRole("button", { name: "Upload and continue" }).click();
    await expect(pell.getByText("On the client link")).toBeVisible();
    await expect(pell.getByRole("link", { name: "No CV · Upload" })).toHaveCount(0);
    expect(await db.personCv.count({ where: { personId: upload.id } })).toBe(1);
    expect((await db.shortlistItem.findFirstOrThrow({ where: { personId: upload.id } })).candidateId).toBe(uploadCandidate.id);
  } finally {
    await me.close();
  }
});

test("V5 a new shortlist asks the same, and a read-only view can look at a CV but not change one", async ({ browser }) => {
  const juno = await db.person.findFirstOrThrow({ where: { userId, fullName: "Juno Achterberg" } });
  const me = await recruiter(browser);
  try {
    await me.page.goto(`/shortlists/new?client=Larchwood%20Studio&p=${juno.id}`);
    await expect(me.page.locator(".shortlist-chosen").getByText("No CV")).toBeVisible();
    await me.page.getByRole("button", { name: "Create shortlist" }).click();
    const dialog = me.page.getByRole("dialog", { name: "No CV for Juno yet" });
    await dialog.getByRole("button", { name: "Skip for now" }).click();
    await expect(me.page).toHaveURL(/\/shortlists\?open=/);
  } finally {
    await me.close();
  }
  const pell = await db.person.findFirstOrThrow({ where: { userId, fullName: "Pell Okonjo" } });
  const viewer = await recruiter(browser, userId);
  try {
    await viewer.page.goto(`/people/${pell.id}`);
    const section = viewer.page.getByRole("region", { name: "CV" });
    await expect(section.getByRole("link", { name: "Pell CV.pdf" })).toBeVisible();
    await expect(section.getByRole("button", { name: /Upload|Replace|Delete/ })).toHaveCount(0);
    expect((await viewer.page.request.get(`/api/people/${pell.id}/cv`)).status()).toBe(200);
  } finally {
    await viewer.close();
  }
});
