import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PENDING_COUNTS_MS,
  allowanceStart,
  companyFromHeadline,
  countsAgainstAllowance,
  emailSourceLabel,
  enrowBase,
  finderTarget,
  lookupRequest,
  notFoundText,
  readResult,
  readStart,
  remainingText,
} from "../lib/enrow-core.mjs";

// The email finder's rules: what is sent to Enrow, how its replies read, and
// what counts against a plan's searches. No network: the requests themselves
// are played against the local stub in tests/31-email-finder.spec.ts.

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("only a test server's address replaces Enrow's, and never in production", () => {
  assert.equal(enrowBase({}), "https://api.enrow.io");
  assert.equal(enrowBase({ CAPTURE_TEST_ENROW_BASE_URL: "http://localhost:8766/enrow/" }), "http://localhost:8766/enrow");
  assert.equal(enrowBase({ NODE_ENV: "production", CAPTURE_TEST_ENROW_BASE_URL: "http://localhost:8766/enrow" }), "https://api.enrow.io");
});

test("a LinkedIn member profile is searched by its canonical address and nothing else", () => {
  assert.deepEqual(lookupRequest({ fullName: "Ada Lovelace", profileUrl: "uk.linkedin.com/in/Ada-L/?trk=x" }), {
    method: "linkedin", body: { linkedin_url: "https://www.linkedin.com/in/ada-l" },
  });
  // A typed company means the recruiter chose to search by name.
  assert.deepEqual(lookupRequest({ fullName: "Ada Lovelace", profileUrl: "https://www.linkedin.com/in/ada" }, " Analytical  Engines "), {
    method: "name", body: { fullname: "Ada Lovelace", company_name: "Analytical Engines" },
  });
  // A company page, another site, or a single name with no company: nothing to send.
  assert.equal(lookupRequest({ fullName: "Ada Lovelace", profileUrl: "https://www.linkedin.com/company/acme" }), null);
  assert.equal(lookupRequest({ fullName: "Ada Lovelace", profileUrl: "https://example.com/ada" }), null);
  assert.equal(lookupRequest({ fullName: "Ada", profileUrl: null }, "Acme"), null);
  assert.equal(lookupRequest({ fullName: "Ada Lovelace", profileUrl: null }, "x".repeat(121)), null);
});

test("a company is read from a headline only where it names one", () => {
  assert.equal(companyFromHeadline("Senior Product Manager at Halden Systems"), "Halden Systems");
  assert.equal(companyFromHeadline("Platform Engineer @Halden | ex-Google"), "Halden");
  assert.equal(companyFromHeadline("CTO at Basanite Ltd - hiring"), "Basanite Ltd");
  assert.equal(companyFromHeadline("Head of Data at Acme, London"), "Acme");
  assert.equal(companyFromHeadline("Head of data attribution"), null);
  assert.equal(companyFromHeadline("Freelance designer"), null);
  assert.equal(companyFromHeadline(null), null);
  assert.deepEqual(finderTarget({ id: "p1", fullName: "Imogen Achterberg", profileUrl: null, headline: "Lead at Halden" }), {
    personId: "p1", name: "Imogen", hasLinkedIn: false, companyGuess: "Halden",
  });
});

