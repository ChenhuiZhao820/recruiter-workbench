import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";

// The email finder: a person's work email found through Enrow on a click,
// counted against the plan's searches, and an outreach card that can also
// open the message as an email draft. Enrow is the local stub; Retrivr sends
// nothing. Fictional people and the disposable database only.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const STUB = "http://localhost:8766";

type Account = { user: { id: string }; page: Page; token: string; close: () => Promise<void> };

async function account(browser: Browser, data: Record<string, unknown>): Promise<Account> {
  const user = await db.user.create({ data: {
    email: `finder-${randomUUID()}@test.capture.invalid`, name: "Morven Ellis", role: "recruiter",
    settings: { create: { seenRelease: CURRENT_RELEASE, recruiterName: "Morven Ellis" } },
    ...data,
  } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] }, permissions: ["clipboard-read", "clipboard-write"] });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  return { user, token, page: await context.newPage(), close: () => context.close() };
}

async function person(userId: string, fullName: string, extra: { profileUrl?: string | null; headline?: string; doNotContact?: boolean; email?: string } = {}) {
  const slug = fullName.toLowerCase().replace(/\W+/g, "-");
  return db.person.create({ data: {
    userId, fullName, searchText: fullName.toLowerCase(), headline: extra.headline ?? null, doNotContact: extra.doNotContact ?? false,
    profileUrl: extra.profileUrl === undefined ? `https://www.linkedin.com/in/${slug}` : extra.profileUrl,
    email: extra.email ?? null, emailSource: extra.email ? "manual" : null,
  } });
}

async function stub(state: Record<string, unknown> = {}) {
  const response = await fetch(`${STUB}/__enrow`, { method: "POST", body: JSON.stringify(state) });
  return response.json() as Promise<{ requests: Record<string, string>[] }>;
}

async function find(page: Page, personId: string, extra: Record<string, unknown> = {}, origin = BASE) {
  return page.request.post("/api/email-finder", { headers: { origin, "content-type": "application/json" }, data: { personId, ...extra } });
}

async function usedUp(userId: string, times: number) {
  await db.emailLookup.createMany({ data: Array.from({ length: times }, () => ({ userId, method: "linkedin", status: "found" })) });
}

let pro: Account;

test.beforeAll(async ({ browser }) => {
  pro = await account(browser, { accountTier: "pro" });
});

test.afterAll(async () => {
  await stub({ fail: false, noCredits: false, refuseLinkedin: false, requests: [] });
  await pro.close();
});

test.beforeEach(async () => {
  await stub({ fail: false, noCredits: false, refuseLinkedin: false, requests: [] });
});

test("EF1 Find email searches by the LinkedIn address alone, saves what it finds on the person, and counts one search", async () => {
  const { page, user } = pro;
  const imogen = await person(user.id, "Imogen Achterberg", { headline: "Platform Lead at Halden Systems" });
  await page.goto(`/people/${imogen.id}`);
  const block = page.getByRole("region", { name: "Email" });
  await expect(block.getByText("250 of 250 email searches left this month")).toBeVisible();
  await block.getByRole("button", { name: "Find email" }).click();
  await expect(block.getByText("imogen.achterberg@enrow-stub.example")).toBeVisible({ timeout: 15_000 });

  const saved = await db.person.findUniqueOrThrow({ where: { id: imogen.id } });
  expect([saved.email, saved.emailSource, saved.emailConsentAt]).toEqual(["imogen.achterberg@enrow-stub.example", "finder", null]);
  // Enrow was sent the canonical profile address and nothing else.
  expect((await stub()).requests).toEqual([{ linkedin_url: "https://www.linkedin.com/in/imogen-achterberg" }]);
  const lookups = await db.emailLookup.findMany({ where: { userId: user.id } });
  expect(lookups.map((row) => [row.status, row.method, row.enrowId])).toEqual([["found", "linkedin", null]]);
  // The lookup holds no name, address or email.
  expect(JSON.stringify(lookups)).not.toContain("imogen");

  await page.reload();
  await expect(block.getByText("imogen.achterberg@enrow-stub.example")).toBeVisible();
  await expect(block.getByText("Found by Enrow, unverified")).toBeVisible();
  await expect(block.getByRole("button", { name: "Find email" })).toHaveCount(0);
  // A person who already has an email is not searched again.
  expect((await find(page, imogen.id)).status()).toBe(409);
  expect(await db.usageEvent.count({ where: { userId: user.id, kind: "email_found" } })).toBe(1);
});

