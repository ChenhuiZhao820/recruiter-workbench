import { test, expect } from "@playwright/test";

// People opens Import people and New shortlist as popups over the list, and the
// same addresses still work as full pages when visited directly.
test("PO1 Import people and New shortlist open as popups over People; closing returns to People", async ({ page }) => {
  await page.goto("/people");

  await page.getByRole("link", { name: "Import people" }).click();
  const importDialog = page.getByRole("dialog", { name: "Import people" });
  await expect(importDialog).toBeVisible();
  await expect(importDialog.getByRole("heading", { level: 1, name: "Import people" })).toBeVisible();
  await expect(page).toHaveURL(/\/people\/import$/);
  await page.getByRole("button", { name: "Close Import people" }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await page.getByRole("link", { name: "New shortlist" }).click();
  const shortlist = page.getByRole("dialog", { name: "New shortlist" });
  await expect(shortlist).toBeVisible();
  // A search inside the popup stays in the popup.
  await shortlist.getByLabel(/For which client/i).fill("Popup Client");
  await shortlist.getByLabel(/Find people by name/i).fill("a");
  await shortlist.getByRole("button", { name: "Find and update" }).click();
  await expect(page).toHaveURL(/\/shortlists\/new\?.*client=Popup\+Client/);
  await expect(page.getByRole("dialog", { name: "New shortlist" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("PO2 the same addresses are full pages when visited directly", async ({ page }) => {
  await page.goto("/people/import");
  await expect(page.getByRole("heading", { level: 1, name: "Import people" })).toBeVisible();
  await expect(page.locator("dialog")).toHaveCount(0);
  await page.goto("/shortlists/new");
  await expect(page.getByRole("heading", { level: 1, name: "New shortlist" })).toBeVisible();
  await expect(page.locator("dialog")).toHaveCount(0);
});

test("PO3 Match and Search are one sliding toggle, and People lists nobody until asked", async ({ page }) => {
  await page.goto("/people");
  const toggle = page.getByRole("radiogroup", { name: "Choose how to find people" });
  await expect(toggle.getByRole("radio", { name: "Match" })).toBeChecked();
  await toggle.getByRole("radio", { name: "Search" }).click();
  await expect(toggle.getByRole("radio", { name: "Search" })).toBeChecked();
  // Nothing under the box until there is a search or a match: no list, no note.
  await expect(page.getByRole("heading", { name: /All people|Matching people/ })).toHaveCount(0);
  await expect(page.locator(".person-row")).toHaveCount(0);
  await expect(page.getByText(/Only what you type here is sent/)).toHaveCount(0);
  await page.goto("/people?q=a");
  await expect(page.getByRole("heading", { name: /Matching people/ })).toBeVisible();
});
