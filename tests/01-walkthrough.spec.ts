import { test, expect, Page } from "@playwright/test";
import { db, note, backdateCandidate, daysAgo } from "./helpers";

// The whole recruiter-day walkthrough, in order, against a fresh DB.
// Suboptimal-but-working behavior is recorded via note(); real breakage fails.

test.describe.configure({ mode: "serial" });

const CALENDAR = "https://calendly.com/alex/intro";
const externalRequests: string[] = [];

let roleId = "";
let firstDayToDay = "";

// Clicking "Mark as sent" and waiting for the "Past outreach" heading is not
// enough: the heading is already there for anyone with earlier outreach. Wait
// for the logged-message count to actually go up.
async function markAsSent(page: Page) {
  const entries = page.locator("section[aria-label='Past outreach'] li");
  const before = await entries.count();
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(entries).toHaveCount(Math.min(before + 1, 3));
}

async function prep(page: Page) {
  // The app must never need the outside world: block it, but log what tried.
  await page.context().route(
    (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
    (route) => {
      externalRequests.push(route.request().url());
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>blocked-by-test</title>" });
    }
  );
  page.on("dialog", (d) => d.accept());
}

test.beforeEach(async ({ page }) => prep(page));

test("00 warm up: the app serves its first page", async ({ page }) => {
  test.setTimeout(300_000);
  let lastError: unknown;
  const started = Date.now();
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await page.goto("/settings", { timeout: 30_000 });
      await page.getByLabel("Your name").waitFor({ timeout: 30_000 });
      lastError = undefined;
      break;
    } catch (e) {
      lastError = e;
      await page.waitForTimeout(5_000);
    }
  }
  if (lastError) throw lastError;
  const seconds = Math.round((Date.now() - started) / 1000);
  if (seconds > 20) {
    note(
      "slow-first-load",
      `First page load took ~${seconds}s on a dev server: next/font tries to download three Google Fonts families at compile time and blocks the build until the fetch times out when the network is restricted or offline.`
    );
  }
});

test("01 settings: name and calendar link save and persist", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Your name").fill("Alex Recruiter");
  await page.getByLabel("Calendar link").fill(CALENDAR);
  await expect(page.getByLabel("Chase a booking after (days)")).toHaveValue("2");
  await expect(page.getByLabel("Nudge quiet candidates after (days)")).toHaveValue("5");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByLabel("Your name")).toHaveValue("Alex Recruiter");
  await expect(page.getByLabel("Calendar link")).toHaveValue(CALENDAR);

  // The name is not write-only: it is offered as a template gap.
  expect((await db.settings.findFirst())!.recruiterName).toBe("Alex Recruiter");
  await page.goto("/templates");
  await expect(page.getByText("{{recruiter_name}}").first()).toBeVisible();
});

test("02 create a role", async ({ page }) => {
  await page.goto("/roles/new");
  await page.getByLabel("Job title").fill("Operations Director");
  await page.getByLabel(/Client/).fill("Acme Manufacturing");
  await page.getByLabel(/Job description/).fill(
    "Acme needs an Operations Director to run two UK plants: production planning, lean improvement, a team of 40, and a £5m budget. Reports to the MD."
  );
  await page.getByRole("button", { name: "Create role" }).click();
  await page.waitForURL(/\/roles\/(?!new$)[^/]+$/, { timeout: 30_000 });
  roleId = page.url().split("/roles/")[1];
  await expect(page.getByRole("heading", { name: "Operations Director" })).toBeVisible();
  await expect(page.getByText("No briefing yet")).toBeVisible();
});

