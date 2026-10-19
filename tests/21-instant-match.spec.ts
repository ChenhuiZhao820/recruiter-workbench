import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db, TEST_ADMIN_ID } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";

// Instant Match: a brief read once by the local stub, the criteria shown as
// chips, matching over the account's own people, and every way out of a
// disappointing match. Fictional people and the disposable test database only.
// Skill words are invented and unique to this spec, because other specs add
// people to the same test account.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const STUB = "http://localhost:8766";
const BRIEF = [
  "TITLE: Zephyr Platform Engineer",
  "MUST: zephlang",
  "NICE: quorvex, brindleql",
  "SALARY: 80000",
  "RTW: yes",
  "UNCHECKED: a fintech background",
].join("\n");

type Facts = { skills: string; salaryMin?: number | null; rightToWork?: string | null; headline?: string; doNotContact?: boolean };

async function person(fullName: string, facts: Facts, userId = TEST_ADMIN_ID) {
  const headline = facts.headline ?? "Platform Engineer";
  return db.person.create({ data: {
    userId, fullName, headline, profileUrl: `https://www.linkedin.com/in/test-${randomUUID()}`,
    salaryMin: facts.salaryMin ?? null, salaryCurrency: facts.salaryMin ? "GBP" : null,
    rightToWork: facts.rightToWork ?? null, factsConfirmedAt: facts.salaryMin || facts.rightToWork ? new Date() : null,
    skillsSummary: facts.skills, doNotContact: Boolean(facts.doNotContact),
    searchText: `${fullName} ${headline} ${facts.skills}`.toLowerCase(),
  } });
}

async function readBrief(page: Page, brief = BRIEF) {
  await page.goto("/people");
  const box = page.getByLabel("Paste a job description, or describe who you need");
  await expect(box).toBeEnabled();
  await box.fill(brief);
  await page.getByRole("button", { name: "Find matches" }).click();
}

const matchCount = (page: Page) => page.locator("#results-heading span");
const rowFor = (page: Page, name: string) => page.locator(".im-row", { hasText: name });

async function userPage(browser: Browser, tier: "basic" | "pro") {
  const user = await db.user.create({ data: { email: `match-${tier}-${randomUUID()}@test.capture.invalid`, name: `${tier} Recruiter`, role: "recruiter", accountTier: tier, settings: { create: { seenRelease: CURRENT_RELEASE } } } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  return { user, page: await context.newPage(), close: () => context.close() };
}

test.beforeAll(async () => {
  await person("Ottoline Brack", { skills: "zephlang quorvex", salaryMin: 75000, rightToWork: "has_right" });
  await person("Perpetua Vane", { skills: "zephlang", salaryMin: 70000, rightToWork: "has_right" });
  await person("Quentin Marlowe", { skills: "zephlang quorvex", salaryMin: 90000, rightToWork: "has_right" });
  await person("Rosamund Teague", { skills: "zephlang", rightToWork: "has_right" });
  await person("Silas Ormond", { skills: "quorvex brindleql", salaryMin: 70000, rightToWork: "has_right" });
  await person("Tobias Fenwick", { skills: "zephlang", salaryMin: 60000, rightToWork: "needs_sponsorship" });
  await person("Ulrich Dorne", { skills: "zephlang quorvex brindleql", salaryMin: 60000, rightToWork: "has_right", doNotContact: true });
});

test("IM1 a brief becomes chips, people and one-thing-off, and only the brief goes to the model", async ({ page }) => {
  const before = await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "match_brief_read" } });
  // People opens in Match for a Pro account: no extra page, no extra click.
  await page.goto("/people");
  await expect(page.getByRole("button", { name: "Match", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find matches" })).toBeDisabled();
  await readBrief(page);
  await expect(page).toHaveURL(/\/people\?c=/);

  await expect(page.getByRole("heading", { name: "Zephyr Platform Engineer" })).toBeVisible();
  await expect(page).toHaveURL(/\?c=[A-Za-z0-9_-]+$/);
  await expect(page.getByRole("button", { name: "zephlang: make it a nice-to-have" })).toBeVisible();
  await expect(page.getByRole("button", { name: "quorvex: make it a must-have" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Salary up to £80k/ })).toBeVisible();
  await expect(page.locator(".im-unchecked")).toContainText("Check these yourself: a fintech background");

  await expect(matchCount(page)).toHaveText("2");
  await expect(page.locator('ul[aria-label="Matches"] .person-row-name')).toHaveText(["Ottoline Brack", "Perpetua Vane"]);
  const near = page.locator('ul[aria-label="One thing off"]');
  await expect(near.locator(".im-row")).toHaveCount(4);
  await expect(rowFor(page, "Quentin Marlowe").locator(".im-miss")).toHaveText("Expects £90k");
  await expect(rowFor(page, "Rosamund Teague").locator(".im-miss")).toHaveText("Salary not confirmed");
  await expect(rowFor(page, "Silas Ormond").locator(".im-miss")).toHaveText("No zephlang on record");
  await expect(rowFor(page, "Tobias Fenwick").locator(".im-miss")).toHaveText("Needs sponsorship");
  await expect(page.getByText("Ulrich Dorne")).toHaveCount(0);

  const sent = await (await fetch(`${STUB}/__last-match`)).json();
  expect(sent.model).toBe("claude-haiku-5-5");
  expect(sent.effort).toBe("low");
  expect(sent.text).toContain("<brief>");
  for (const name of ["Ottoline", "Perpetua", "Quentin", "Rosamund", "Silas", "Tobias"]) expect(sent.text).not.toContain(name);
  expect(await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "match_brief_read" } })).toBe(before + 1);
});

