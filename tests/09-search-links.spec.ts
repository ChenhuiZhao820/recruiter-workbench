import { test, expect } from "@playwright/test";
import { db, TEST_ADMIN_ID } from "./helpers";
import { searchLinkProblem, searchLinkUrl } from "../lib/linkedin";

// Industries and Recruiter's filters cannot be written into an address from
// out here, so a search the recruiter saved inside LinkedIn is reopened by its
// own address instead. These cover what may be stored, and that running a
// search opens exactly what was stored.

test.describe.configure({ mode: "serial" });

test.describe("what counts as a LinkedIn search address", () => {
  const accepted = [
    "https://www.linkedin.com/talent/search?searchContextId=abc-123&start=0",
    "https://www.linkedin.com/talent/hire/1234/discover/recruiterSearch?searchHistoryId=9",
    "https://www.linkedin.com/search/results/people/?keywords=ops&industry=%5B%2296%22%5D",
    // Country and language subdomains are real.
    "https://uk.linkedin.com/search/results/people/?keywords=ops",
  ];
  for (const url of accepted) {
    test(`accepts ${url.slice(0, 60)}`, () => {
      expect(searchLinkUrl(url)).toBe(new URL(url).toString());
      expect(searchLinkProblem(url)).toBeNull();
    });
  }

  const refused = [
    // Not a search: the product's front door, a profile, the feed.
    "https://www.linkedin.com/talent",
    "https://www.linkedin.com/in/someone",
    "https://www.linkedin.com/feed/",
    // Not LinkedIn, however much it looks like it.
    "https://linkedin.com.example.invalid/talent/search",
    "https://notlinkedin.com/talent/search",
    // Not a page at all.
    "javascript:alert(1)",
    "http://www.linkedin.com/talent/search",
    "https://user:pass@www.linkedin.com/talent/search",
    "www.linkedin.com/talent/search",
    "not a url",
  ];
  for (const url of refused) {
    test(`refuses ${url.slice(0, 60)}`, () => {
      expect(searchLinkUrl(url)).toBe("");
      // Refused is said out loud, never silently dropped.
      expect(searchLinkProblem(url)).toContain("LinkedIn search address");
    });
  }

  test("no link is not a problem", () => {
    expect(searchLinkUrl("")).toBe("");
    expect(searchLinkUrl("   ")).toBe("");
    expect(searchLinkProblem("")).toBeNull();
    expect(searchLinkProblem("   ")).toBeNull();
  });
});

test.describe("a saved Recruiter search, end to end", () => {
  const RECRUITER = "https://www.linkedin.com/talent/search?searchContextId=test-context&start=0";

  test.beforeEach(async ({ page }) => {
    // Nothing leaves the machine: a popup to LinkedIn is answered locally.
    await page.context().route(
      (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
      (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>blocked</title>" })
    );
  });

  test("S1 a bad address is refused and nothing is saved", async ({ page }) => {
    await page.goto("/searches/new");
    await page.getByLabel("Name", { exact: true }).fill("Refused link search");
    await page.getByLabel(/Job titles/).fill("Operations Director");
    await page.getByLabel(/Saved LinkedIn search link/).fill("https://example.invalid/talent/search");
    await page.getByRole("button", { name: "Create search" }).click();

    await expect(page.locator("[data-form-message='error']")).toContainText("LinkedIn search address");
    expect(await db.savedSearch.count({ where: { name: "Refused link search", userId: TEST_ADMIN_ID } })).toBe(0);
  });

  test("S2 a saved search link is stored, reopened as-is and recorded as run", async ({ page }) => {
    await page.goto("/searches/new");
    await page.getByLabel("Name", { exact: true }).fill("Recruiter linked search");
    await page.getByLabel(/Job titles/).fill("Operations Director");
    await page.getByLabel(/Industries/).fill("Manufacturing, Logistics");
    await page.getByLabel(/Saved LinkedIn search link/).fill(RECRUITER);
    await page.getByRole("button", { name: "Create search" }).click();
    await page.waitForURL(/\/searches$/);

    const card = page.locator("li.card", { hasText: "Recruiter linked search" });
    // The industries are still recorded, but the card no longer pretends they
    // are a checklist to re-tick.
    await expect(card.getByText("Industry: Manufacturing")).toBeVisible();
    await expect(card.getByText(/the saved LinkedIn search is what applies them/i)).toBeVisible();

    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      card.getByRole("button", { name: "Open saved search" }).click(),
    ]);
    // Exactly what LinkedIn gave the recruiter, not a keyword search rebuilt
    // from the parts.
    expect(popup.url()).toBe(RECRUITER);
    await popup.close();

    const saved = await db.savedSearch.findFirst({ where: { name: "Recruiter linked search", userId: TEST_ADMIN_ID } });
    expect(saved?.searchUrl).toBe(RECRUITER);
    await expect(card.getByText("last run today")).toBeVisible({ timeout: 7_000 });
  });

  test("S3 clearing the link puts the keyword search back", async ({ page }) => {
    const saved = await db.savedSearch.findFirst({ where: { name: "Recruiter linked search", userId: TEST_ADMIN_ID } });
    await page.goto(`/searches/${saved!.id}/edit`);
    await expect(page.getByLabel(/Saved LinkedIn search link/)).toHaveValue(RECRUITER);
    await page.getByLabel(/Saved LinkedIn search link/).fill("");
    await page.getByRole("button", { name: "Save search" }).click();
    await page.waitForURL(/\/searches$/);

    const card = page.locator("li.card", { hasText: "Recruiter linked search" });
    await expect(card.getByText("Apply these filters in LinkedIn after it opens:")).toBeVisible();
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      card.getByRole("button", { name: "Run search" }).click(),
    ]);
    const url = new URL(popup.url());
    expect(url.pathname).toBe("/search/results/people/");
    expect(url.searchParams.get("keywords")).toBe("Operations Director");
    await popup.close();

    const after = await db.savedSearch.findUnique({ where: { id: saved!.id } });
    expect(after?.searchUrl).toBeNull();
  });

  test("S4 a copy carries the link", async ({ page }) => {
    const search = await db.savedSearch.findFirst({ where: { name: "Recruiter linked search", userId: TEST_ADMIN_ID } });
    await db.savedSearch.update({ where: { id: search!.id }, data: { searchUrl: RECRUITER } });
    await page.goto("/searches");
    const card = page.locator("li.card", { hasText: "Recruiter linked search" }).first();
    await card.getByRole("button", { name: "Copy" }).click();
    const copy = page.locator("li.card", { hasText: "Recruiter linked search (copy)" });
    await expect(copy.getByRole("button", { name: "Open saved search" })).toBeVisible();

    const copied = await db.savedSearch.findFirst({ where: { name: "Recruiter linked search (copy)", userId: TEST_ADMIN_ID } });
    expect(copied?.searchUrl).toBe(RECRUITER);
  });
});