test("03 generate briefing", async ({ page }) => {
  await page.goto(`/roles/${roleId}`);
  await page.getByRole("button", { name: "Generate briefing" }).click();
  await expect(page.getByRole("heading", { name: "What they do all day" })).toBeVisible({
    timeout: 30_000,
  });
  firstDayToDay = (await db.briefing.findUnique({ where: { roleId } }))!.dayToDay;
  await expect(page.getByText("Lean manufacturing.")).toBeVisible();
  await expect(page.getByText("Head of Operations", { exact: true })).toBeVisible();
  await expect(page.getByText("Mid-size manufacturers")).toBeVisible();
  await expect(page.getByText("£75k to £95k")).toBeVisible();
  await expect(page.getByText("Walk me through a shift that went wrong.")).toBeVisible();
});

test("04 regenerate briefing overwrites", async ({ page }) => {
  await page.goto(`/roles/${roleId}`);
  await expect(page.getByText(firstDayToDay)).toBeVisible();
  await page.getByRole("button", { name: "Regenerate briefing" }).click();
  // The new text replaces the old one in place rather than being appended.
  await expect(page.getByText(firstDayToDay)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "What they do all day" })).toBeVisible();

  const briefings = await db.briefing.count({ where: { roleId } });
  expect(briefings).toBe(1);
});

test("05 create a search from the briefing", async ({ page }) => {
  await page.goto(`/roles/${roleId}`);
  await page.getByRole("link", { name: "Create a search from this" }).click();
  await page.waitForURL(/\/searches\/new/);

  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Operations Director search");
  await expect(page.getByLabel(/Job titles/)).toHaveValue(
    "Operations Director, Head of Operations, Plant Director"
  );
  await expect(page.getByLabel(/Other filter notes/)).toHaveValue(
    "Target companies: Mid-size manufacturers, Automotive tier-1 suppliers"
  );
  const linkedRole = page.getByLabel(/Linked role/);
  await expect(linkedRole).toHaveValue(roleId);

  await page.getByLabel(/Locations/).fill("United Kingdom");
  await page.getByLabel(/Industries/).fill("Manufacturing");
  await page.getByRole("button", { name: "Create search" }).click();
  await page.waitForURL(`**/roles/${roleId}`);

  const card = page.locator("li.card", { hasText: "Operations Director search" });
  await expect(card.getByText("never run")).toBeVisible();
  await expect(card.getByText("Location: United Kingdom")).toBeVisible();
  await expect(card.getByText("Industry: Manufacturing")).toBeVisible();
});

test("06 run search opens LinkedIn with keywords and records last-run", async ({ page }) => {
  await page.goto(`/roles/${roleId}`);
  const card = page.locator("li.card", { hasText: "Operations Director search" });
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    card.getByRole("button", { name: "Run search" }).click(),
  ]);
  await popup.waitForURL(/linkedin\.com/);
  const url = new URL(popup.url());
  expect(url.hostname).toBe("www.linkedin.com");
  expect(url.pathname).toBe("/search/results/people/");
  expect(url.searchParams.get("keywords")).toBe(
    "Operations Director Head of Operations Plant Director"
  );
  await popup.close();

  // The "last run today" label should appear without a manual reload.
  try {
    await expect(card.getByText("last run today")).toBeVisible({ timeout: 7_000 });
  } catch {
    note(
      "last-run-not-live",
      "After clicking Run search, the 'last run today' label did not appear until the page was manually reloaded — markSearchUsed's revalidation does not refresh the page the recruiter is looking at."
    );
    await page.reload();
    await expect(card.getByText("last run today")).toBeVisible();
  }
});

test("07 searches list: copy, rename, delete", async ({ page }) => {
  await page.goto("/searches");
  const original = page.locator("li.card", { hasText: "Operations Director search" }).first();
  await original.getByRole("button", { name: "Copy" }).click();
  const copy = page.locator("li.card", { hasText: "Operations Director search (copy)" });
  await expect(copy).toBeVisible();

  // Copy should be independent and not inherit the last-run timestamp.
  if (await copy.getByText(/last run/).isVisible().catch(() => false)) {
    note("copy-inherits-lastrun", "Duplicating a search copies the original's last-run timestamp.");
  } else {
    await expect(copy.getByText("never run")).toBeVisible();
  }

  await copy.locator("summary", { hasText: "Rename" }).click();
  await copy.getByLabel("New name").fill("Ops Director copy renamed");
  await copy.getByRole("button", { name: "Rename" }).click();
  const renamed = page.locator("li.card", { hasText: "Ops Director copy renamed" });
  await expect(renamed).toBeVisible();

  await renamed.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("li.card", { hasText: "Ops Director copy renamed" })).toHaveCount(0);
  await expect(page.locator("li.card", { hasText: "Operations Director search" })).toHaveCount(1);
});

