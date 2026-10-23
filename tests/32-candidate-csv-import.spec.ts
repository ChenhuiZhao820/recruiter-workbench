import { test, expect } from "@playwright/test";
import { db, TEST_ADMIN_ID } from "./helpers";

// A client's file arrives with its own columns. What we have no field for is
// left out; what we have that the file lacks stays empty.
test("CI1 a client's CSV is matched to name, link, headline and notes; the rest is left out and the gaps stay empty", async ({ page }) => {
  const role = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "CSV Import Role" } });
  await db.candidate.create({ data: { roleId: role.id, fullName: "Already Here", profileUrl: "https://www.linkedin.com/in/already-here" } });
  const csv = [
    "Candidate Name,LinkedIn,Job Title,Favourite Colour",
    "Marguerite Okonkwo-Hale,https://www.linkedin.com/in/marguerite-okonkwo,Head of Platform,teal",
    "Already Here,https://www.linkedin.com/in/already-here,Engineer,red",
    "Tobias Wren,,Data Lead,green",
    ",https://www.linkedin.com/in/nameless,Nobody,blue",
  ].join("\n");

  await page.goto(`/roles/${role.id}`);
  await page.getByRole("button", { name: "Import options" }).click();
  await page.getByRole("menuitem", { name: "Import from CSV" }).click();
  await page.getByLabel("CSV file").setInputFiles({ name: "client.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Import candidates" }).click();

  const result = page.locator('[data-form-message="notice"]');
  await expect(result).toContainText("Added 2 candidates.");
  await expect(result).toContainText("1 already on this role");
  await expect(result).toContainText("1 with no name");
  await expect(result).toContainText("Favourite Colour");

  const rows = await db.candidate.findMany({ where: { roleId: role.id }, orderBy: { fullName: "asc" } });
  expect(rows.map((c) => c.fullName)).toEqual(["Already Here", "Marguerite Okonkwo-Hale", "Tobias Wren"]);
  const marguerite = rows.find((c) => c.fullName.startsWith("Marguerite"))!;
  expect(marguerite).toMatchObject({ headline: "Head of Platform", stage: "sourced", notes: null });
  expect(marguerite.profileUrl).toContain("marguerite-okonkwo");
  // No profile link in their file: the field stays empty rather than guessed.
  expect(rows.find((c) => c.fullName === "Tobias Wren")).toMatchObject({ profileUrl: null, notes: null, headline: "Data Lead" });
  expect(JSON.stringify(rows)).not.toContain("teal");
  await expect(page.locator("li.candidate-row", { hasText: "Tobias Wren" })).toBeVisible();
});

test("CI2 a file with no name column adds nobody and says why", async ({ page }) => {
  const role = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "CSV No Names Role" } });
  await page.goto(`/roles/${role.id}`);
  await page.getByRole("button", { name: "Import options" }).click();
  await page.getByRole("menuitem", { name: "Import from CSV" }).click();
  await page.getByLabel("CSV file").setInputFiles({ name: "odd.csv", mimeType: "text/csv", buffer: Buffer.from("Colour,Shape\nteal,round\nred,square\n") });
  await page.getByRole("button", { name: "Import candidates" }).click();
  await expect(page.locator('[data-form-message="error"]')).toContainText("looks like a name");
  expect(await db.candidate.count({ where: { roleId: role.id } })).toBe(0);
});
