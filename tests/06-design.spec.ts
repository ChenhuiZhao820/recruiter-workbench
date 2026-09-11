import { test as base, expect, type BrowserContext, type BrowserContextOptions, type Locator, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./helpers";
import { hashPassword, hashToken } from "../lib/auth-crypto";

const BASE = "http://localhost:3100";
const PASSWORD = "TEST-ONLY-design-password-3100!";
const EMPTY_STATE = { cookies: [], origins: [] };
const HERO = /Good recruiting\.\s*Without the busywork\./;
type Actor = { id: string; email: string; page: Page };
type Design = {
  guest: (options?: BrowserContextOptions) => Promise<Page>;
  actor: (options?: BrowserContextOptions) => Promise<Actor>;
};
let passwordHash: string;

const test = base.extend<{ design: Design }>({
  design: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    const externalRequests: string[] = [];
    const guest = async (options: BrowserContextOptions = {}) => {
      const context = await browser.newContext({ ...options, baseURL: BASE, storageState: EMPTY_STATE, serviceWorkers: "block" });
      contexts.push(context);
      await context.route((url) => !["localhost", "127.0.0.1"].includes(url.hostname), (route) => {
        externalRequests.push(route.request().url());
        return route.abort();
      });
      return context.newPage();
    };
    try {
      await use({
        guest,
        actor: async (options) => {
          const suffix = randomUUID();
          const user = await db.user.create({ data: {
            email: `design-${suffix}@test.capture.invalid`, name: `Design recruiter ${suffix}`, passwordHash,
            settings: { create: {} },
          } });
          const token = randomBytes(32).toString("base64url");
          await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
          const page = await guest(options);
          await page.context().addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
          return { id: user.id, email: user.email, page };
        },
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
      expect(externalRequests, "Design surfaces must not request external resources").toEqual([]);
    }
  },
});

test.use({ storageState: EMPTY_STATE });
test.setTimeout(120_000);
test.beforeAll(async () => { passwordHash = await hashPassword(PASSWORD); });
test.afterAll(async () => { await db.$disconnect(); });

const scenarios = [
  { name: "desktop", mobile: false, options: { viewport: { width: 1440, height: 1000 } } },
  { name: "mobile", mobile: true, options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "reduced motion", mobile: true, options: { viewport: { width: 390, height: 844 }, reducedMotion: "reduce" as const } },
];

async function expectNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function keyboardReach(page: Page, target: Locator) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await target.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
  expect(await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none";
  }), "Keyboard focus must have a visible outline or ring").toBe(true);
}