test("IM2 loosening says how many it brings in, brings in exactly that many, and undoes", async ({ page }) => {
  await readBrief(page);
  await expect(matchCount(page)).toHaveText("2");
  await expect(page.getByText("Only 2 people meet every requirement.")).toBeVisible();
  const raise = page.getByRole("button", { name: /Raise the salary limit to £90k/ });
  await expect(raise.locator(".im-gain")).toHaveText("+1");
  await raise.click();
  await expect(matchCount(page)).toHaveText("3");
  await expect(page.getByRole("status").filter({ hasText: "+1 match" })).toContainText("Raise the salary limit to £90k");
  await expect(page.getByRole("button", { name: /Salary up to £90k/ })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(matchCount(page)).toHaveText("2");
  await expect(page.getByRole("button", { name: /Salary up to £80k/ })).toBeVisible();

  await page.getByRole("button", { name: /Include people whose salary is not confirmed/ }).click();
  await expect(matchCount(page)).toHaveText("3");
  await expect(page.getByRole("button", { name: /Salary up to £80k/ })).toContainText("+ unconfirmed");
  expect(await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "match_loosened" } })).toBeGreaterThan(0);
});

test("IM3 chips change the match: move, remove, add and edit a requirement, with Back as undo", async ({ page }) => {
  await readBrief(page);
  await page.getByRole("button", { name: "zephlang: make it a nice-to-have" }).click();
  await expect(page.getByRole("button", { name: "zephlang: make it a must-have" })).toBeVisible();
  await expect(rowFor(page, "Silas Ormond").locator(".im-miss")).toHaveCount(0);
  await expect(matchCount(page)).toHaveText("3");
  await page.goBack();
  await expect(matchCount(page)).toHaveText("2");

  await page.getByRole("button", { name: "Remove brindleql" }).click();
  await expect(page.getByRole("button", { name: "brindleql: make it a must-have" })).toHaveCount(0);

  await page.getByRole("button", { name: "Add a must-have" }).click();
  await page.getByPlaceholder("Add a must-have").fill("quorvex");
  await page.getByPlaceholder("Add a must-have").press("Enter");
  await expect(page.getByRole("button", { name: "quorvex: make it a nice-to-have" })).toBeVisible();
  await expect(matchCount(page)).toHaveText("1");

  await page.getByRole("button", { name: /Salary up to £80k/ }).click();
  await page.getByLabel("Up to, a year").fill("95k");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("button", { name: /Salary up to £95k/ })).toBeVisible();
  await expect(matchCount(page)).toHaveText("2");

  await page.getByRole("button", { name: /Salary up to £95k/ }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("button", { name: /Salary up to/ })).toHaveCount(0);
});