test("Enrow's replies: started, refused, out of credit, still running, found and not found", () => {
  assert.deepEqual(readStart(200, { id: "abc", credits_used: 1 }), { state: "started", id: "abc" });
  assert.deepEqual(readStart(400, { message: "invalid linkedin_url format" }), { state: "linkedin_refused" });
  assert.deepEqual(readStart(400, { message: "LinkedIn search suspended for this account" }), { state: "linkedin_refused" });
  assert.deepEqual(readStart(400, { message: "missing fullname" }), { state: "failed" });
  assert.deepEqual(readStart(402, { reason: "Not enough credits", success: false }), { state: "no_credits" });
  assert.deepEqual(readStart(401, { message: "Invalid API key" }), { state: "misconfigured" });
  assert.deepEqual(readStart(200, {}), { state: "failed" });

  assert.deepEqual(readResult(202, { qualification: "ongoing" }), { state: "pending" });
  assert.deepEqual(readResult(200, { email: " Ada@Example.COM ", qualification: "valid" }), { state: "found", email: "ada@example.com" });
  assert.deepEqual(readResult(200, { email: "not an email", qualification: "valid" }), { state: "not_found", reason: null });
  assert.deepEqual(readResult(200, { qualification: "invalid", linkedin_status: "no_current_company" }), { state: "not_found", reason: "no_current_company" });
  assert.deepEqual(readResult(200, { qualification: "invalid", linkedin_status: "something new" }), { state: "not_found", reason: null });
  assert.deepEqual(readResult(200, { qualification: "invalid", linkedin_status: "lookup_failed" }), { state: "failed" });
  assert.deepEqual(readResult(500, null), { state: "failed" });
  assert.equal(notFoundText("no_current_company", "linkedin").tryByName, true);
  assert.match(notFoundText(null, "name").text, /name and company/);
});

test("a month's searches start on the first of the UTC month; a trial's last the whole trial", () => {
  const now = new Date("2026-11-03T08:00:00Z");
  const created = new Date("2026-10-30T12:00:00Z");
  assert.equal(allowanceStart("pro", now, created).toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(allowanceStart("promax", now).toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(allowanceStart("trial", now, created).toISOString(), created.toISOString());
});

test("found searches count, recent pending ones hold a place, and nothing else is charged", () => {
  const now = new Date("2026-11-03T08:00:00Z");
  const at = (ms) => new Date(now.getTime() - ms);
  assert.equal(countsAgainstAllowance({ status: "found", createdAt: at(PENDING_COUNTS_MS * 10) }, now), true);
  assert.equal(countsAgainstAllowance({ status: "pending", createdAt: at(1000) }, now), true);
  assert.equal(countsAgainstAllowance({ status: "pending", createdAt: at(PENDING_COUNTS_MS + 1) }, now), false);
  assert.equal(countsAgainstAllowance({ status: "not_found", createdAt: at(1000) }, now), false);
  assert.equal(countsAgainstAllowance({ status: "failed", createdAt: at(1000) }, now), false);
  assert.equal(remainingText({ remaining: 12, quota: 250, trial: false }), "12 of 250 email searches left this month");
  assert.equal(remainingText({ remaining: 50, quota: 50, trial: true }), "50 of 50 email searches left in your trial");
  assert.equal(emailSourceLabel("finder"), "Found by Enrow, unverified");
  assert.equal(emailSourceLabel(null), "Added by you");
});

test("the plans' allowances are Pro 250, Pro Max 1,000 and the trial 50, and only Pro and up have the finder", async () => {
  const features = await read("lib/features.ts");
  assert.match(features, /emailFinder: "pro"/);
  assert.match(features, /emails: \{ none: 0, lite: 0, basic: 0, trial: 50, pro: 250, promax: 1000, admin: 1000 \}/);
});

test("the routes check the origin, refuse read-only views and claim the allowance in one serializable transaction", async () => {
  const start = await read("app/api/email-finder/route.ts");
  assert.match(start, /request\.headers\.get\("origin"\) !== appOrigin\(\)/);
  assert.match(start, /if \(readOnly\) return fail\(403/);
  assert.match(start, /canUseFeature\(user, "emailFinder"\) \|\| !canUseFeature\(owner, "emailFinder"\)/);
  assert.match(start, /person\.doNotContact/);
  assert.match(start, /isolationLevel: "Serializable"/);
  const poll = await read("app/api/email-finder/[id]/route.ts");
  assert.match(poll, /where: \{ id: params\.id, userId: user\.id \}/);
  assert.match(poll, /if \(readOnly\) return fail\(403/);
  // A found email never overwrites one the person already has.
  assert.match(await read("lib/email-finder.ts"), /where: \{ id: lookup\.personId, userId: lookup\.userId, email: null, doNotContact: false \}/);
});
