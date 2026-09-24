import { test, expect, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db, TEST_ADMIN_ID } from "./helpers";
import { INVITES_WEEK_NOTICE, INVITES_WEEK_WARNING, paceAdvice } from "../lib/pace";

// The guided queue: one shortlist, one template, one person at a time. These
// cover what it does (removes navigation, records what the recruiter says they
// sent) and what it must never do (send, open, paste or advance by itself).

test.describe.configure({ mode: "serial" });

let roleId = "";
let templateId = "";
let gapTemplateId = "";
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  const role = await db.role.create({
    data: { userId: TEST_ADMIN_ID, title: "Queue Test Director", client: "Queue Client" },
  });
  roleId = role.id;
  const people: [string, string, string][] = [
    ["Quinn Sourced", "sourced", "https://www.linkedin.com/in/quinn-sourced"],
    ["Rae Sourced", "sourced", "https://www.linkedin.com/in/rae-sourced"],
    ["Sam Contacted", "contacted", "https://www.linkedin.com/in/sam-contacted"],
    ["Tess Nolink", "sourced", ""],
  ];
  for (const [fullName, stage, profileUrl] of people) {
    const candidate = await db.candidate.create({
      data: {
        roleId: role.id,
        fullName,
        stage,
        profileUrl: profileUrl || null,
        // Only Rae was saved by the extension from a profile that carried
        // LinkedIn's member id, so only Rae can open the message box directly.
        memberId: fullName === "Rae Sourced" ? "ACoAAB1234xyz" : null,
      },
    });
    ids[fullName] = candidate.id;
  }
  const template = await db.messageTemplate.create({
    data: {
      userId: TEST_ADMIN_ID,
      name: "Queue opener",
      kind: "message",
      body: "Hi {{first_name}},\n\nI'm hiring for a {{role_title}}.\n\nBest,\n{{recruiter_name}}",
    },
  });
  templateId = template.id;
  const gapTemplate = await db.messageTemplate.create({
    data: {
      userId: TEST_ADMIN_ID,
      name: "Queue opener with a gap",
      kind: "message",
      body: "Hi {{first_name}}, grab a time: {{calendar_link}}",
    },
  });
  gapTemplateId = gapTemplate.id;
  await db.settings.updateMany({
    where: { userId: TEST_ADMIN_ID },
    data: { recruiterName: "Test Admin", calendarLink: "" },
  });
});

test.afterAll(async () => {
  await db.role.deleteMany({ where: { id: roleId } });
  await db.messageTemplate.deleteMany({ where: { id: { in: [templateId, gapTemplateId] } } });
});

function queueUrl(order: string[], template = templateId, index = 0): string {
  const params = new URLSearchParams();
  params.set("template", template);
  for (const name of order) params.append("c", ids[name]);
  params.set("i", String(index));
  return `/roles/${roleId}/outreach?${params.toString()}`;
}

async function sentCount(fullName: string): Promise<number> {
  return db.outreachLog.count({ where: { candidate: { id: ids[fullName] } } });
}

