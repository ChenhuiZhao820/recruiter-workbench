import { test, expect } from "@playwright/test";
import { db, TEST_ADMIN_ID } from "./helpers";
import { hashToken } from "../lib/auth-crypto";

// Export: the whole of the recruiter's own data, nobody else's, no secrets,
// and never from a read-only Admin view of someone else's workspace.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
let roleId = "";

test.beforeAll(async () => {
  roleId = (await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Export Test Role", client: "Fenwick Atelier" } })).id;
  const person = await db.person.create({
    data: { userId: TEST_ADMIN_ID, fullName: "Saoirse Pemberton-Ade", profileUrl: "https://www.linkedin.com/in/saoirse-pa", headline: "=HYPERLINK(\"x\") Lead", searchText: "saoirse", salaryMin: 72000, salaryCurrency: "GBP" },
  });
  await db.candidate.create({ data: { roleId, fullName: "Saoirse Pemberton-Ade", personId: person.id, notes: "Prefers mornings" } });
  await db.suppression.create({ data: { userId: TEST_ADMIN_ID, keyHash: "f".repeat(64) } });
  await db.settings.update({ where: { userId: TEST_ADMIN_ID }, data: { captureTokenHash: hashToken("export-test-capture-token-aaaaaaaaaa") } });
  const other = await db.user.create({ data: { email: "export-other@test.capture.invalid", name: "Export Other", role: "recruiter", settings: { create: {} } } });
  const otherRole = await db.role.create({ data: { userId: other.id, title: "Someone Else's Role" } });
  await db.person.create({ data: { userId: other.id, fullName: "Not Yours Whitcombe", searchText: "not yours" } });
  await db.candidate.create({ data: { roleId: otherRole.id, fullName: "Not Yours Whitcombe" } });
});

test("X1 JSON export holds this account's records and none of its secrets or anyone else's", async ({ request }) => {
  const response = await request.get(`${BASE}/api/export?format=json`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["content-disposition"]).toContain("attachment");
  const text = await response.text();
  const data = JSON.parse(text);
  expect(data.people.some((row: { fullName: string }) => row.fullName === "Saoirse Pemberton-Ade")).toBe(true);
  expect(data.candidates.some((row: { notes: string | null }) => row.notes === "Prefers mornings")).toBe(true);
  expect(data.roles.some((row: { title: string }) => row.title === "Export Test Role")).toBe(true);
  expect(text).not.toContain("Not Yours Whitcombe");
  expect(text).not.toContain("Someone Else's Role");
  for (const secret of ["captureTokenHash", "keyHash", "passwordHash", "tokenCipher", "f".repeat(64)]) expect(text).not.toContain(secret);
});

test("X2 CSV export is per table and cannot smuggle a formula into a spreadsheet", async ({ request }) => {
  const response = await request.get(`${BASE}/api/export?format=csv&table=people`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv");
  const text = await response.text();
  expect(text).toContain("fullName");
  expect(text).toContain("Saoirse Pemberton-Ade");
  expect(text).toContain("\"'=HYPERLINK(\"\"x\"\") Lead\"");
  expect((await request.get(`${BASE}/api/export?format=csv&table=sessions`)).status()).toBe(400);
  expect((await request.get(`${BASE}/api/export?format=xml`)).status()).toBe(400);
});

test("X3 the export is offered in Settings and refused to a signed-out browser", async ({ page, browser }) => {
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Your data" });
  await expect(section.getByRole("link", { name: "Download everything (JSON)" })).toHaveAttribute("href", "/api/export?format=json");
  await expect(section.getByRole("link", { name: "People" })).toHaveAttribute("href", "/api/export?format=csv&table=people");
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const response = await anonymous.request.get(`${BASE}/api/export?format=json`);
  expect(response.status()).toBe(401);
  await anonymous.close();
});

test("X4 a read-only Admin view of another workspace cannot export it", async ({ page, request }) => {
  const other = await db.user.findUniqueOrThrow({ where: { email: "export-other@test.capture.invalid" } });
  const token = process.env.CAPTURE_TEST_SESSION_TOKEN!;
  await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: other.id } });
  try {
    const response = await request.get(`${BASE}/api/export?format=json`);
    expect(response.status()).toBe(403);
    expect(await response.text()).not.toContain("Not Yours Whitcombe");
    await page.goto("/settings");
    await expect(page.getByText("Exports are only available from your own workspace.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download everything (JSON)" })).toHaveCount(0);
    // People pages and erasure follow the same rule.
    const foreign = await db.person.findFirstOrThrow({ where: { userId: other.id } });
    await page.goto(`/people/${foreign.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Not Yours Whitcombe" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Erase this person" })).toHaveCount(0);
  } finally {
    await db.session.update({ where: { tokenHash: hashToken(token) }, data: { viewUserId: null } });
  }
});
