import { test, expect, Page } from "@playwright/test";
import { db, note, TEST_ADMIN_ID } from "./helpers";
import { CONNECTION_NOTE_LIMIT } from "../lib/templates";

// Paths the happy-path walkthrough never visits: error states, bad input,
// and the side effects of deleting or closing things.

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.context().route(
    (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
    (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>blocked</title>" })
  );
  page.on("dialog", (d) => d.accept());
});

async function createRole(page: Page, title: string, jobDesc = "") {
  await page.goto("/roles/new");
  await page.getByLabel("Job title").fill(title);
  if (jobDesc) await page.getByLabel(/Job description/).fill(jobDesc);
  await page.getByRole("button", { name: "Create role" }).click();
  await page.waitForURL(/\/roles\/(?!new$)[^/]+$/, { timeout: 30_000 });
  return page.url().split("/roles/")[1];
}

test("E1 a role with no job description cannot start a briefing", async ({ page }) => {
  await createRole(page, "Empty Role");
  await expect(page.getByText("This role has no job description yet")).toBeVisible();

  // The page already knows it would fail, so the button says no up front
  // instead of reporting it after a round trip.
  const button = page.getByRole("button", { name: "Generate briefing" });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("title", /Add a job description/);
  await expect(page.getByRole("link", { name: "Add one first" })).toBeVisible();

  // Once a description exists the button comes back.
  await page.getByRole("link", { name: "Add one first" }).click();
  await page.waitForURL(/\/edit$/);
  await page.getByLabel("Job description").fill("Runs the warehouse and the team in it.");
  await page.getByRole("button", { name: "Save role" }).click();
  await expect(page.locator("[data-form-message='notice']")).toContainText("Role saved");
  await page.getByRole("link", { name: "Back to role" }).click();
  await expect(page.getByRole("button", { name: "Generate briefing" })).toBeEnabled();
});

test("E2 a malformed model response is reported, not half-saved", async ({ page }) => {
  const id = await createRole(page, "BADJSON Role", "Runs operations for a plant. BADJSON marker.");
  await page.getByRole("button", { name: "Generate briefing" }).click();
  await expect(page.locator("p[role='alert']")).toContainText("shape we could not read", {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(await db.briefing.count({ where: { roleId: id } })).toBe(0);
});

test("E3 whitespace-only required fields are reported, not silently dropped", async ({ page }) => {
  const before = await db.role.count();
  await page.goto("/roles/new");
  await page.getByLabel("Job title").fill("   ");
  await page.getByRole("button", { name: "Create role" }).click();
  await expect(page.locator("[data-form-message='error']")).toContainText("job title");
  expect(page.url()).toContain("/roles/new");
  expect(await db.role.count()).toBe(before);

  // The same guard on a template, whose body is a textarea and so has no
  // browser-side validation to fall back on.
  await page.goto("/templates");
  await page.locator("#new-tname").fill("  ");
  await page.locator("#new-tbody").fill("  ");
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.locator("[data-form-message='error']")).toContainText("name");
});

test("E4 a profile link pasted without https:// is normalised", async ({ page }) => {
  const id = await createRole(page, "Link Test Role", "A role for testing links.");
  await page.locator("#new-fullName").fill("Dana NoScheme");
  await page.locator("#new-profileUrl").fill("www.linkedin.com/in/dana-noscheme");
  await page.getByRole("button", { name: "Add candidate" }).click();
  const card = page.locator("li.card", { hasText: "Dana NoScheme" });
  await expect(card).toBeVisible();

  const stored = await db.candidate.findFirst({ where: { fullName: "Dana NoScheme" } });
  expect(stored!.profileUrl).toBe("https://www.linkedin.com/in/dana-noscheme");

  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    card.getByRole("link", { name: "Open profile" }).click(),
  ]);
  await popup.waitForURL(/linkedin\.com\/in\/dana-noscheme/);
  expect(new URL(popup.url()).hostname).toBe("www.linkedin.com");
  await popup.close();
  expect(id).toBeTruthy();
});