test("IM4 not a fit sets the person aside and the reason takes people like them too", async ({ page }) => {
  await readBrief(page);
  await rowFor(page, "Ottoline Brack").getByRole("button", { name: "Not a fit" }).click();
  await page.getByRole("dialog", { name: "Why Ottoline Brack is not a fit" }).getByRole("button", { name: "Too expensive" }).click();
  await expect(page).toHaveURL(/[?&]x=/);
  await expect(rowFor(page, "Ottoline Brack")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Salary up to £74k/ })).toBeVisible();
  await expect(page.locator('ul[aria-label="Matches"] .person-row-name')).toHaveText(["Perpetua Vane"]);
  await expect(page.getByText("1 set aside as not a fit.")).toBeVisible();
  await page.getByRole("button", { name: "Show them again" }).click();
  await expect(rowFor(page, "Ottoline Brack")).toHaveCount(1);
  expect(await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "match_not_fit", value: 2 } })).toBeGreaterThan(0);
});

test("IM5 adjusting in words sends only the criteria and the sentence, and says what changed", async ({ page }) => {
  await readBrief(page);
  const before = await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "match_adjusted" } });
  await page.getByLabel("Adjust the criteria in your own words").fill("MUST: brindleql");
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "brindleql is now a must-have" })).toBeVisible();
  await expect(page.getByRole("button", { name: "brindleql: make it a nice-to-have" })).toBeVisible();
  await expect(matchCount(page)).toHaveText("0");
  const sent = await (await fetch(`${STUB}/__last-match`)).json();
  expect(sent.text).toContain("<current_criteria>");
  expect(sent.text).toContain("<instruction>\nMUST: brindleql\n</instruction>");
  for (const name of ["Ottoline", "Perpetua", "Silas"]) expect(sent.text).not.toContain(name);
  expect(await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "match_adjusted" } })).toBe(before + 1);
});

test("IM6 criteria join a role's briefing only when saved there, with the budget only if ticked", async ({ page }) => {
  const role = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Instant Match Role", jobDesc: "TITLE: Zephyr Platform Engineer\nMUST: zephlang" } });
  await readBrief(page);
  expect(await db.briefing.count({ where: { roleId: role.id } })).toBe(0);

  await page.getByRole("button", { name: "Save to a role" }).click();
  const dialog = page.getByRole("dialog", { name: "Save to a role’s briefing" });
  await dialog.getByRole("combobox").selectOption(role.id);
  await expect(dialog).toContainText("Adds 3 key skills: zephlang, quorvex, brindleql");
  await expect(dialog.getByLabel(/Set the role’s budget to up to £80k/)).toBeChecked();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.locator('[data-form-message="notice"]')).toHaveText("Saved to Instant Match Role: 3 key skills, 1 title and a budget up to £80k.");

  const briefing = await db.briefing.findUniqueOrThrow({ where: { roleId: role.id } });
  expect(JSON.parse(briefing.keySkills).map((item: { skill: string }) => item.skill)).toEqual(["zephlang", "quorvex", "brindleql"]);
  expect(JSON.parse(briefing.searchTitles)).toEqual(["Zephyr Platform Engineer"]);
  expect((await db.role.findUniqueOrThrow({ where: { id: role.id } })).budgetMax).toBe(80000);

  await page.goto(`/roles/${role.id}`);
  await expect(page.getByText("What they do all day")).toHaveCount(0);
  await page.getByText(/From your database/).click();
  await page.getByRole("link", { name: "Match this role on People" }).click();
  await expect(page).toHaveURL(/\/people\?role=/);
  await expect(page.getByLabel("Paste a job description, or describe who you need")).toHaveValue(/MUST: zephlang/);
});