test("EF2 nothing found by LinkedIn costs nothing and offers a search by name with the headline's company, which the recruiter confirms", async () => {
  const { page, user } = pro;
  const nobody = await person(user.id, "Bram Okafor-Lind", { profileUrl: "https://www.linkedin.com/in/bram-nobody", headline: "Engineer @Kestrel Labs | ex-Halden" });
  await page.goto(`/people/${nobody.id}`);
  const block = page.getByRole("region", { name: "Email" });
  await block.getByRole("button", { name: "Find email" }).click();
  await expect(block.getByText("Their profile shows no current employer, so there is no work email to find.")).toBeVisible({ timeout: 15_000 });
  const company = block.getByLabel("Where Bram works now");
  await expect(company).toHaveValue("Kestrel Labs");
  await expect(block.getByText("249 of 250 email searches left this month")).toBeVisible();

  await block.getByRole("button", { name: "Search by name" }).click();
  await expect(block.getByText("bram.okafor-lind@kestrellabs.example")).toBeVisible({ timeout: 15_000 });
  expect((await stub()).requests).toEqual([
    { linkedin_url: "https://www.linkedin.com/in/bram-nobody" },
    { fullname: "Bram Okafor-Lind", company_name: "Kestrel Labs" },
  ]);
  expect((await db.emailLookup.findMany({ where: { userId: user.id, personId: nobody.id }, orderBy: { createdAt: "asc" } })).map((row) => row.status)).toEqual(["not_found", "found"]);
});

test("EF3 without a LinkedIn address the company is asked for first, and a company with nobody found is free", async () => {
  const { page, user } = pro;
  const quentin = await person(user.id, "Quentin Arbuthnot", { profileUrl: null });
  await page.goto(`/people/${quentin.id}`);
  const block = page.getByRole("region", { name: "Email" });
  await expect(block.getByRole("button", { name: "Find email" })).toHaveCount(0);
  await block.getByLabel("Where Quentin works now").fill("Nowhere");
  await block.getByRole("button", { name: "Search by name" }).click();
  await expect(block.getByText("No email found for that name and company.")).toBeVisible({ timeout: 15_000 });
  expect((await db.person.findUniqueOrThrow({ where: { id: quentin.id } })).email).toBeNull();
  // Two found so far (EF1, EF2); not found and nothing pending do not count.
  await page.reload();
  await expect(block.getByText("248 of 250 email searches left this month")).toBeVisible();
  // Without a company there is nothing to search on.
  const refused = await find(page, quentin.id);
  expect(refused.status()).toBe(400);
  expect((await refused.json()).needCompany).toBe(true);
});