test("08 add candidates and open a profile", async ({ page }) => {
  await page.goto(`/roles/${roleId}`);
  const add = async (name: string, url: string, headline: string) => {
    await page.locator("#new-fullName").fill(name);
    await page.locator("#new-profileUrl").fill(url);
    await page.locator("#new-headline").fill(headline);
    await page.getByRole("button", { name: "Add candidate" }).click();
    await expect(page.locator("li.card", { hasText: name })).toBeVisible();
  };
  await add("Alice Example", "https://www.linkedin.com/in/alice-example", "Ops Director at Widgets Ltd");
  await add("Bob Sample", "https://www.linkedin.com/in/bob-sample", "Head of Operations, Gears plc");
  await add("Cara Test", "https://www.linkedin.com/in/cara-test", "Plant Director, Cogs Co");

  await expect(page.getByRole("heading", { name: "Sourced (3)" })).toBeVisible();

  const aliceCard = page.locator("li.card", { hasText: "Alice Example" });
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    aliceCard.getByRole("link", { name: "Open profile" }).click(),
  ]);
  await popup.waitForURL(/linkedin\.com\/in\/alice-example/);
  await popup.close();
});

test("09 stage dropdown moves a candidate and updates grouping", async ({ page }) => {
  await page.goto(`/roles/${roleId}`);
  const aliceCard = page.locator("li.card", { hasText: "Alice Example" });
  await aliceCard.getByRole("combobox").selectOption("contacted");
  await aliceCard.getByRole("button", { name: "Set stage" }).click();
  await expect(page.getByRole("heading", { name: "Contacted (1)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sourced (2)" })).toBeVisible();
  await expect(
    page.locator("li.card", { hasText: "Alice Example" }).getByText("last activity today")
  ).toBeVisible();
});

test("10 create a message template", async ({ page }) => {
  await page.goto("/templates");
  await page.locator("#new-tname").fill("First outreach");
  await page
    .locator("#new-tbody")
    .fill(
      "Hi {{first_name}}, I'm hiring for a {{role_title}} and your background stood out. Fancy a quick chat? Grab a time: {{calendar_link}}"
    );
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.getByRole("heading", { name: "First outreach" })).toBeVisible();
  await expect(page.locator("mark", { hasText: "{{first_name}}" })).toBeVisible();
});

test("11 draft outreach: placeholders fill, copy works, mark as sent logs it", async ({ page }) => {
  await page.goto(`/roles/${roleId}`);
  await page
    .locator("li.card", { hasText: "Bob Sample" })
    .getByRole("link", { name: "Draft outreach" })
    .click();
  await page.waitForURL(/\/outreach/);

  // "a {{role_title}}" is corrected to "an" so it agrees with what was substituted.
  const expected = `Hi Bob, I'm hiring for an Operations Director and your background stood out. Fancy a quick chat? Grab a time: ${CALENDAR}`;
  await expect(page.getByText("Hi Bob, I'm hiring")).toBeVisible();
  const preview = await page
    .locator("section[aria-label='Message preview'] div.whitespace-pre-wrap")
    .innerText();
  expect(preview).toBe(expected);
  expect(preview).not.toContain("[MISSING");
  expect(preview).not.toContain("a Operations Director");

  await page.getByRole("button", { name: "Copy message" }).click();
  await expect(page.getByText("Copied", { exact: true })).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(expected);

  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByRole("heading", { name: "Past outreach" })).toBeVisible();
  await expect(page.getByText("Sent today")).toBeVisible();
  const badge = page.locator("p", { hasText: "Bob Sample" }).locator(".chip");
  await expect(badge).toContainText("Contacted");
});