// The one click opens LinkedIn for real. Tests check the address it asked for,
// so LinkedIn is answered here instead of being allowed to redirect to its own
// login wall - which also keeps the suite off the network entirely.
async function blockLinkedIn(page: Page) {
  await page.context().route(
    (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
    (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" })
  );
}

test.describe("pace advice", () => {
  test("Q1 counts are stated plainly until invitations get interesting", () => {
    expect(paceAdvice({ sentToday: 1, invitesLast7Days: 3 }).tone).toBe("plain");
    expect(paceAdvice({ sentToday: 1, invitesLast7Days: INVITES_WEEK_NOTICE }).tone).toBe("notice");
    expect(paceAdvice({ sentToday: 1, invitesLast7Days: INVITES_WEEK_WARNING }).tone).toBe("warning");
    expect(paceAdvice({ sentToday: 1, invitesLast7Days: INVITES_WEEK_WARNING }).text).toMatch(/hundred a week/);
    // Singular and plural read as English, because this line is shown on every
    // screen of every run.
    expect(paceAdvice({ sentToday: 1, invitesLast7Days: 1 }).text).toContain("1 message logged today");
    expect(paceAdvice({ sentToday: 1, invitesLast7Days: 1 }).text).toContain("1 invitation in");
    expect(paceAdvice({ sentToday: 2, invitesLast7Days: 2 }).text).toContain("2 messages logged today");
    expect(paceAdvice({ sentToday: 2, invitesLast7Days: 2 }).text).toContain("2 invitations in");
  });
});

test("Q2 the shortlist ticks the untouched and leaves the already-contacted alone", async ({ page }) => {
  await page.goto(`/roles/${roleId}/outreach`);
  await expect(page.locator(`#c-${ids["Quinn Sourced"]}`)).toBeChecked();
  await expect(page.locator(`#c-${ids["Rae Sourced"]}`)).toBeChecked();
  await expect(page.locator(`#c-${ids["Sam Contacted"]}`)).not.toBeChecked();
  // A candidate with nowhere to send to is still offered, but says so.
  await expect(page.getByText("no profile link saved")).toBeVisible();
});

test("Q3 one person at a time, with the message already written for them", async ({ page }) => {
  await blockLinkedIn(page);
  await page.goto(queueUrl(["Quinn Sourced", "Rae Sourced"]));
  await expect(page.getByText("1 of 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quinn Sourced" })).toBeVisible();
  // The message is editable in place, so it lives in a box rather than as text.
  await expect(page.getByLabel("Message")).toHaveValue(
    "Hi Quinn,\n\nI'm hiring for a Queue Test Director.\n\nBest,\nTest Admin"
  );
  // No member id was read for this one, so the one click opens their profile.
  const open = page.getByRole("button", { name: "Copy and open profile" });
  await expect(open).toBeEnabled();
  const [profile] = await Promise.all([page.waitForEvent("popup"), open.click()]);
  expect(profile.url()).toBe("https://www.linkedin.com/in/quinn-sourced");
  await profile.close();
  // Nothing has been recorded merely by looking at it.
  expect(await sentCount("Quinn Sourced")).toBe(0);
});

test("Q3b a member id read by the extension opens the message box itself", async ({ page }) => {
  await blockLinkedIn(page);
  await page.goto(queueUrl(["Rae Sourced"]));
  const open = page.getByRole("button", { name: "Copy and open message box" });
  const [box] = await Promise.all([page.waitForEvent("popup"), open.click()]);
  // The recipient and nothing else: LinkedIn has no parameter for the body,
  // and this app does not type into anybody else's page.
  expect(box.url()).toBe("https://www.linkedin.com/messaging/compose/?recipient=ACoAAB1234xyz");
  await box.close();
  expect(await sentCount("Rae Sourced")).toBe(0);
});

test("Q4 marking as sent records it and moves on, and finishing says so", async ({ page }) => {
  await page.goto(queueUrl(["Quinn Sourced", "Rae Sourced"]));
  await page.getByRole("button", { name: "Mark as sent and next" }).click();
  await expect(page.getByText("2 of 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rae Sourced" })).toBeVisible();
  // The draft belongs to the person on screen. It is editable, so it is client
  // state, and moving on has to replace it rather than leave the last person's
  // message sitting under this one's name.
  await expect(page.getByLabel("Message")).toHaveValue(/^Hi Rae,/);

  const logged = await db.outreachLog.findFirst({ where: { candidateId: ids["Quinn Sourced"] } });
  expect(logged?.renderedBody).toBe(
    "Hi Quinn,\n\nI'm hiring for a Queue Test Director.\n\nBest,\nTest Admin"
  );
  expect(logged?.kind).toBe("message");
  const quinn = await db.candidate.findUnique({ where: { id: ids["Quinn Sourced"] } });
  expect(quinn?.stage).toBe("contacted");

  await page.getByRole("button", { name: "Mark as sent and finish" }).click();
  await expect(page.getByText("That is the whole shortlist.")).toBeVisible();
  expect(await sentCount("Rae Sourced")).toBe(1);
});