test("E4b a profile field that is not a link is never rendered as one", async ({ page }) => {
  const roleId = (await db.role.findFirst({ where: { title: "Link Test Role" } }))!.id;
  await page.goto(`/roles/${roleId}`);
  await page.locator("#new-fullName").fill("Gail NotAUrl");
  await page.locator("#new-profileUrl").fill("ask Priya for her profile");
  await page.getByRole("button", { name: "Add candidate" }).click();
  const card = page.locator("li.card", { hasText: "Gail NotAUrl" });
  await expect(card).toBeVisible();
  // The text is kept, but it must not become a dead link back into the app.
  await expect(card.getByRole("link", { name: "Open profile" })).toHaveCount(0);
  const stored = await db.candidate.findFirst({ where: { fullName: "Gail NotAUrl" } });
  expect(stored!.profileUrl).toBe("ask Priya for her profile");

  // A javascript: URL is likewise refused an href.
  await db.candidate.update({
    where: { id: stored!.id },
    data: { profileUrl: "javascript:alert(1)" },
  });
  await page.reload();
  await expect(card.getByRole("link", { name: "Open profile" })).toHaveCount(0);
});

test("E5 the same profile link twice on a role is refused", async ({ page }) => {
  const roleId = (await db.role.findFirst({ where: { title: "Link Test Role" } }))!.id;
  await page.goto(`/roles/${roleId}`);
  await page.locator("#new-fullName").fill("Evan Twice");
  await page.locator("#new-profileUrl").fill("https://www.linkedin.com/in/evan-twice");
  await page.getByRole("button", { name: "Add candidate" }).click();
  await expect(page.locator("li.card", { hasText: "Evan Twice" })).toHaveCount(1);

  // Second time, under a different name: same link, so same person.
  await page.locator("#new-fullName").fill("Evan T. Twice");
  await page.locator("#new-profileUrl").fill("https://www.linkedin.com/in/evan-twice");
  await page.getByRole("button", { name: "Add candidate" }).click();
  await expect(page.locator("[data-form-message='error']")).toContainText("already on this role");

  expect(
    await db.candidate.count({
      where: { roleId, profileUrl: "https://www.linkedin.com/in/evan-twice" },
    })
  ).toBe(1);

  // A repeated name with no link is allowed, but says so.
  await page.locator("#new-fullName").fill("Evan Twice");
  await page.locator("#new-profileUrl").fill("");
  await page.getByRole("button", { name: "Add candidate" }).click();
  await expect(page.locator("[data-form-message='notice']")).toContainText("already had someone called");
});

test("E6 deleting a role says what happens to its saved searches", async ({ page }) => {
  const roleId = await createRole(page, "Doomed Role", "Will be deleted.");
  await page.goto(`/searches/new?roleId=${roleId}`);
  await page.getByLabel("Name", { exact: true }).fill("Doomed Role search");
  await page.getByLabel(/Job titles/).fill("Doomed Title");
  await page.getByLabel(/Linked role/).selectOption(roleId);
  await page.getByRole("button", { name: "Create search" }).click();
  await page.waitForURL(`**/roles/${roleId}`);
  await expect(page.locator("li.card", { hasText: "Doomed Role search" })).toBeVisible();

  let confirmText = "";
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => {
    confirmText = d.message();
    d.accept();
  });
  await page.getByRole("button", { name: "Delete role" }).click();
  await page.waitForURL("**/");

  // The dialog must account for the search that outlives the role.
  expect(confirmText).toContain("Doomed Role");
  expect(confirmText).toMatch(/1 saved search is kept/);
  expect(confirmText).toContain("Ungrouped");

  expect(await db.role.count({ where: { id: roleId } })).toBe(0);
  const orphan = await db.savedSearch.findFirst({ where: { name: "Doomed Role search" } });
  expect(orphan!.roleId).toBeNull();

  await page.goto("/searches");
  const stray = page.locator("li.card", { hasText: "Doomed Role search" });
  await expect(stray).toBeVisible();
  await stray.getByRole("button", { name: "Delete" }).click();
});

test("E7 a closed role stays reachable and explains itself", async ({ page }) => {
  const roleId = await createRole(page, "Closing Role", "A role about to be closed.");
  await page.locator("#new-fullName").fill("Fiona Waiting");
  await page.getByRole("button", { name: "Add candidate" }).click();
  const card = page.locator("li.card", { hasText: "Fiona Waiting" });
  await card.getByRole("combobox").selectOption("replied");
  await card.getByRole("button", { name: "Set stage" }).click();

  await page.goto("/followups");
  await expect(page.getByText("Fiona Waiting")).toBeVisible();

  await page.goto(`/roles/${roleId}/edit`);
  await page.getByLabel("Status").selectOption("closed");
  await page.getByRole("button", { name: "Save role" }).click();
  await expect(page.locator("[data-form-message='notice']")).toContainText("Role saved");

  await page.goto("/followups");
  await expect(page.getByText("Fiona Waiting")).toHaveCount(0);

  // Off the open list, but findable and labelled rather than gone.
  await page.goto("/");
  const openList = page.locator("ul").first();
  await expect(openList.getByText("Closing Role")).toHaveCount(0);
  await page.getByText("Closed roles (1)").click();
  const closedEntry = page.locator("li", { hasText: "Closing Role" }).first();
  await expect(closedEntry.getByText("Closed - not in Follow-ups")).toBeVisible();
  await closedEntry.getByRole("link").first().click();
  await page.waitForURL(`**/roles/${roleId}`);

  await expect(page.getByRole("heading", { name: "Closing Role" })).toBeVisible();
  await expect(page.locator(".chip", { hasText: "Closed" }).first()).toBeVisible();
  await expect(page.getByText("hidden from Roles")).toBeVisible();
  await expect(page.getByRole("link", { name: "Reopen it" })).toBeVisible();
});