test("12 missing calendar link shows a gap and blocks marking it sent", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Calendar link").fill("");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.locator("[data-form-message='notice']")).toContainText("Settings saved");

  const bob = await db.candidate.findFirst({ where: { fullName: "Bob Sample" } });
  const logsBefore = await db.outreachLog.count({ where: { candidateId: bob!.id } });
  await page.goto(`/candidates/${bob!.id}/outreach`);
  await expect(page.getByText("[MISSING: calendar_link]")).toBeVisible();
  await expect(page.locator("p[role='alert']")).toContainText("still has gaps");

  // A broken message can no longer be recorded as sent.
  await expect(page.getByRole("button", { name: "Mark as sent" })).toBeDisabled();
  expect(await db.outreachLog.count({ where: { candidateId: bob!.id } })).toBe(logsBefore);

  // Copying is still allowed, but says the message is not finished.
  await page.getByRole("button", { name: "Copy message" }).click();
  await expect(page.getByText("Copied, but it still has gaps")).toBeVisible();

  await page.goto("/settings");
  await page.getByLabel("Calendar link").fill(CALENDAR);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.locator("[data-form-message='notice']")).toContainText("Settings saved");

  // With the link restored the button comes back.
  await page.goto(`/candidates/${bob!.id}/outreach`);
  await expect(page.getByRole("button", { name: "Mark as sent" })).toBeEnabled();
});

test("13 follow-up buckets fill from stages and backdated timestamps", async ({ page }) => {
  // Alice -> replied (immediate bucket).
  await page.goto(`/roles/${roleId}`);
  const alice = page.locator("li.card", { hasText: "Alice Example" });
  await alice.getByRole("combobox").selectOption("replied");
  await alice.getByRole("button", { name: "Set stage" }).click();
  await expect(page.getByRole("heading", { name: "Replied (1)" })).toBeVisible();

  // Bob -> booking_pending, backdated 3 days.
  const bob = page.locator("li.card", { hasText: "Bob Sample" });
  await bob.getByRole("combobox").selectOption("booking_pending");
  await bob.getByRole("button", { name: "Set stage" }).click();
  await expect(page.getByRole("heading", { name: "Booking pending (1)" })).toBeVisible();
  await backdateCandidate("Bob Sample", { lastActivityAt: daysAgo(3) });

  // Cara -> contacted, backdated 6 days.
  const cara = page.locator("li.card", { hasText: "Cara Test" });
  await cara.getByRole("combobox").selectOption("contacted");
  await cara.getByRole("button", { name: "Set stage" }).click();
  await expect(page.getByRole("heading", { name: "Contacted (1)" })).toBeVisible();
  await backdateCandidate("Cara Test", { lastActivityAt: daysAgo(6) });

  await page.goto("/followups");
  const repliedBucket = page.getByRole("region", { name: "Replied, waiting on you" });
  await expect(repliedBucket.getByText("Alice Example")).toBeVisible();
  const bookingBucket = page.getByRole("region", { name: "Said yes, never booked" });
  await expect(bookingBucket.getByText("Bob Sample")).toBeVisible();
  await expect(bookingBucket.getByText("3 days ago")).toBeVisible();
  const quietBucket = page.getByRole("region", { name: "Went quiet" });
  await expect(quietBucket.getByText("Cara Test")).toBeVisible();
  await expect(quietBucket.getByText("6 days ago")).toBeVisible();
});

