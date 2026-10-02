import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db, TEST_ADMIN_ID } from "./helpers";
import { hashToken } from "../lib/auth-crypto";

// Client email: available only after a confirmed screening the candidate
// agreed to be put forward from, built from the confirmed facts, opened in
// the recruiter's own email app or copied, never sent by Capture. Fictional
// people and the disposable test database only.

test.describe.configure({ mode: "serial" });

const DAY = 86_400_000;
const RECIPIENT = "hiring-lead@halden.example";
let roleId = "";

const fields = {
  salary: { value: { min: 85000, max: 95000, currency: "GBP", note: "Base only" }, not_discussed: false, confirmed: true },
  notice: { value: { weeks: 12, available_from: null, note: "Negotiable" }, not_discussed: false, confirmed: true },
  location: { value: { location: "Manchester", remote: "hybrid", note: null }, not_discussed: false, confirmed: true },
  right_to_work: { value: { status: "has_right", note: null }, not_discussed: false, confirmed: true },
};

async function screened(fullName: string, options: { consent?: boolean; status?: string; userId?: string; role?: string } = {}) {
  const userId = options.userId ?? TEST_ADMIN_ID;
  const person = await db.person.create({ data: {
    userId, fullName, profileUrl: `https://www.linkedin.com/in/test-${randomUUID()}`, searchText: fullName.toLowerCase(),
    skillsSummary: "Kubernetes, Terraform", motivation: "Wants a platform team that owns its roadmap.",
  } });
  const candidate = await db.candidate.create({ data: { roleId: options.role ?? roleId, fullName, personId: person.id, stage: "screened" } });
  const status = options.status ?? "confirmed";
  const screening = await db.screening.create({ data: {
    candidateId: candidate.id, status, transcriptSource: "paste",
    summaryJson: JSON.stringify({ version: 1, ai: { salary: {}, notice: {}, location: {}, right_to_work: {}, skills: [], concerns: [] }, fields }),
    confirmedAt: status === "confirmed" ? new Date(Date.now() - DAY) : null,
    representConsentAt: options.consent === false ? null : new Date(Date.now() - DAY),
  } });
  return { candidate, screening, person };
}

function emailSection(page: Page) {
  return page.getByRole("region", { name: "Email the client" });
}

test.beforeAll(async () => {
  roleId = (await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Client Email Test Platform Lead", client: "Halden Systems" } })).id;
  await db.settings.update({ where: { userId: TEST_ADMIN_ID }, data: { recruiterName: "Morven Ellis" } });
});

test("C1 a consented, confirmed screening becomes an email the recruiter opens in their own app, and marking it sent moves them to Submitted", async ({ page }) => {
  const { candidate, screening } = await screened("Imogen Achterberg");
  await page.goto(`/candidates/${candidate.id}/screening`);
  const section = emailSection(page);
  await expect(section.getByLabel("Subject")).toHaveValue("Client Email Test Platform Lead: Imogen Achterberg");
  const body = section.getByLabel("Email", { exact: true });
  await expect(body).toHaveValue(/I would like to put forward Imogen Achterberg for the Client Email Test Platform Lead role\. Imogen has agreed for me to share their details with Halden Systems\./);
  await expect(body).toHaveValue(/- Salary expectation: £85,000 to £95,000 a year \(Base only\)/);
  await expect(body).toHaveValue(/- Right to work: Has the right to work/);
  await expect(body).toHaveValue(/I have not verified them\.\n\nHappy to set up a conversation if you would like to take this further\.\n\nMorven Ellis$/);

  await section.getByLabel(/email address/).fill(RECIPIENT);
  await body.fill("Hi,\n\nShort and to the point.");
  const open = section.getByRole("link", { name: "Open in email" });
  await expect(open).toHaveAttribute("href", `mailto:${RECIPIENT}?subject=Client%20Email%20Test%20Platform%20Lead%3A%20Imogen%20Achterberg&body=Hi%2C%0D%0A%0D%0AShort%20and%20to%20the%20point.`);

  await section.getByRole("button", { name: "Mark as sent" }).click();
  await expect(section.getByText(/Marked as sent to the client on/)).toBeVisible();
  const after = await db.screening.findUniqueOrThrow({ where: { id: screening.id } });
  expect(after.clientEmailSentAt).not.toBeNull();
  expect((await db.candidate.findUniqueOrThrow({ where: { id: candidate.id } })).stage).toBe("submitted");
  expect(await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "client_email_sent" } })).toBe(1);

  // The recipient and the email are never stored anywhere.
  const everything = JSON.stringify(await Promise.all([
    db.screening.findMany(), db.auditEvent.findMany(), db.usageEvent.findMany(), db.outreachLog.findMany(), db.person.findMany(), db.candidate.findMany(),
  ]));
  expect(everything).not.toContain(RECIPIENT);
  expect(everything).not.toContain("Short and to the point");

  await page.goto(`/people/${candidate.personId}`);
  await expect(page.getByText(/sent to the client/)).toBeVisible();
});