async function inspectNavigation(page: Page, mobile: boolean, publicPage: boolean) {
  await expect(page.getByRole("banner").getByRole("link", { name: "Capture", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  const toggle = page.getByRole("button", { name: "Toggle navigation", exact: true });
  if (mobile) {
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const controlledId = await toggle.getAttribute("aria-controls");
    expect(controlledId).toBeTruthy();
    const controlled = page.locator(`[id="${controlledId}"]`);
    await expect(controlled).toHaveCount(1);
    await expect(nav).toBeHidden();
    await keyboardReach(page, toggle);
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(controlled).toBeVisible();
    await expect(nav).toBeVisible();
  } else {
    await expect(nav).toBeVisible();
    await expect(toggle).toBeHidden();
  }
  for (const name of publicPage ? ["Features", "Workflow", "FAQ", "Sign in"] : ["Roles", "Settings"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  if (publicPage) {
    for (const [name, anchor] of [["Features", "features"], ["Workflow", "workflow"], ["FAQ", "faq"]]) {
      await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("href", new RegExp(`#${anchor}$`));
    }
    await expect(nav.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/login");
  }
  await expectNoOverflow(page);
  if (mobile) {
    await keyboardReach(page, toggle);
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(nav).toBeHidden();
  }
}

async function inspectPreview(page: Page) {
  const preview = page.getByRole("region", { name: "Product preview", exact: true });
  await expect(preview).toBeVisible();
  await expect(preview.getByText(/Illustrative data/)).toBeVisible();
  const tabs = preview.getByRole("tablist", { name: "Preview a workflow", exact: true });
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  const pipeline = tabs.getByRole("tab", { name: "Pipeline", exact: true });
  await expect(pipeline).toHaveAttribute("aria-selected", "true");
  await keyboardReach(page, pipeline);
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Briefing", exact: true })).toBeFocused();
  await expect(tabs.getByRole("tab", { name: "Briefing", exact: true })).toHaveAttribute("aria-selected", "true");
  const contents: string[] = [];
  for (const name of ["Pipeline", "Briefing", "Outreach"]) {
    const tab = tabs.getByRole("tab", { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(tabs.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
    const panel = preview.getByRole("tabpanel");
    await expect(panel).toHaveCount(1);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("id", (await tab.getAttribute("aria-controls"))!);
    await expect(panel).toHaveAttribute("aria-labelledby", (await tab.getAttribute("id"))!);
    const content = (await panel.innerText()).trim();
    expect(content.length).toBeGreaterThan(0);
    expect(contents).not.toContain(content);
    contents.push(content);
    await expect(preview.getByText(/Illustrative data/)).toBeVisible();
    await expectNoOverflow(page);
  }
}

async function inspectFaq(page: Page) {
  const details = page.locator("#faq details").first();
  const summary = details.locator("summary");
  await expect(summary).toBeVisible();
  await expect(details).not.toHaveAttribute("open", "");
  await keyboardReach(page, summary);
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  expect((await details.innerText()).length).toBeGreaterThan((await summary.innerText()).length);
  await page.keyboard.press("Space");
  await expect(details).not.toHaveAttribute("open", "");
}

for (const scenario of scenarios) {
  test(`D1 ${scenario.name}: guest marketing navigation, preview, FAQ and calls to action`, async ({ design }, testInfo) => {
    const page = await design.guest(scenario.options);
    await page.goto("/");
    await expect(page).toHaveURL(`${BASE}/`);
    await expect(page.getByRole("heading", { level: 1, name: HERO })).toBeVisible();
    if (scenario.name === "reduced motion") expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await inspectNavigation(page, scenario.mobile, true);
    await page.screenshot({ path: testInfo.outputPath("homepage.png"), fullPage: true });
    await inspectPreview(page);
    await inspectFaq(page);
    const workflow = page.getByRole("link", { name: "See how it works", exact: true }).first();
    await expect(workflow).toHaveAttribute("href", "#workflow");
    await workflow.click();
    await expect(page).toHaveURL(`${BASE}/#workflow`);
    await expect(page.locator("#workflow")).toBeInViewport();
    await expectNoOverflow(page);
    await page.getByRole("link", { name: "Open your workspace", exact: true }).first().click();
    await expect(page).toHaveURL(`${BASE}/login`);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to Capture", exact: true })).toBeVisible();
    await expectNoOverflow(page);
  });

  test(`D2 ${scenario.name}: roles search and sort are private, useful and non-mutating`, async ({ design }, testInfo) => {
    const actor = await design.actor(scenario.options);
    const other = await design.actor();
    const foreign = await db.role.create({ data: {
      userId: other.id, title: `Foreign confidential role ${other.id}`, client: `Foreign client ${other.id}`, jobDesc: `Foreign briefing ${other.id}`,
      candidates: { create: { fullName: `Foreign candidate ${other.id}`, notes: `Foreign notes ${other.id}` } },
    }, include: { candidates: true } });
    const alpha = await db.role.create({ data: {
      userId: actor.id, title: "Alpha engineer", client: "Cedar Partners", updatedAt: new Date("2020-01-01"),
      candidates: { create: { fullName: "TEST-ONLY Alpha candidate", stage: "replied" } },
    } });
    const beta = await db.role.create({ data: { userId: actor.id, title: "Beta designer", client: "North Studio", updatedAt: new Date("2023-01-01") } });
    const gamma = await db.role.create({ data: {
      userId: actor.id, title: "Gamma analyst", client: "South Studio", updatedAt: new Date("2022-01-01"),
      candidates: { create: [1, 2, 3].map((number) => ({ fullName: `TEST-ONLY Gamma candidate ${number}` })) },
    } });
    const snapshot = () => db.role.findMany({ where: { userId: { in: [actor.id, other.id] } }, orderBy: { id: "asc" }, include: { candidates: { orderBy: { id: "asc" } } } });
    const before = await snapshot();
    const page = actor.page;
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Roles", exact: true })).toBeVisible();
    await inspectNavigation(page, scenario.mobile, false);
    await page.screenshot({ path: testInfo.outputPath("workspace.png"), fullPage: true });
    const main = page.getByRole("main");
    const cards = main.locator([alpha, beta, gamma].map((role) => `a[href="/roles/${role.id}"]`).join(", "));
    const card = (id: string) => main.locator(`a[href="/roles/${id}"]`);
    const assertOrder = async (ids: string[]) => {
      await expect(cards).toHaveCount(ids.length);
      await expect.poll(() => cards.evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual(ids.map((id) => `/roles/${id}`));
    };
    const assertPrivate = async () => {
      const html = await page.content();
      for (const value of [other.email, foreign.title, foreign.client!, foreign.jobDesc!, foreign.candidates[0].fullName, foreign.candidates[0].notes!]) expect(html).not.toContain(value);
      await expect(main.locator(`a[href="/roles/${foreign.id}"]`)).toHaveCount(0);
    };
    const search = page.getByLabel("Search roles", { exact: true });
    const sort = page.getByLabel("Sort roles", { exact: true });
    await expect(search).toBeVisible();
    await expect(sort).toBeVisible();
    await sort.selectOption({ label: "Recently updated" });
    await assertOrder([beta.id, gamma.id, alpha.id]);
    await expect(card(alpha.id)).toContainText("1 candidate");
    await expect(card(alpha.id)).toContainText("1 to follow up today");
    await expect(card(beta.id)).toContainText("0 candidates");
    await expect(card(beta.id)).toContainText("no follow-ups today");
    await expect(card(gamma.id)).toContainText("3 candidates");
    await assertPrivate();
    await sort.selectOption({ label: "Role name" });
    await assertOrder([alpha.id, beta.id, gamma.id]);
    await sort.selectOption({ label: "Most candidates" });
    await assertOrder([gamma.id, alpha.id, beta.id]);
    await search.fill("ALPHA");
    await assertOrder([alpha.id]);
    await search.fill("north studio");
    await assertOrder([beta.id]);
    await search.fill(foreign.title);
    await assertOrder([]);
    await assertPrivate();
    await search.fill("");
    await assertOrder([gamma.id, alpha.id, beta.id]);
    await keyboardReach(page, search);
    await page.keyboard.press("Tab");
    await expect(sort).toBeFocused();
    await expectNoOverflow(page);
    expect(await snapshot()).toEqual(before);
    await page.goto("/welcome");
    await expect(page).toHaveURL(`${BASE}/welcome`);
    await expect(page.getByRole("heading", { level: 1, name: HERO })).toBeVisible();
    const welcomeHtml = await page.content();
    for (const value of [other.email, alpha.title, beta.title, gamma.title, foreign.title, foreign.jobDesc!]) expect(welcomeHtml).not.toContain(value);
    await expect(page.getByRole("region", { name: "Product preview", exact: true }).getByText(/Illustrative data/)).toBeVisible();
    await expectNoOverflow(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Roles", exact: true })).toBeVisible();
    await card(alpha.id).click();
    await expect(page).toHaveURL(`${BASE}/roles/${alpha.id}`);
    await expect(page.getByRole("main")).toContainText("TEST-ONLY Alpha candidate");
    await assertPrivate();
  });
}

for (const scenario of scenarios.filter((entry) => entry.name !== "reduced motion")) {
  test(`D3 ${scenario.name}: login retains accessible fields, keyboard submission and password visibility`, async ({ design }, testInfo) => {
    const actor = await design.actor();
    const page = await design.guest(scenario.options);
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to Capture", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("login.png"), fullPage: true });
    const email = page.getByLabel("Email", { exact: true });
    const password = page.getByLabel("Password", { exact: true });
    await keyboardReach(page, email);
    await page.keyboard.type(actor.email);
    await page.keyboard.press("Tab");
    await expect(password).toBeFocused();
    await page.keyboard.type(PASSWORD);
    await expect(password).toHaveAttribute("type", "password");
    const show = page.getByRole("button", { name: "Show password", exact: true });
    await keyboardReach(page, show);
    await page.keyboard.press("Enter");
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue(PASSWORD);
    const hide = page.getByRole("button", { name: "Hide password", exact: true });
    await expect(hide).toBeFocused();
    await page.keyboard.press("Space");
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveValue(PASSWORD);
    await expectNoOverflow(page);
    const submit = page.getByRole("button", { name: "Sign in", exact: true });
    await keyboardReach(page, submit);
    await page.keyboard.press("Enter");
    // A newly activated account has nothing configured yet, so its first
    // sign-in opens the setup guide rather than an empty dashboard.
    await expect(page).toHaveURL(`${BASE}/getting-started`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome");
    await expectNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("getting-started.png"), fullPage: true });
    await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Roles", exact: true }).click();
    await expect(page).toHaveURL(`${BASE}/`);
    await expect(page.getByRole("heading", { level: 1, name: "Roles", exact: true })).toBeVisible();
    await expectNoOverflow(page);
  });
}