test("E8 a search keeps its link to a role that has been closed", async ({ page }) => {
  const closed = (await db.role.findFirst({ where: { title: "Closing Role" } }))!;
  expect(closed.status).toBe("closed");
  const search = await db.savedSearch.create({
    data: { userId: TEST_ADMIN_ID, name: "Closed role search", roleId: closed.id, titles: JSON.stringify(["Ops"]) },
  });

  await page.goto(`/searches/${search.id}/edit`);
  const linked = page.getByLabel(/Linked role/);
  // The closed role is still offered, still selected, and marked as closed.
  await expect(linked).toHaveValue(closed.id);
  await expect(linked.locator("option", { hasText: "closed" })).toHaveCount(1);

  await page.getByRole("button", { name: "Save search" }).click();
  await page.waitForURL("**/searches");

  const after = await db.savedSearch.findUnique({ where: { id: search.id } });
  expect(after!.roleId).toBe(closed.id);
  await db.savedSearch.delete({ where: { id: search.id } });
});

test("E9 outreach for a candidate with no template offers a way out", async ({ page }) => {
  const templates = await db.messageTemplate.findMany({ where: { userId: TEST_ADMIN_ID } });
  const backup = templates.map((t) => ({ ...t }));
  // Templates can go without touching the logs: OutreachLog.templateId is SetNull.
  await db.messageTemplate.deleteMany({ where: { userId: TEST_ADMIN_ID } });

  const dana = await db.candidate.findFirst({ where: { fullName: "Dana NoScheme" } });
  await page.goto(`/candidates/${dana!.id}/outreach`);
  await expect(page.getByText("You have no message templates yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create one first" })).toBeVisible();

  for (const t of backup) {
    await db.messageTemplate.create({
      data: { ...t },
    });
  }
});

test("E10 an outreach log survives deleting the template it came from", async ({ page }) => {
  const cara = await db.candidate.findFirst({ where: { fullName: "Cara Test" } });
  await page.goto(`/candidates/${cara!.id}/outreach`);
  const entries = page.locator("section[aria-label='Past outreach'] li");
  const before = await entries.count();
  expect(before).toBeGreaterThan(0);

  await page.goto("/templates");
  await page
    .locator("li.card", { hasText: "Broken template" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.getByRole("heading", { name: "Broken template" })).toHaveCount(0);

  await page.goto(`/candidates/${cara!.id}/outreach`);
  await expect(entries).toHaveCount(before);
});

test("E11 outreach history shows a count and reveals the older messages", async ({ page }) => {
  const cara = await db.candidate.findFirst({ where: { fullName: "Cara Test" } });
  for (let i = 0; i < 4; i++) {
    await db.outreachLog.create({
      data: { candidateId: cara!.id, renderedBody: `Filler message ${i}` },
    });
  }
  const total = await db.outreachLog.count({ where: { candidateId: cara!.id } });
  expect(total).toBeGreaterThan(3);

  await page.goto(`/candidates/${cara!.id}/outreach`);
  await expect(page.getByRole("heading", { name: `Past outreach (${total})` })).toBeVisible();

  const older = total - 3;
  const disclosure = page.getByText(`Show ${older} older`);
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  await expect(page.locator("section[aria-label='Past outreach'] li")).toHaveCount(total);
});

test("E12 your name from Settings fills a sign-off placeholder", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel(/Your name/).fill("Alex Recruiter");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.locator("[data-form-message='notice']")).toContainText("Settings saved");

  await page.goto("/templates");
  // The page advertises the gap it can fill.
  await expect(page.getByText("{{recruiter_name}}").first()).toBeVisible();
  await page.locator("#new-tname").fill("Sign-off");
  await page.locator("#new-tbody").fill("Hi {{first_name}}, best regards, {{recruiter_name}}");
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.getByRole("heading", { name: "Sign-off" })).toBeVisible();
  // It is a known gap, so it is highlighted rather than warned about.
  await expect(page.locator("mark", { hasText: "{{recruiter_name}}" })).toBeVisible();
  await expect(page.locator("[data-form-message='notice']")).not.toContainText("UNKNOWN");

  const cara = await db.candidate.findFirst({ where: { fullName: "Cara Test" } });
  await page.goto(`/candidates/${cara!.id}/outreach`);
  await page.getByRole("link", { name: "Sign-off" }).click();
  const preview = await page
    .locator("section[aria-label='Message preview'] div.whitespace-pre-wrap")
    .innerText();
  expect(preview).toBe("Hi Cara, best regards, Alex Recruiter");
  await expect(page.getByRole("button", { name: "Mark as sent" })).toBeEnabled();

  // An empty name behaves like any other unfilled gap.
  await page.goto("/settings");
  await page.getByLabel(/Your name/).fill("");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.locator("[data-form-message='notice']")).toContainText("Settings saved");
  await page.goto(`/candidates/${cara!.id}/outreach?template=${(await db.messageTemplate.findFirst({ where: { name: "Sign-off" } }))!.id}`);
  await expect(page.getByText("[MISSING: recruiter_name]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as sent" })).toBeDisabled();
});