test("Q4b going back reaches the previous person, with their own message", async ({ page }) => {
  await page.goto(queueUrl(["Quinn Sourced", "Rae Sourced"], templateId, 1));
  await expect(page.getByRole("heading", { name: "Rae Sourced" })).toBeVisible();
  // The arrow at the corner of the card; its label is what it does.
  await page.getByRole("link", { name: "Back to Quinn" }).click();
  await expect(page.getByText("1 of 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quinn Sourced" })).toBeVisible();
  await expect(page.getByLabel("Message")).toHaveValue(/^Hi Quinn,/);
  // There is nobody before the first person, so nothing offers to go there.
  await expect(page.getByRole("link", { name: /^Back to/ })).toHaveCount(0);
  // The name is the way to their own page, so no separate control is needed.
  await expect(page.getByRole("link", { name: "Quinn Sourced" })).toHaveAttribute(
    "href",
    `/candidates/${ids["Quinn Sourced"]}/outreach`
  );
  await expect(page.getByRole("link", { name: "Open on their own page" })).toHaveCount(0);
});

test("Q5 skipping records nothing", async ({ page }) => {
  await page.goto(queueUrl(["Tess Nolink", "Sam Contacted"]));
  await expect(page.getByText("No profile link saved for this candidate.")).toBeVisible();
  await page.getByRole("link", { name: "Skip for now" }).click();
  await expect(page.getByRole("heading", { name: "Sam Contacted" })).toBeVisible();
  // Writing to someone already contacted is allowed, but never quietly.
  await expect(page.getByText(/Already contacted/)).toBeVisible();
  expect(await sentCount("Tess Nolink")).toBe(0);
});

test("Q6 a message with gaps cannot be recorded as sent", async ({ page }) => {
  await page.goto(queueUrl(["Tess Nolink"], gapTemplateId));
  await expect(page.getByLabel("Message")).toHaveValue(/\[MISSING: calendar_link\]/);
  await expect(page.getByRole("button", { name: "Mark as sent and finish" })).toBeDisabled();
  expect(await sentCount("Tess Nolink")).toBe(0);
});

test("Q7 the queue holds only this role's own candidates", async ({ page }) => {
  const stranger = await db.user.create({
    data: { email: `stranger-${randomUUID()}@test.capture.invalid`, name: "Stranger", role: "recruiter" },
  });
  const strangerRole = await db.role.create({ data: { userId: stranger.id, title: "Stranger role" } });
  const strangerCandidate = await db.candidate.create({
    data: { roleId: strangerRole.id, fullName: "Victor Stranger", stage: "sourced" },
  });
  try {
    const params = new URLSearchParams();
    params.set("template", templateId);
    params.append("c", strangerCandidate.id);
    params.append("c", "does-not-exist");
    await page.goto(`/roles/${roleId}/outreach?${params.toString()}`);
    // Falls back to picking a shortlist rather than showing a stranger.
    await expect(page.getByText("Victor Stranger")).toHaveCount(0);
    await expect(page.getByText("None of those candidates are on this role any more.")).toBeVisible();

    // And the action itself refuses the same id, not just the page.
    await page.goto(queueUrl(["Tess Nolink"]));
    await page.evaluate((id) => {
      const field = document.querySelector('input[name="candidateId"]') as HTMLInputElement;
      field.value = id;
    }, strangerCandidate.id);
    await page.getByRole("button", { name: "Mark as sent and finish" }).click();
    await expect(page.getByText("That is the whole shortlist.")).toBeVisible();
    expect(await db.outreachLog.count({ where: { candidateId: strangerCandidate.id } })).toBe(0);
  } finally {
    await db.candidate.deleteMany({ where: { id: strangerCandidate.id } });
    await db.role.deleteMany({ where: { id: strangerRole.id } });
    await db.user.deleteMany({ where: { id: stranger.id } });
  }
});