test("IM7 a match is added to a role from its row, and the search can go to LinkedIn or Searches", async ({ page }) => {
  const role = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Zephyr Adds" } });
  await readBrief(page);
  await rowFor(page, "Perpetua Vane").getByRole("button", { name: "Add to role" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Perpetua Vane to a role" });
  await dialog.getByLabel("To the role").selectOption(role.id);
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog.locator('[data-form-message="notice"]')).toContainText("added to this role as sourced");
  expect(await db.candidate.count({ where: { roleId: role.id, fullName: "Perpetua Vane", stage: "sourced" } })).toBe(1);

  const open = page.getByRole("link", { name: "Open LinkedIn search" });
  const href = new URL((await open.getAttribute("href"))!);
  expect(href.origin + href.pathname).toBe("https://www.linkedin.com/search/results/people/");
  expect(href.searchParams.get("keywords")).toBe('"Zephyr Platform Engineer" AND zephlang');
  expect(await open.getAttribute("target")).toBe("_blank");
  await expect(page.locator(".im-query")).toHaveText('"Zephyr Platform Engineer" AND zephlang');

  await page.getByRole("button", { name: "Save as a search" }).click();
  const save = page.getByRole("dialog", { name: "Save as a search" });
  await save.getByLabel("For the role (optional)").selectOption(role.id);
  await save.getByRole("button", { name: "Save" }).click();
  await expect(save.locator('[data-form-message="notice"]')).toContainText("Saved as “Zephyr Platform Engineer search”");
  const search = await db.savedSearch.findFirstOrThrow({ where: { roleId: role.id } });
  expect(search.keywords).toBe('"Zephyr Platform Engineer" AND zephlang');
  expect(search.filterNotes).toContain("Check by hand: a fintech background");
  expect(search.searchUrl).toBeNull();
});

test("IM8 a refused, failed, capped or forged request says so and charges nothing", async ({ page }) => {
  await page.goto("/people");
  const box = page.getByLabel("Paste a job description, or describe who you need");
  await box.fill("too short");
  await expect(page.getByRole("button", { name: "Find matches" })).toBeDisabled();

  const before = await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "match_brief_read" } });
  await readBrief(page, "TITLE: Anything at all here\nSTUB_REFUSE");
  await expect(page.locator(".im-error")).toHaveText(/Retrivr could not read that brief/);
  await readBrief(page, "TITLE: Anything at all here\nSTUB_DOWN");
  await expect(page.locator(".im-error")).toHaveText(/The matching service could not be reached/, { timeout: 30_000 });
  expect(await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "match_brief_read" } })).toBe(before);

  const forged = await page.request.post("/api/match/criteria", { headers: { origin: "https://evil.example" }, data: { brief: BRIEF } });
  expect(forged.status()).toBe(403);

  const used = await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: { in: ["match_brief_read", "match_adjusted"] } } });
  const filler = Array.from({ length: Math.max(0, 300 - used) }, () => ({ userId: TEST_ADMIN_ID, kind: "match_brief_read" }));
  await db.usageEvent.createMany({ data: filler });
  try {
    await page.goto("/people/match");
    await expect(page.getByText("You have used this month’s briefs.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Find matches" })).toBeDisabled();
    const capped = await page.request.post("/api/match/criteria", { headers: { origin: BASE }, data: { brief: BRIEF } });
    expect(capped.status()).toBe(429);
    expect((await capped.json()).error).toContain("It resets on");
  } finally {
    const ids = (await db.usageEvent.findMany({ where: { userId: TEST_ADMIN_ID, kind: "match_brief_read" }, orderBy: { at: "desc" }, take: filler.length, select: { id: true } })).map((row) => row.id);
    await db.usageEvent.deleteMany({ where: { id: { in: ids } } });
  }

  // Old links to the Instant Match page land on People with the same state.
  await page.goto("/people/match?c=not-criteria");
  await expect(page).toHaveURL(/\/people\?c=not-criteria$/);
  await expect(page.getByRole("button", { name: "Find matches" })).toBeVisible();
});

