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
    const ringed = (node: Element) => {
      const style = getComputedStyle(node);
      return (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none";
    };
    // A search input shows focus on the field around it, through :focus-within.
    const field = element.closest(".search-field");
    return ringed(element) || (field !== null && ringed(field));
  }), "Keyboard focus must have a visible outline or ring").toBe(true);
}

async function inspectNavigation(page: Page, mobile: boolean) {
  await expect(page.getByRole("banner").getByRole("link", { name: "Retrivr", exact: true })).toBeVisible();
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
  for (const name of ["Roles", "Settings"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expectNoOverflow(page);
  if (mobile) {
    await keyboardReach(page, toggle);
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(nav).toBeHidden();
  }
}

// The homepage carries its own Retrivr header: section links on a wide
// screen, and on a phone only the way in, with every section a scroll away.
async function inspectPublicNavigation(page: Page, mobile: boolean) {
  const banner = page.getByRole("banner");
  await expect(banner.getByRole("link", { name: "Retrivr", exact: true })).toBeVisible();
  await expect(banner.getByRole("img", { name: "Retrivr", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  const signIn = nav.getByRole("link", { name: "Sign in", exact: true });
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute("href", "/login");
  await expect(page.getByRole("button", { name: "Toggle navigation", exact: true })).toHaveCount(0);
  for (const [name, anchor] of [["Features", "how"], ["Pricing", "pricing"], ["FAQ", "faq"], ["Contact", "contact"]]) {
    // Hidden links are out of the accessibility tree, so find them by address.
    const link = nav.locator(`a[href="#${anchor}"]`);
    await expect(link).toHaveText(name);
    await expect(page.locator(`#${anchor}`)).toHaveCount(1);
    if (mobile) await expect(link).toBeHidden(); else await expect(link).toBeVisible();
  }
  await keyboardReach(page, signIn);
  await expectNoOverflow(page);
}

async function inspectHero(page: Page, reducedMotion: boolean) {
  const board = page.getByRole("img", { name: /^Illustration: candidates move across a role's pipeline/ });
  await expect(board).toBeVisible();
  await expect(page.getByText("Illustrative data · not a real workspace", { exact: true })).toBeVisible();
  // Pause and Replay are offered only where things move.
  const pause = page.getByRole("button", { name: "Pause animation", exact: true });
  await expect(page.getByRole("button", { name: "Replay", exact: true })).toHaveCount(reducedMotion ? 0 : 6);
  if (reducedMotion) {
    await expect(pause).toHaveCount(0);
  } else {
    await keyboardReach(page, pause);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Play animation", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(pause).toBeFocused();
  }
  await expectNoOverflow(page);
}

async function inspectPricing(page: Page) {
  const pricing = page.locator("#pricing");
  const monthly = pricing.getByRole("button", { name: "Monthly", exact: true });
  const annual = pricing.getByRole("button", { name: /^Annual/ });
  const lite = pricing.locator("article", { hasText: "Lite" }).first();
  await expect(monthly).toHaveAttribute("aria-pressed", "true");
  await expect(lite).toContainText("£5.99/ month");
  await expect(lite).toContainText("or £49.99 / year");
  await annual.click();
  await expect(annual).toHaveAttribute("aria-pressed", "true");
  await expect(monthly).toHaveAttribute("aria-pressed", "false");
  await expect(lite).toContainText("£49.99/ year");
  await expect(lite).toContainText("save 30%");
  await expect(pricing.getByText("7 days free", { exact: true })).toBeVisible();
  await monthly.click();
  await expect(lite).toContainText("£5.99/ month");
  // With sign-up open (the test server has it), every plan goes to /signup,
  // Pro Max included; the contact box stays for teams, and Retrivr sends nothing.
  await expect(pricing.getByRole("link", { name: "Start free trial", exact: true })).toHaveAttribute("href", "/signup");
  await expect(pricing.getByRole("link", { name: "Start with a free trial", exact: true })).toHaveCount(3);
  await expect(pricing.getByRole("link", { name: /Contact us|Get /, exact: false })).toHaveCount(0);
  const contact = page.locator("#contact");
  await expect(contact.getByRole("link", { name: "Email us", exact: true })).toHaveAttribute("href", "mailto:aditya.shah@basanite.co.uk?subject=Retrivr");
  await expect(contact.getByText("aditya.shah@basanite.co.uk", { exact: true })).toBeVisible();
  await expectNoOverflow(page);
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
  test(`D1 ${scenario.name}: guest homepage navigation, hero, FAQ, pricing and calls to action`, async ({ design }, testInfo) => {
    const page = await design.guest(scenario.options);
    await page.goto("/");
    await expect(page).toHaveURL(`${BASE}/`);
    await expect(page).toHaveTitle("Retrivr");
    await expect(page.getByRole("heading", { level: 1, name: HERO })).toBeVisible();
    if (scenario.name === "reduced motion") expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await inspectPublicNavigation(page, scenario.mobile);
    await page.screenshot({ path: testInfo.outputPath("homepage.png"), fullPage: true });
    await inspectHero(page, scenario.name === "reduced motion");
    await inspectFaq(page);
    await inspectPricing(page);
    const workflow = page.getByRole("link", { name: "See how it works", exact: true }).first();
    await expect(workflow).toHaveAttribute("href", "#how");
    await workflow.click();
    await expect(page).toHaveURL(`${BASE}/#how`);
    await expect(page.locator("#how")).toBeInViewport();
    await expectNoOverflow(page);
    await page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${BASE}/login`);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to Retrivr", exact: true })).toBeVisible();
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
    await inspectNavigation(page, scenario.mobile);
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
    await expect(page.getByText("Illustrative data · not a real workspace", { exact: true })).toBeVisible();
    // Signed in, the homepage's way in leads back to the workspace.
    await expect(page.getByRole("banner").getByRole("link", { name: "Open workspace", exact: true })).toHaveAttribute("href", "/");
    await expectNoOverflow(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Roles", exact: true })).toBeVisible();
    await card(alpha.id).click();
    await expect(page).toHaveURL(`${BASE}/roles/${alpha.id}`);
    await expect(page.getByRole("main")).toContainText("TEST-ONLY Alpha candidate");
    await assertPrivate();

    // Each summary card opens what it counts.
    await page.goto("/");
    const metric = (label: string) => main.locator("a.metric-card", { hasText: new RegExp(`^${label}`) });
    await expect(metric("Open roles")).toHaveAttribute("href", "#role-directory");
    await expect(metric("People in pipeline")).toHaveAttribute("href", "/people");
    await expect(metric("Follow-ups today")).toHaveAttribute("href", "/followups");
    await expect(metric("Saved searches")).toHaveAttribute("href", "/searches");
    await metric("Open roles").click();
    await expect(page).toHaveURL(`${BASE}/#role-directory`);
    await expect(page.locator("#role-directory")).toBeInViewport();
    await metric("Follow-ups today").click();
    await expect(page).toHaveURL(`${BASE}/followups`);
  });
}

for (const scenario of scenarios.filter((entry) => entry.name !== "reduced motion")) {
  test(`D3 ${scenario.name}: login retains accessible fields, keyboard submission and password visibility`, async ({ design }, testInfo) => {
    const actor = await design.actor();
    const page = await design.guest(scenario.options);
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to Retrivr", exact: true })).toBeVisible();
    // Sign-in carries the new name throughout, the tab title included.
    await expect(page).toHaveTitle("Retrivr");
    expect(await page.locator("body").innerText()).not.toMatch(/capture/i);
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
    if (scenario.mobile) await page.getByRole("button", { name: "Toggle navigation", exact: true }).click();
    await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Roles", exact: true }).click();
    await expect(page).toHaveURL(`${BASE}/`);
    await expect(page.getByRole("heading", { level: 1, name: "Roles", exact: true })).toBeVisible();
    await expectNoOverflow(page);
  });
}