test("Q8 nothing sends, opens or advances by itself", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const host = new URL(request.url()).hostname;
    if (!["localhost", "127.0.0.1"].includes(host)) external.push(request.url());
  });
  await page.goto(queueUrl(["Sam Contacted", "Tess Nolink"]));
  await expect(page.getByText("1 of 2")).toBeVisible();
  const before = await db.outreachLog.count();

  // No control offers to do the whole list at once, and none of LinkedIn is
  // contacted by the page itself.
  for (const forbidden of [/open all/i, /send all/i, /send to everyone/i, /auto/i, /automatic/i]) {
    await expect(page.getByRole("button", { name: forbidden })).toHaveCount(0);
    await expect(page.getByRole("link", { name: forbidden })).toHaveCount(0);
  }
  expect(external).toEqual([]);

  // The pace line is on screen while the run is happening, not buried.
  await expect(page.getByText(/logged today, and .* in the last seven days/)).toBeVisible();

  // Waiting achieves nothing: the queue does not move on its own.
  await page.waitForTimeout(2_500);
  await expect(page.getByText("1 of 2")).toBeVisible();
  expect(await db.outreachLog.count()).toBe(before);
});

test("Q9 an administrator viewing somebody else's workspace can look but not record", async ({ page }) => {
  const other = await db.user.create({
    data: {
      email: `viewed-${randomUUID()}@test.capture.invalid`,
      name: "Viewed Recruiter",
      role: "recruiter",
      settings: { create: { recruiterName: "Viewed Recruiter" } },
    },
  });
  const otherRole = await db.role.create({ data: { userId: other.id, title: "Viewed role" } });
  const otherCandidate = await db.candidate.create({
    data: { roleId: otherRole.id, fullName: "Wes Viewed", stage: "sourced", profileUrl: "https://www.linkedin.com/in/wes-viewed" },
  });
  const otherTemplate = await db.messageTemplate.create({
    data: { userId: other.id, name: "Viewed opener", kind: "message", body: "Hi {{first_name}}, about the {{role_title}}." },
  });
  await db.session.updateMany({ where: { userId: TEST_ADMIN_ID }, data: { viewUserId: other.id } });
  try {
    const params = new URLSearchParams({ template: otherTemplate.id, i: "0" });
    params.append("c", otherCandidate.id);
    await page.goto(`/roles/${otherRole.id}/outreach?${params.toString()}`);
    await expect(page.getByRole("heading", { name: "Wes Viewed" })).toBeVisible();
    // Everything that would write is out of reach, and the profile link is not
    // a way around that either.
    await expect(page.getByRole("button", { name: "Mark as sent and finish" })).toBeDisabled();
    // The one control that copies and opens LinkedIn is out of reach too, so a
    // read-only view cannot start someone else's outreach from here.
    await expect(page.getByRole("button", { name: /^Copy and open/ })).toBeDisabled();
    expect(await db.outreachLog.count({ where: { candidateId: otherCandidate.id } })).toBe(0);
  } finally {
    await db.session.updateMany({ where: { userId: TEST_ADMIN_ID }, data: { viewUserId: null } });
    await db.candidate.deleteMany({ where: { id: otherCandidate.id } });
    await db.role.deleteMany({ where: { id: otherRole.id } });
    await db.messageTemplate.deleteMany({ where: { id: otherTemplate.id } });
    await db.settings.deleteMany({ where: { userId: other.id } });
    await db.user.deleteMany({ where: { id: other.id } });
  }
});

async function countVisibleChips(page: Page): Promise<number> {
  return page.locator('ol[aria-label="Shortlist"] li').count();
}

test("Q10 the progress list shows the whole run", async ({ page }) => {
  await page.goto(queueUrl(["Quinn Sourced", "Rae Sourced", "Tess Nolink"], templateId, 1));
  await expect(page.getByText("2 of 3")).toBeVisible();
  expect(await countVisibleChips(page)).toBe(3);
});