test("IM9 Basic accounts do not get Instant Match at all", async ({ browser }) => {
  const basic = await userPage(browser, "basic");
  try {
    await basic.page.goto("/people");
    await expect(basic.page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
    // Search only: no mode to choose, no brief box, no filters.
    await expect(basic.page.getByRole("combobox", { name: "Search people by name" })).toBeVisible();
    await expect(basic.page.getByRole("button", { name: "Match", exact: true })).toHaveCount(0);
    await expect(basic.page.getByLabel("Paste a job description, or describe who you need")).toHaveCount(0);
    await expect(basic.page.getByRole("group", { name: "Filters" })).toHaveCount(0);
    const response = await basic.page.goto("/people/match");
    expect(response?.status()).toBe(404);
    const api = await basic.page.request.post("/api/match/criteria", { headers: { origin: BASE }, data: { brief: BRIEF } });
    expect(api.status()).toBe(404);
    const event = await basic.page.request.post("/api/match/event", { headers: { origin: BASE }, data: { kind: "match_handoff" } });
    expect(event.status()).toBe(404);
    expect(await db.usageEvent.count({ where: { userId: basic.user.id } })).toBe(0);
  } finally {
    await basic.close();
  }
});

test("IM10 a read-only view shows the match but reads no brief and changes nothing", async ({ page, browser }) => {
  const pro = await userPage(browser, "pro");
  await pro.close();
  await person("Viola Readonly", { skills: "zephlang", salaryMin: 60000, rightToWork: "has_right" }, pro.user.id);
  await readBrief(page);
  await expect(page).toHaveURL(/\?c=/);
  const url = page.url();
  await db.session.updateMany({ where: { userId: TEST_ADMIN_ID }, data: { viewUserId: pro.user.id } });
  try {
    await page.goto(url);
    await expect(page.locator('ul[aria-label="Matches"] .person-row-name')).toHaveText(["Viola Readonly"]);
    await expect(rowFor(page, "Viola Readonly").getByRole("button", { name: "Add to role" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save to a role" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save as a search" })).toBeDisabled();
    await expect(page.getByLabel("Adjust the criteria in your own words")).toBeDisabled();
    await expect(page.getByLabel("Paste a job description, or describe who you need")).toBeDisabled();
    await page.goto("/people");
    // Without a match on screen a read-only view starts in Search.
    await expect(page.getByRole("combobox", { name: "Search people" })).toBeVisible();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("menuitemradio", { name: /^Match/ }).click();
    await expect(page.getByText("This is a read-only view.")).toBeVisible();
    const api = await page.request.post("/api/match/criteria", { headers: { origin: BASE }, data: { brief: BRIEF } });
    expect(api.status()).toBe(403);
    expect(await db.usageEvent.count({ where: { userId: pro.user.id } })).toBe(0);
  } finally {
    await db.session.updateMany({ where: { userId: TEST_ADMIN_ID }, data: { viewUserId: null } });
  }
});

test("IM11 Instant Match fits a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await readBrief(page);
  await expect(matchCount(page)).toHaveText("2");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await rowFor(page, "Ottoline Brack").getByRole("button", { name: "Not a fit" }).click();
  const sheet = page.getByRole("dialog", { name: "Why Ottoline Brack is not a fit" });
  const box = await sheet.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});

test("IM12 a long paste in Search switches to Match and reads nothing until Enter; a role starts a match in one click", async ({ page }) => {
  const before = await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "match_brief_read" } });
  await page.goto("/people");
  await page.getByRole("button", { name: "Match", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /^Search/ }).click();
  const search = page.getByRole("combobox", { name: "Search people" });
  await search.focus();
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.querySelector("#people-search")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, BRIEF);
  const box = page.getByLabel("Paste a job description, or describe who you need");
  await expect(box).toHaveValue(BRIEF);
  await expect(page.getByText("That looks like a job description, so the box switched to Match.")).toBeVisible();
  expect(await db.usageEvent.count({ where: { userId: TEST_ADMIN_ID, kind: "match_brief_read" } })).toBe(before);

  // A short paste stays a search.
  await page.getByRole("button", { name: "search instead" }).click();
  await expect(search).toHaveValue("");
  await search.focus();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "zephlang");
    document.querySelector("#people-search")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(box).toHaveCount(0);

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /^Match/ }).click();
  // Choosing Search did not throw the brief away.
  await expect(box).toHaveValue(BRIEF);
  await box.fill("");
  await box.press("Enter");
  await expect(page.locator(".im-error")).toHaveText(/Paste the job description/);

  const role = await db.role.create({ data: { userId: TEST_ADMIN_ID, title: "Zephyr Quick Start", jobDesc: "TITLE: Zephyr Quick Start\nMUST: zephlang\nNICE: quorvex" } });
  await page.goto("/people");
  await page.getByRole("group", { name: "Match from a role" }).getByRole("button", { name: "Match Zephyr Quick Start" }).click();
  await expect(page).toHaveURL(`${BASE}/people?role=${role.id}`);
  await expect(box).toHaveValue(/^Zephyr Quick Start\n\nTITLE: Zephyr Quick Start\nMUST: zephlang/);
  await box.press("Enter");
  await expect(page.getByRole("heading", { name: "Zephyr Quick Start" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Requirements" })).toBeVisible();
});