test("14 bucket row actions, the double-nudge guard, and nudging a booking", async ({ page }) => {
  await page.goto("/followups");
  const bookingBucket = page.getByRole("region", { name: "Said yes, never booked" });
  const quietBucket = page.getByRole("region", { name: "Went quiet" });
  const repliedBucket = page.getByRole("region", { name: "Replied, waiting on you" });

  // Mark booked clears the row.
  await bookingBucket
    .locator("li.card", { hasText: "Bob Sample" })
    .getByRole("button", { name: "Mark booked" })
    .click();
  await expect(bookingBucket.getByText("Bob Sample")).toHaveCount(0);
  let bobDb = await db.candidate.findFirst({ where: { fullName: "Bob Sample" } });
  expect(bobDb!.stage).toBe("booked");

  // Put Bob back to booking_pending (backdated) and nudge him via outreach.
  await db.candidate.update({
    where: { id: bobDb!.id },
    data: { stage: "booking_pending", lastActivityAt: daysAgo(3) },
  });
  await page.reload();
  await bookingBucket
    .locator("li.card", { hasText: "Bob Sample" })
    .getByRole("link", { name: "Draft nudge" })
    .click();
  await page.waitForURL(/\/outreach/);
  await markAsSent(page);
  // Chasing a booking must not undo the fact that they said yes.
  bobDb = await db.candidate.findFirst({ where: { fullName: "Bob Sample" } });
  expect(bobDb!.stage).toBe("booking_pending");
  expect(bobDb!.nudgeCount).toBe(1);
  // The chase timer resets, so they drop out of the bucket for now...
  await page.goto("/followups");
  await expect(bookingBucket.getByText("Bob Sample")).toHaveCount(0);
  // ...and come back still marked as having said yes once it lapses again.
  await backdateCandidate("Bob Sample", { lastActivityAt: daysAgo(3) });
  await page.reload();
  await expect(bookingBucket.getByText("Bob Sample")).toBeVisible();
  await expect(bookingBucket.getByText("Said yes, still no booking")).toBeVisible();

  // Cara: nudge, then verify she leaves 'Went quiet' and the guard holds.
  await page.goto("/followups");
  await quietBucket
    .locator("li.card", { hasText: "Cara Test" })
    .getByRole("link", { name: "Draft nudge" })
    .click();
  await page.waitForURL(/\/outreach/);
  await markAsSent(page);

  await page.goto("/followups");
  await expect(quietBucket.getByText("Cara Test")).toHaveCount(0);

  // Even if she has been quiet long enough again, a recent nudge keeps her out.
  await backdateCandidate("Cara Test", { lastActivityAt: daysAgo(6) });
  await page.reload();
  await expect(quietBucket.getByText("Cara Test")).toHaveCount(0);

  // Once the nudge itself is old, she returns, labelled with the nudge count.
  await backdateCandidate("Cara Test", { lastNudgeAt: daysAgo(6) });
  await page.reload();
  await expect(quietBucket.getByText("Cara Test")).toBeVisible();
  await expect(quietBucket.getByText("Contacted, nudged 1x, still quiet")).toBeVisible();

  // Replied bucket: 'They said yes' moves Alice out.
  await repliedBucket
    .locator("li.card", { hasText: "Alice Example" })
    .getByRole("button", { name: "They said yes" })
    .click();
  await expect(repliedBucket.getByText("Alice Example")).toHaveCount(0);
  const aliceDb = await db.candidate.findFirst({ where: { fullName: "Alice Example" } });
  expect(aliceDb!.stage).toBe("booking_pending");

  // Quiet bucket: 'They replied' moves Cara to the replied bucket.
  await quietBucket
    .locator("li.card", { hasText: "Cara Test" })
    .getByRole("button", { name: "They replied" })
    .click();
  await expect(quietBucket.getByText("Cara Test")).toHaveCount(0);
  await expect(repliedBucket.getByText("Cara Test")).toBeVisible();
});

