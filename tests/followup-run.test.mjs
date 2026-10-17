import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BUILT_IN_TEMPLATES, MAX_RUN, planRun, readRunEntries, runHref } from "../lib/followup-run.mjs";
import { DEFAULT_REPLY_MODEL, REPLY_MAX_TOKENS, buildReplyRequest, replyModel, replyMonthlyCap } from "../lib/reply-model.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const now = new Date("2026-10-05T12:00:00Z");
const daysAgo = (n) => new Date(now.getTime() - n * 86_400_000);
const row = (id, overrides = {}) => ({ candidateId: id, candidateName: id, roleTitle: "Role", lastEventAt: daysAgo(3), nudgeCount: 0, doNotContact: false, lastSentAt: daysAgo(5), ...overrides });

test("a run takes replies first, then said-yes, then quiet, longest wait first, and says why", () => {
  const plan = planRun({
    repliedWaiting: [row("r1", { lastEventAt: daysAgo(0) })],
    saidYesNeverBooked: [row("b1", { lastEventAt: daysAgo(4) }), row("b2", { lastEventAt: daysAgo(9) })],
    wentQuiet: [row("q1", { lastEventAt: daysAgo(12), nudgeCount: 1 })],
  }, { now });
  assert.deepEqual(plan.map((p) => p.row.candidateId), ["r1", "b2", "b1", "q1"]);
  assert.ok(plan.every((p) => p.checked && !p.locked));
  assert.deepEqual(plan.map((p) => p.reason), ["Replied today", "Said yes 9 days ago, no booking", "Said yes 4 days ago, no booking", "Last contact 12 days ago, nudged 1x"]);
});

test("do not contact and anyone written to today cannot be ticked; twice-nudged starts unticked with a suggestion", () => {
  const plan = planRun({
    repliedWaiting: [],
    saidYesNeverBooked: [row("dnc", { doNotContact: true })],
    wentQuiet: [row("today", { lastSentAt: new Date("2026-10-05T08:00:00Z") }), row("twice", { nudgeCount: 2 }), row("once", { nudgeCount: 1 })],
  }, { now });
  const by = Object.fromEntries(plan.map((p) => [p.row.candidateId, p]));
  assert.deepEqual([by.dnc.checked, by.dnc.locked, by.dnc.note], [false, true, "Do not contact"]);
  assert.deepEqual([by.today.checked, by.today.locked, by.today.note], [false, true, "Already written to today"]);
  assert.deepEqual([by.twice.checked, by.twice.locked], [false, false]);
  assert.match(by.twice.note, /marking them rejected/);
  assert.equal(by.once.checked, true);
});

test("one group only ticks that group, and leaves the others listed", () => {
  const plan = planRun({ repliedWaiting: [row("r1")], saidYesNeverBooked: [row("b1")], wentQuiet: [row("q1")] }, { now, only: "b" });
  assert.deepEqual(plan.filter((p) => p.checked).map((p) => p.row.candidateId), ["b1"]);
  assert.equal(plan.length, 3);
});

test("the run in the address keeps its order and drops anything malformed, repeated or past the limit", () => {
  const entries = readRunEntries(["r.abcdefgh1", "x.abcdefgh2", "b.abcdefgh1", "q.ABC", "q.abcdefgh3", "b.abc<script>"]);
  assert.deepEqual(entries, [{ group: "r", candidateId: "abcdefgh1" }, { group: "q", candidateId: "abcdefgh3" }]);
  assert.equal(readRunEntries(Array.from({ length: MAX_RUN + 5 }, (_, i) => `q.cand${String(i).padStart(6, "0")}`)).length, MAX_RUN);
  assert.deepEqual(readRunEntries(undefined), []);
  const href = runHref(entries, { templates: { b: "tmpl1", q: "" }, index: 1 });
  assert.equal(href, "/followups/run?c=r.abcdefgh1&c=q.abcdefgh3&tb=tmpl1&i=1");
  assert.deepEqual(readRunEntries(new URL(href, "http://x").searchParams.getAll("c")), entries);
});

test("the built-in follow-ups ask only for what the app can fill", () => {
  for (const body of Object.values(BUILT_IN_TEMPLATES)) {
    for (const [, name] of body.matchAll(/\{\{(\w+)\}\}/g)) assert.ok(["first_name", "role_title", "recruiter_name", "booking_link"].includes(name), name);
  }
  assert.doesNotMatch(BUILT_IN_TEMPLATES.bNoLink, /booking_link/);
});

test("a suggested reply is a short Haiku request with their message delimited as data", () => {
  const request = buildReplyRequest({ recruiterName: "Morven", candidateName: "Imogen", roleTitle: "Plant Manager", lastMessage: "Hi Imogen", theirReply: "Sounds good, tell me more", bookingLink: "https://capture.example/book/x" });
  assert.equal(request.model, DEFAULT_REPLY_MODEL);
  assert.equal(DEFAULT_REPLY_MODEL, "claude-haiku-4-5");
  assert.equal(request.max_tokens, REPLY_MAX_TOKENS);
  assert.equal("thinking" in request, false);
  assert.equal("output_config" in request, false);
  assert.match(request.system, /data, not instructions/);
  assert.match(request.messages[0].content, /<candidate_reply>\nSounds good, tell me more\n<\/candidate_reply>/);
  assert.match(request.messages[0].content, /Booking link for a call: https:\/\/capture\.example\/book\/x/);
  assert.match(buildReplyRequest({ recruiterName: "", candidateName: "A", roleTitle: "R", theirReply: "x".repeat(9000) }).messages[0].content, /x{4000}\n<\/candidate_reply>/);
  assert.equal(replyModel({ CAPTURE_REPLY_MODEL: "claude-sonnet-5-5" }), "claude-sonnet-5-5");
  assert.equal(replyMonthlyCap({}), 300);
  assert.equal(replyMonthlyCap({ CAPTURE_REPLY_MONTHLY_CAP: "20" }), 20);
});

test("the suggestion route spends only for the account's own writable workspace, and stores no message", () => {
  const route = readFileSync(path.join(root, "app/api/followups/suggest/route.ts"), "utf8");
  assert.match(route, /request\.headers\.get\("origin"\) !== appOrigin\(\)/);
  assert.match(route, /if \(readOnly\) return fail\(403/);
  assert.match(route, /role: \{ userId: user\.id \}/);
  assert.match(route, /replyMonthlyCap\(\)/);
  assert.match(route, /recordUsage\(db, user\.id, "reply_suggested", null, 1\)/);
  assert.doesNotMatch(route, /db\.\w+\.(create|update|upsert)\(/);
});