test("E13 a connection note is length-checked and its channel is recorded", async ({ page }) => {
  await page.goto("/templates");
  await page.locator("#new-tname").fill("Invite note");
  await page.locator("#new-t-kind").selectOption("connection_note");

  // Over the cap: the counter turns and the save is refused.
  const tooLong = "Hi {{first_name}}, ".padEnd(CONNECTION_NOTE_LIMIT + 40, "x");
  await page.locator("#new-tbody").fill(tooLong);
  await expect(page.getByText(`${tooLong.length} / ${CONNECTION_NOTE_LIMIT}`)).toBeVisible();
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.locator("[data-form-message='error']")).toContainText("over the");
  expect(await db.messageTemplate.count({ where: { name: "Invite note" } })).toBe(0);

  // Within the cap: it saves, and says which door it uses.
  await page.locator("#new-t-kind").selectOption("connection_note");
  await page.locator("#new-tbody").fill("Hi {{first_name}}, quick intro about a {{role_title}} role - open to a chat?");
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.getByRole("heading", { name: "Invite note" })).toBeVisible();
  const saved = await db.messageTemplate.findFirst({ where: { name: "Invite note" } });
  expect(saved!.kind).toBe("connection_note");

  const card = page.locator("li.card", { hasText: "Invite note" });
  await expect(card.locator(".chip", { hasText: "Connection note" })).toBeVisible();
});

test("E14 the pipeline records which door each message went through", async ({ page }) => {
  const dana = await db.candidate.findFirst({ where: { fullName: "Dana NoScheme" } });
  const invite = await db.messageTemplate.findFirst({ where: { name: "Invite note" } });

  await page.goto(`/candidates/${dana!.id}/outreach?template=${invite!.id}`);
  await expect(page.getByText("Sent as a connection note.")).toBeVisible();
  // The count is of the rendered text, not the template.
  const preview = await page
    .locator("section[aria-label='Message preview'] div.whitespace-pre-wrap")
    .innerText();
  await expect(
    page.getByText(`${preview.length} / ${CONNECTION_NOTE_LIMIT}`)
  ).toBeVisible();

  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByRole("heading", { name: /Past outreach/ })).toBeVisible();

  const log = await db.outreachLog.findFirst({
    where: { candidateId: dana!.id },
    orderBy: { sentAt: "desc" },
  });
  expect(log!.kind).toBe("connection_note");

  // "Contacted" alone was ambiguous; the candidate row now says how.
  await page.goto(`/roles/${dana!.roleId}`);
  const card = page.locator("li.card", { hasText: "Dana NoScheme" });
  await expect(card.getByText(/Invitation sent/)).toBeVisible();

  // The log keeps its channel even after the template is deleted.
  await db.messageTemplate.delete({ where: { id: invite!.id } });
  await page.goto(`/candidates/${dana!.id}/outreach`);
  await expect(
    page.locator("section[aria-label='Past outreach'] .chip", { hasText: "Connection note" }).first()
  ).toBeVisible();
});