test("15 home screen counts match the buckets", async ({ page }) => {
  // The walkthrough's claim is that the role card's number matches the buckets,
  // so derive it from Follow-ups rather than hard-coding it.
  await page.goto("/followups");
  const rows = page.locator("section li.card");
  const dueCount = await rows.count();

  // Bob still counts as a booking to chase: the nudge in test 14 must not have
  // demoted him out of "Said yes, never booked".
  await expect(
    page.getByRole("region", { name: "Said yes, never booked" }).getByText("Bob Sample")
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Replied, waiting on you" }).getByText("Cara Test")
  ).toBeVisible();
  expect(dueCount).toBe(2);

  await page.goto("/");
  const roleCard = page.locator("li", { hasText: "Operations Director" }).first();
  await expect(roleCard.getByText("3 candidates")).toBeVisible();
  await expect(roleCard.getByText(`${dueCount} to follow up today`)).toBeVisible();
});

test("16 an unsupported placeholder is flagged, not passed through", async ({ page }) => {
  await page.goto("/templates");
  await page.locator("#new-tname").fill("Broken template");
  await page.locator("#new-tbody").fill("Hi {{first_name}}, greetings from {{company}}.");
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.getByRole("heading", { name: "Broken template" })).toBeVisible();
  // The warning arrives while writing the template, not later in a message.
  await expect(page.locator("[data-form-message='notice']")).toContainText("{{company}}");

  const cara = await db.candidate.findFirst({ where: { fullName: "Cara Test" } });
  await page.goto(`/candidates/${cara!.id}/outreach`);
  await page.getByRole("link", { name: "Broken template" }).click();
  await expect(page.getByText("Hi Cara, greetings from")).toBeVisible();

  const preview = await page
    .locator("section[aria-label='Message preview'] div.whitespace-pre-wrap")
    .innerText();
  expect(preview).toContain("[UNKNOWN: company]");
  expect(preview).not.toContain("{{company}}");
  await expect(page.locator("p[role='alert']")).toContainText("still has gaps");
  await expect(page.getByRole("button", { name: "Mark as sent" })).toBeDisabled();
});

test("17 clearing a threshold is refused instead of silently defaulted", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Chase a booking after (days)").fill("3");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.locator("[data-form-message='notice']")).toContainText("Settings saved");
  await page.reload();
  await expect(page.getByLabel("Chase a booking after (days)")).toHaveValue("3");

  // Blanking the field must not quietly write the built-in default over it.
  await page.getByLabel("Chase a booking after (days)").fill("");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.locator("[data-form-message='error']")).toContainText("Chase a booking after");
  expect((await db.settings.findFirst())!.bookingChaseDays).toBe(3);
  await page.reload();
  await expect(page.getByLabel("Chase a booking after (days)")).toHaveValue("3");

  // A nonsense value never even reaches the server: min=1 stops it in the
  // browser, and the stored value is untouched either way.
  const quiet = page.getByLabel("Nudge quiet candidates after (days)");
  await quiet.fill("0");
  await page.getByRole("button", { name: "Save settings" }).click();
  expect(await quiet.evaluate((el) => (el as HTMLInputElement).checkValidity())).toBe(false);
  expect((await db.settings.findFirst())!.quietNudgeDays).toBe(5);

  await page.reload();
  await page.getByLabel("Chase a booking after (days)").fill("2");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.locator("[data-form-message='notice']")).toContainText("Settings saved");
});

test("18 compliance: the browser never talks to anything but the app and user-clicked tabs", async () => {
  const offenders = externalRequests.filter((u) => !/https:\/\/www\.linkedin\.com\//.test(u));
  if (offenders.length > 0) {
    note(
      "unexpected-external-requests",
      `The browser attempted requests to hosts other than the app and the user-clicked LinkedIn tabs: ${Array.from(new Set(offenders)).slice(0, 10).join(", ")}`
    );
  }
  expect(offenders).toEqual([]);
  // Every linkedin.com hit recorded came from an explicit popup (Run search /
  // Open profile); the app pages themselves made no cross-origin calls.
});