test("EF4 the outreach card finds the email in place, opens LinkedIn and the email draft with one click, and records both", async () => {
  const { page, user } = pro;
  await page.context().route((url) => !["localhost", "127.0.0.1"].includes(url.hostname), (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" }));
  // A mailto: link is recorded instead of followed.
  await page.addInitScript(() => {
    const original = HTMLAnchorElement.prototype.click;
    (window as unknown as { drafts: string[] }).drafts = [];
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.href.startsWith("mailto:")) (window as unknown as { drafts: string[] }).drafts.push(this.href);
      else original.call(this);
    };
  });
  const role = await db.role.create({ data: { userId: user.id, title: "Plant Manager", client: "Halden Systems" } });
  const template = await db.messageTemplate.create({ data: { userId: user.id, name: "First note", body: "Hi {{first_name}}, a quick note about {{role_title}}." } });
  const rhiannon = await person(user.id, "Rhiannon Vale");
  const candidate = await db.candidate.create({ data: { roleId: role.id, personId: rhiannon.id, fullName: "Rhiannon Vale", profileUrl: rhiannon.profileUrl, stage: "sourced" } });

  await page.goto(`/roles/${role.id}/outreach?template=${template.id}&c=${candidate.id}&i=0`);
  await expect(page.getByRole("button", { name: "Copy and open profile", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Find email" }).click();
  await expect(page.getByText("Also email it to rhiannon.vale@enrow-stub.example")).toBeVisible({ timeout: 15_000 });
  const also = page.getByRole("checkbox", { name: /Also email it to/ });
  await expect(also).toBeChecked();
  await expect(page.getByLabel("Email subject")).toHaveValue("Plant Manager");
  await page.getByLabel("Message").fill("Hi Rhiannon, a line just for you.");

  const [profile] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Copy and open profile and email" }).click()]);
  expect(profile.url()).toBe("https://www.linkedin.com/in/rhiannon-vale");
  await profile.close();
  expect(await page.evaluate(() => (window as unknown as { drafts: string[] }).drafts)).toEqual([
    "mailto:rhiannon.vale@enrow-stub.example?subject=Plant%20Manager&body=Hi%20Rhiannon%2C%20a%20line%20just%20for%20you.",
  ]);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Hi Rhiannon, a line just for you.");

  await page.getByRole("button", { name: "Mark as sent and finish" }).click();
  await expect.poll(async () => (await db.outreachLog.findMany({ where: { candidateId: candidate.id } })).map((row) => [row.renderedBody, row.channel])).toEqual([["Hi Rhiannon, a line just for you.", "both"]]);

  // Unticked, the same card is LinkedIn only, and the choice is remembered.
  await page.goto(`/roles/${role.id}/outreach?template=${template.id}&c=${candidate.id}&i=0`);
  await page.getByRole("checkbox", { name: /Also email it to/ }).uncheck();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /Also email it to/ })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Copy and open profile", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: /Also email it to/ }).check();

  // The person's page lists the message with how it went out.
  await page.goto(`/people/${rhiannon.id}`);
  await expect(page.getByText("Message · LinkedIn and email")).toBeVisible();
});

test("EF5 Find email is in a role row's edit dialog and fills the email field", async () => {
  const { page, user } = pro;
  const role = await db.role.create({ data: { userId: user.id, title: "Shift Lead" } });
  const twyla = await person(user.id, "Twyla Haverford");
  await db.candidate.create({ data: { roleId: role.id, personId: twyla.id, fullName: "Twyla Haverford", profileUrl: twyla.profileUrl } });
  const dnc = await person(user.id, "Doris Pennington", { doNotContact: true });
  await db.candidate.create({ data: { roleId: role.id, personId: dnc.id, fullName: "Doris Pennington", profileUrl: dnc.profileUrl } });
  await page.goto(`/roles/${role.id}`);
  const row = page.locator("li.card", { hasText: "Twyla Haverford" });
  await expect(row.getByRole("button", { name: "Find email" })).toHaveCount(0);
  await row.getByRole("button", { name: "Edit details for Twyla Haverford" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("247 of 250 left")).toBeVisible();
  await dialog.getByRole("button", { name: "Find email" }).click();
  await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue("twyla.haverford@enrow-stub.example", { timeout: 15_000 });
  await expect(dialog.getByText("246 of 250 left")).toBeVisible();
  // Found is already saved; Save with nothing else changed closes quietly.
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByText("Changes saved")).toHaveCount(0);
  expect((await db.person.findUniqueOrThrow({ where: { id: twyla.id } })).emailSource).toBe("finder");
  // Nobody marked do not contact is offered a search, nor can one be forced.
  await page.locator("li.card", { hasText: "Doris Pennington" }).getByRole("button", { name: "Edit details for Doris Pennington" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Find email" })).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  expect((await find(page, dnc.id)).status()).toBe(409);
});

test("EF6 Enrow out of credit, refusing an address or down: the search is free and says what to do", async () => {
  const { page, user } = pro;
  const before = await db.emailLookup.count({ where: { userId: user.id, status: "found" } });
  const clement = await person(user.id, "Clement Rook");

  await stub({ noCredits: true });
  const noCredits = await find(page, clement.id);
  expect(noCredits.status()).toBe(503);
  expect((await noCredits.json()).error).toMatch(/unavailable right now/);

  await stub({ noCredits: false, refuseLinkedin: true });
  const refused = await find(page, clement.id);
  expect(refused.status()).toBe(422);
  expect((await refused.json()).needCompany).toBe(true);

  await stub({ refuseLinkedin: false, fail: true });
  expect((await find(page, clement.id)).status()).toBe(502);

  expect(await db.emailLookup.count({ where: { userId: user.id, personId: clement.id, status: "failed" } })).toBe(3);
  expect(await db.emailLookup.count({ where: { userId: user.id, status: "found" } })).toBe(before);
});

test("EF7 another account's person, a forged origin and a read-only view are refused before Enrow is asked", async ({ browser }) => {
  const other = await account(browser, { accountTier: "pro" });
  try {
    const theirs = await person(other.user.id, "Selma Quist");
    expect((await find(pro.page, theirs.id)).status()).toBe(404);
    const mine = await person(pro.user.id, "Yusuf Brandt");
    expect((await find(pro.page, mine.id, {}, "https://attacker.example")).status()).toBe(403);
    const lookup = await db.emailLookup.create({ data: { userId: other.user.id, method: "linkedin", status: "found" } });
    expect((await pro.page.request.get(`/api/email-finder/${lookup.id}`)).status()).toBe(404);

    // An administrator viewing a Pro workspace read-only cannot spend its searches.
    const admin = await account(browser, { role: "admin" });
    try {
      await db.session.update({ where: { tokenHash: hashToken(admin.token) }, data: { viewUserId: pro.user.id } });
      expect((await find(admin.page, mine.id)).status()).toBe(403);
      await admin.page.goto(`/people/${mine.id}`);
      await expect(admin.page.getByRole("button", { name: "Find email" })).toHaveCount(0);
    } finally {
      await admin.close();
    }
    expect((await stub()).requests).toEqual([]);
  } finally {
    await other.close();
  }
});

test("EF8 Basic has no email finder at all", async ({ browser }) => {
  const basic = await account(browser, { accountTier: "basic" });
  try {
    const someone = await person(basic.user.id, "Petra Lindqvist");
    await basic.page.goto(`/people/${someone.id}`);
    await expect(basic.page.getByRole("region", { name: "Email" }).getByText("No email yet.")).toBeVisible();
    await expect(basic.page.getByRole("button", { name: "Find email" })).toHaveCount(0);
    expect((await find(basic.page, someone.id)).status()).toBe(404);
  } finally {
    await basic.close();
  }
});

test("EF9 a month's searches used up refuse the next one; a trial has 50 for the whole trial and everything else keeps working", async ({ browser }) => {
  const full = await account(browser, { accountTier: "pro" });
  const trial = await account(browser, { accountTier: "trial", signupSource: "self", trialExpiresAt: new Date(Date.now() + 5 * 86_400_000) });
  try {
    await usedUp(full.user.id, 250);
    const someone = await person(full.user.id, "Ines Moreau");
    await full.page.goto(`/people/${someone.id}`);
    await expect(full.page.getByText("0 of 250 email searches left this month.")).toBeVisible();
    await expect(full.page.getByRole("button", { name: "Find email" })).toBeDisabled();
    const refused = await find(full.page, someone.id);
    expect(refused.status()).toBe(429);
    expect((await refused.json()).error).toBe("This month's email searches are used up. Add this one by hand.");

    // Last month's searches do not count this month.
    await db.emailLookup.updateMany({ where: { userId: full.user.id }, data: { createdAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) - 1000) } });
    await full.page.reload();
    await expect(full.page.getByText("250 of 250 email searches left this month.", { exact: false })).toBeVisible();

    await usedUp(trial.user.id, 50);
    const theirs = await person(trial.user.id, "Odette Marsh");
    const trialRefused = await find(trial.page, theirs.id);
    expect(trialRefused.status()).toBe(429);
    expect((await trialRefused.json()).error).toMatch(/trial's email searches are used up/);
    await trial.page.goto(`/people/${theirs.id}`);
    await expect(trial.page.getByText("0 of 50 email searches left in your trial.")).toBeVisible();
    // The rest of the workspace is untouched: email can still be added by hand.
    await trial.page.getByText("Add it by hand").click();
    await trial.page.getByLabel("Email address").fill("odette@marsh.example");
    await trial.page.getByRole("button", { name: "Save email" }).click();
    await expect(trial.page.getByText("Email saved.")).toBeVisible();
    expect((await db.person.findUniqueOrThrow({ where: { id: theirs.id } })).emailSource).toBe("manual");
    await trial.page.goto("/people");
    await expect(trial.page.getByRole("link", { name: "Odette Marsh" })).toBeVisible();
  } finally {
    await full.close();
    await trial.close();
  }
});

test("EF10 the person page's email block fits a phone", async () => {
  const { page, user } = pro;
  const narrow = await person(user.id, "Wilhelmina Featherstonehaugh-Cholmondeley", { profileUrl: null, headline: "Head of Procurement at A Very Long Company Name Holdings International" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/people/${narrow.id}`);
  await expect(page.getByLabel("Where Wilhelmina works now")).toHaveValue("A Very Long Company Name Holdings International");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("EF11 the extension finds an email with its extension key: a kept person gets it on their record, anyone else gets it back for the save, and not found is free", async ({ browser }) => {
  const own = await account(browser, { accountTier: "pro" });
  const other = await account(browser, { accountTier: "pro" });
  const basic = await account(browser, { accountTier: "basic" });
  const key = async (userId: string) => {
    const value = randomBytes(24).toString("base64url");
    await db.settings.update({ where: { userId }, data: { captureTokenHash: hashToken(value) } });
    return value;
  };
  const headers = (value: string) => ({ "x-capture-token": value, origin: "chrome-extension://fixture", "content-type": "application/json" });
  try {
    const captureKey = await key(own.user.id);
    const request = own.page.request;
    const settle = async (id: string) => {
      for (let tries = 0; tries < 10; tries += 1) {
        const polled = await request.get(`/api/capture/email/${id}`, { headers: headers(captureKey) });
        expect(polled.headers()["access-control-allow-origin"]).toBe("chrome-extension://fixture");
        const body = await polled.json();
        if (body.status !== "pending") return body;
        await new Promise((done) => setTimeout(done, 300));
      }
      throw new Error("never settled");
    };

    // The panel learns the searches left from the same call that lists roles.
    const listed = await (await request.get("/api/capture", { headers: headers(captureKey) })).json();
    expect(listed.emailFinder).toMatchObject({ quota: 250, remaining: 250 });

    // Somebody not yet saved: searched by address alone, nothing written, one search counted.
    const started = await request.post("/api/capture/email", { headers: headers(captureKey), data: { profileUrl: "https://www.linkedin.com/in/ione-castellano/" } });
    expect(started.status()).toBe(200);
    const fresh = await settle((await started.json()).id);
    expect(fresh).toMatchObject({ status: "found", email: "ione.castellano@enrow-stub.example", remaining: 249 });
    expect(await db.person.count({ where: { userId: own.user.id } })).toBe(0);
    expect((await stub()).requests.at(-1)).toMatchObject({ linkedin_url: "https://www.linkedin.com/in/ione-castellano" });

    // Saving with it keeps it on the new person, as found.
    const role = await db.role.create({ data: { userId: own.user.id, title: "Extension Finder Role" } });
    const saved = await request.post("/api/capture", { headers: headers(captureKey), data: { roleId: role.id, fullName: "Ione Castellano", profileUrl: "https://www.linkedin.com/in/ione-castellano/", email: fresh.email, emailFound: true } });
    expect(saved.status()).toBe(201);
    expect(await db.person.findFirstOrThrow({ where: { userId: own.user.id } })).toMatchObject({ email: "ione.castellano@enrow-stub.example", emailSource: "finder" });
    // Now kept: shown, not searched again.
    const again = await (await request.post("/api/capture/email", { headers: headers(captureKey), data: { profileUrl: "https://www.linkedin.com/in/ione-castellano/" } })).json();
    expect(again).toMatchObject({ status: "found", email: "ione.castellano@enrow-stub.example", remaining: 249 });

    // A kept person without an email: found onto their record.
    const kept = await person(own.user.id, "Bartholomew Ashdown");
    const keptStart = await (await request.post("/api/capture/email", { headers: headers(captureKey), data: { profileUrl: kept.profileUrl } })).json();
    expect((await settle(keptStart.id)).status).toBe("found");
    expect(await db.person.findUniqueOrThrow({ where: { id: kept.id } })).toMatchObject({ email: "bartholomew.ashdown@enrow-stub.example", emailSource: "finder" });

    // Nobody there: not found, and free.
    const nobody = await (await request.post("/api/capture/email", { headers: headers(captureKey), data: { profileUrl: "https://www.linkedin.com/in/nobody-here/" } })).json();
    expect(await settle(nobody.id)).toMatchObject({ status: "not_found", remaining: 248 });

    // Do not contact, a page that is not a profile, another account's search, no key, Basic: refused.
    const dnc = await person(own.user.id, "Delphine Marr", { doNotContact: true });
    expect((await request.post("/api/capture/email", { headers: headers(captureKey), data: { profileUrl: dnc.profileUrl } })).status()).toBe(409);
    expect((await request.post("/api/capture/email", { headers: headers(captureKey), data: { profileUrl: "https://www.linkedin.com/search/results/people/" } })).status()).toBe(400);
    const otherKey = await key(other.user.id);
    expect((await request.get(`/api/capture/email/${keptStart.id}`, { headers: headers(otherKey) })).status()).toBe(404);
    expect((await request.post("/api/capture/email", { headers: { origin: "chrome-extension://fixture" }, data: { profileUrl: kept.profileUrl } })).status()).toBe(401);
    const basicKey = await key(basic.user.id);
    expect((await request.post("/api/capture/email", { headers: headers(basicKey), data: { profileUrl: "https://www.linkedin.com/in/ione-castellano/" } })).status()).toBe(404);
    expect((await (await request.get("/api/capture", { headers: headers(basicKey) })).json()).emailFinder).toBeNull();
  } finally {
    await own.close();
    await other.close();
    await basic.close();
  }
});