test("C2 no email without a confirmed screening and the candidate's agreement, which can be recorded after the call", async ({ page }) => {
  const draft = await screened("Tobiah Rennick-Shaw", { status: "summarized" });
  await page.goto(`/candidates/${draft.candidate.id}/screening`);
  await expect(page.getByRole("heading", { name: "Check the four facts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Email the client" })).toHaveCount(0);

  const { candidate, screening } = await screened("Ewa Szczepanska", { consent: false });
  await page.goto(`/candidates/${candidate.id}/screening`);
  const section = emailSection(page);
  await expect(section.getByRole("button", { name: "Mark as sent" })).toHaveCount(0);
  await expect(section.getByLabel("Email", { exact: true })).toHaveCount(0);
  await section.getByRole("button", { name: "Record their agreement" }).click();
  await expect(section.locator('[data-form-message="error"]')).toContainText("Tick the box");
  await section.getByLabel("Ewa agreed to be put forward to Halden Systems").check();
  await section.getByRole("button", { name: "Record their agreement" }).click();
  await expect(section.getByLabel("Email", { exact: true })).toBeVisible();
  expect((await db.screening.findUniqueOrThrow({ where: { id: screening.id } })).representConsentAt).not.toBeNull();
});

test("C3 pasted text is cleaned where it lands, and the copy is exactly what the box shows", async ({ page }) => {
  const { candidate } = await screened("Callum O'Driscoll");
  await page.goto(`/candidates/${candidate.id}/screening`);
  const section = emailSection(page);
  const body = section.getByLabel("Email", { exact: true });
  await body.fill("");
  await body.focus();
  await page.evaluate(() => {
    const data = new DataTransfer();
    const nbsp = String.fromCharCode(0xa0);
    const zeroWidth = String.fromCharCode(0x200b);
    data.setData("text/plain", `Hi,${nbsp}${zeroWidth}\r\n${nbsp}\r\n\r\nSee${nbsp}below.  \r\n`);
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(body).toHaveValue("Hi,\n\nSee below.");
  await section.getByRole("button", { name: "Copy email" }).click();
  await expect(section.getByText("Email copied.")).toBeVisible();
  // The Windows clipboard hands text back with CRLF line endings.
  expect((await page.evaluate(() => navigator.clipboard.readText())).split("\r\n").join("\n")).toBe("Hi,\n\nSee below.");
});

test("C4 an email too long for a mailto: address opens with the subject and is copied for pasting", async ({ page }) => {
  const { candidate } = await screened("Saoirse Pemberton-Ade");
  await page.goto(`/candidates/${candidate.id}/screening`);
  const section = emailSection(page);
  const long = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} about this candidate's background and projects.`).join("\n");
  await section.getByLabel("Email", { exact: true }).fill(long);
  const open = section.getByRole("link", { name: "Open in email" });
  await expect(open).toHaveAttribute("href", "mailto:?subject=Client%20Email%20Test%20Platform%20Lead%3A%20Saoirse%20Pemberton-Ade");
  // Keep the test browser from following the mailto: link.
  await open.evaluate((link) => link.addEventListener("click", (event) => event.preventDefault()));
  await open.click();
  await expect(section.getByText(/Too long to open with the text in it/)).toBeVisible();
  expect((await page.evaluate(() => navigator.clipboard.readText())).split("\r\n").join("\n")).toBe(long);
});

test("C5 another account's screening is not found, and a read-only Admin view shows the email but cannot mark anything", async ({ page }) => {
  const other = await db.user.create({ data: { email: `client-email-${randomUUID()}@test.capture.invalid`, name: "Pro Recruiter", role: "recruiter", accountTier: "pro", settings: { create: {} } } });
  const role = await db.role.create({ data: { userId: other.id, title: "Other Role", client: "Orrin Labs" } });
  const { candidate } = await screened("Tamsin Okoro-Lindqvist", { userId: other.id, role: role.id });
  expect((await page.goto(`/candidates/${candidate.id}/screening`))?.status()).toBe(404);
  const token = process.env.CAPTURE_TEST_SESSION_TOKEN!;
  await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: other.id } });
  try {
    await page.goto(`/candidates/${candidate.id}/screening`);
    const section = emailSection(page);
    await expect(section.getByLabel("Email", { exact: true })).toBeDisabled();
    await expect(section.getByRole("button", { name: "Mark as sent" })).toBeDisabled();
    // Without an address it is no longer a link at all.
    await expect(section.getByRole("link", { name: "Open in email" })).toHaveCount(0);
    await expect(section.getByText("Open in email")).toHaveAttribute("aria-disabled", "true");
  } finally {
    await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: null } });
  }
});
