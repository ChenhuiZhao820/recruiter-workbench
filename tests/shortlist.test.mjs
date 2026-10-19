import test from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_SHORTLIST_DAYS,
  GATE_DAYS,
  accessOpens,
  canDecide,
  canOpenAnother,
  clientKey,
  countsTowardLimit,
  customExpiry,
  defaultShortlistTitle,
  emailMatches,
  gateCookieValue,
  hasInterviewHours,
  hasPriorConsent,
  interviewLinkState,
  itemVisible,
  newNonce,
  nonceMatches,
  normaliseEmail,
  parseDecision,
  parseEmailList,
  readGateCookie,
  readShortlistToken,
  shortlistSecret,
  shortlistStatus,
  shortlistToken,
} from "../lib/shortlist-core.mjs";

const SECRET = "s".repeat(40);
const DAY = 86_400_000;
const now = new Date("2026-10-17T12:00:00Z");
const accessId = "cm2x8k1q00001abcdxyz12345";

test("the link secret must be set and long enough", () => {
  assert.equal(shortlistSecret({}), null);
  assert.equal(shortlistSecret({ SHORTLIST_LINK_SECRET: "short" }), null);
  assert.equal(shortlistSecret({ SHORTLIST_LINK_SECRET: `  ${SECRET}  ` }), SECRET);
});

test("a link reads back only as issued, and a new nonce or another secret kills it", () => {
  const nonce = newNonce();
  assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(newNonce(), nonce);
  const token = shortlistToken(SECRET, accessId, nonce);
  assert.deepEqual(readShortlistToken(SECRET, token), { accessId, nonce });
  assert.equal(shortlistToken(SECRET, accessId, nonce), token, "copying again gives the same link");

  assert.equal(readShortlistToken(null, token), null);
  assert.equal(readShortlistToken("t".repeat(40), token), null);
  const [, , signature] = token.split(".");
  assert.equal(readShortlistToken(SECRET, `${accessId.replace(/.$/, "6")}.${nonce}.${signature}`), null, "moved to another access");
  assert.equal(readShortlistToken(SECRET, `${accessId}.${newNonce()}.${signature}`), null, "another nonce");
  assert.equal(readShortlistToken(SECRET, `${token}x`), null);
  assert.equal(readShortlistToken(SECRET, "x".repeat(300)), null);
  assert.equal(readShortlistToken(SECRET, undefined), null);

  // The signature only proves the pair was issued; the stored nonce decides
  // whether it is still the current link.
  assert.equal(nonceMatches(nonce, nonce), true);
  assert.equal(nonceMatches(newNonce(), nonce), false);
  assert.equal(nonceMatches(null, nonce), false);
});

test("named people: emails are normalised, listed once, and matched exactly", () => {
  assert.equal(normaliseEmail("  Hiring@Halden.Example "), "hiring@halden.example");
  assert.equal(normaliseEmail("not an email"), null);
  assert.equal(normaliseEmail("a@b"), null);
  const list = parseEmailList("Ana@halden.example, ana@halden.example;\nben@halden.example  oops");
  assert.deepEqual(list, { emails: ["ana@halden.example", "ben@halden.example"], invalid: ["oops"], tooMany: false });
  const many = parseEmailList(Array.from({ length: 25 }, (_, i) => `p${i}@x.example`).join(","));
  assert.equal(many.emails.length, 20);
  assert.equal(many.tooMany, true);

  assert.equal(emailMatches("ana@halden.example", " ANA@halden.example "), true);
  assert.equal(emailMatches("ana@halden.example", "ana@halden.example.evil"), false);
  assert.equal(emailMatches(null, "ana@halden.example"), false);
  assert.equal(emailMatches("ana@halden.example", ""), false);
});

test("the browser stays in for GATE_DAYS, and only for that access and nonce", () => {
  const nonce = newNonce();
  const value = gateCookieValue(SECRET, accessId, nonce, now);
  assert.equal(readGateCookie(SECRET, accessId, nonce, value, now), true);
  assert.equal(readGateCookie(SECRET, accessId, nonce, value, new Date(now.getTime() + (GATE_DAYS - 1) * DAY)), true);
  assert.equal(readGateCookie(SECRET, accessId, nonce, value, new Date(now.getTime() + GATE_DAYS * DAY)), false);
  assert.equal(readGateCookie(SECRET, accessId, newNonce(), value, now), false, "New link ends it");
  assert.equal(readGateCookie(SECRET, "cm2x8k1q00001abcdxyz99999", nonce, value, now), false);
  assert.equal(readGateCookie(SECRET, accessId, nonce, value.replace(/^\d+/, (d) => String(Number(d) + 5)), now), false, "a later day cannot be forged");
  assert.equal(readGateCookie(null, accessId, nonce, value, now), false);
  assert.equal(readGateCookie(SECRET, accessId, nonce, "junk", now), false);
});

const openRole = { id: "role1", status: "open" };

test("status: role links follow the role, custom shortlists expire, revoking wins", () => {
  assert.equal(shortlistStatus({ kind: "role", roleId: "role1" }, openRole, now), "active");
  assert.equal(shortlistStatus({ kind: "role", roleId: "role1" }, { ...openRole, status: "closed" }, now), "closed");
  assert.equal(shortlistStatus({ kind: "role", roleId: "role1" }, null, now), "closed");
  assert.equal(shortlistStatus({ kind: "custom", expiresAt: customExpiry(now) }, null, now), "active");
  assert.equal(customExpiry(now).getTime() - now.getTime(), CUSTOM_SHORTLIST_DAYS * DAY);
  assert.equal(shortlistStatus({ kind: "custom", expiresAt: now }, null, now), "expired");
  assert.equal(shortlistStatus({ kind: "custom", expiresAt: null }, null, now), "expired");
  assert.equal(shortlistStatus({ kind: "role", revokedAt: now }, openRole, now), "revoked");
  assert.equal(shortlistStatus({ kind: "custom", revokedAt: now, expiresAt: customExpiry(now) }, null, now), "revoked");
});

test("the limit counts active custom shortlists only and never closes a link already sent", () => {
  const lists = [
    { kind: "role", roleId: "role1" },
    { kind: "custom", expiresAt: customExpiry(now) },
    { kind: "custom", expiresAt: customExpiry(now) },
    { kind: "custom", expiresAt: new Date(now.getTime() - DAY) },
    { kind: "custom", expiresAt: customExpiry(now), revokedAt: now },
  ];
  const active = lists.filter((list) => countsTowardLimit(list, now)).length;
  assert.equal(active, 2);
  assert.equal(canOpenAnother(active, 3), true);
  assert.equal(canOpenAnother(3, 3), false);
  assert.equal(canOpenAnother(7, null), true);
  // Over the limit after a downgrade: nothing new, but what exists stays active.
  assert.equal(canOpenAnother(5, 3), false);
  assert.equal(shortlistStatus(lists[1], null, now), "active");
});

test("an access opens its shortlist only in the shortlist's current mode", () => {
  const anyone = { email: null };
  const named = { email: "ana@halden.example" };
  assert.equal(accessOpens(anyone, { access: "link" }), true);
  assert.equal(accessOpens(named, { access: "link" }), false);
  assert.equal(accessOpens(named, { access: "people" }), true);
  assert.equal(accessOpens(anyone, { access: "people" }), false);
  assert.equal(accessOpens({ ...named, revokedAt: now }, { access: "people" }), false);
  assert.equal(accessOpens(null, { access: "link" }), false);
});

test("who is visible: do not contact, rejected and moved candidacies leave the page", () => {
  const person = { id: "p1", doNotContact: false };
  const candidate = { id: "c1", roleId: "role1", personId: "p1", stage: "submitted" };
  const item = { personId: "p1", candidateId: "c1", consentAt: now };
  const roleList = { kind: "role", roleId: "role1" };
  assert.equal(itemVisible({ shortlist: roleList, item, person, candidate }), true);
  assert.equal(itemVisible({ shortlist: roleList, item, person: { ...person, doNotContact: true }, candidate }), false);
  assert.equal(itemVisible({ shortlist: roleList, item, person, candidate: { ...candidate, stage: "rejected" } }), false);
  assert.equal(itemVisible({ shortlist: roleList, item, person, candidate: { ...candidate, roleId: "role2" } }), false);
  assert.equal(itemVisible({ shortlist: roleList, item: { ...item, candidateId: null }, person, candidate: null }), false);
  assert.equal(itemVisible({ shortlist: roleList, item: { ...item, consentAt: null }, person, candidate }), false);
  assert.equal(itemVisible({ shortlist: roleList, item: { ...item, personId: "p2" }, person, candidate }), false);
  // A custom shortlist is about the person, not one candidacy.
  const custom = { kind: "custom" };
  assert.equal(itemVisible({ shortlist: custom, item: { ...item, candidateId: null }, person, candidate: null }), true);
  assert.equal(itemVisible({ shortlist: custom, item, person, candidate: { ...candidate, stage: "rejected" } }), true);
  assert.equal(itemVisible({ shortlist: custom, item, person: { ...person, doNotContact: true }, candidate }), false);
});

test("one key per client, whatever the spelling, and a role of its own without one", () => {
  assert.equal(clientKey("Halden Systems Ltd", "r1"), "halden systems");
  assert.equal(clientKey("  HALDEN   systems  limited. ", "r1"), "halden systems");
  assert.equal(clientKey("Marsh & Pike Group plc", "r1"), "marsh and pike");
  assert.equal(clientKey("Zürich Re", "r1"), "zürich re");
  assert.equal(clientKey("", "r1"), "role:r1");
  assert.equal(clientKey(null, "r1"), "role:r1");
  assert.equal(clientKey("Ltd", "r1"), "ltd", "a name that is only a suffix is kept");

  const records = [{ client: "Halden Systems", at: now }, { client: "Other", at: null }];
  assert.equal(hasPriorConsent(records, "halden systems ltd"), true);
  assert.equal(hasPriorConsent(records, "Other"), false, "no date, no consent");
  assert.equal(hasPriorConsent(records, ""), false);
  assert.equal(hasPriorConsent([], "Halden"), false);
});

test("titles default to the client and the date", () => {
  assert.equal(defaultShortlistTitle("Halden Systems", now), "Halden Systems - 17 Oct 2026");
  assert.equal(defaultShortlistTitle(" ", now), "Shortlist - 17 Oct 2026");
});

test("a client decision is one of two, with an optional reason and a short note", () => {
  assert.deepEqual(parseDecision({ decision: "interview", reason: "salary", note: "x" }), { data: { decision: "interview", decisionReason: null, decisionNote: null } });
  assert.deepEqual(parseDecision({ decision: "declined", reason: "salary", note: "  Above   budget \n" }), { data: { decision: "declined", decisionReason: "salary", decisionNote: "Above budget" } });
  assert.deepEqual(parseDecision({ decision: "declined" }), { data: { decision: "declined", decisionReason: null, decisionNote: null } });
  assert.ok(parseDecision({ decision: "maybe" }).error);
  assert.ok(parseDecision({ decision: "declined", reason: "rude" }).error);
  assert.ok(parseDecision({ decision: "declined", note: "x".repeat(281) }).error);
  assert.equal(canDecide({ interviewBooked: false }), true);
  assert.equal(canDecide({ interviewBooked: true }), false);
});

test("an interview link exists only when everything it needs is true", () => {
  const role = {
    id: "role1",
    status: "open",
    clientReviewFirst: true,
    interviewWindows: JSON.stringify([{ day: 1, startMin: 540, endMin: 1020 }]),
    interviewTimezone: "Europe/London",
    interviewDurationMins: 45,
  };
  const candidate = { id: "c1", roleId: "role1", stage: "submitted" };
  const person = { doNotContact: false };
  const item = { candidateId: "c1", consentAt: now, decision: "interview" };
  const state = (overrides = {}) => interviewLinkState({ role, candidate, person, item, ...overrides }).reason;

  assert.equal(hasInterviewHours(role), true);
  assert.equal(state(), null);
  assert.equal(state({ role: { ...role, status: "closed" } }), "role_closed");
  assert.equal(state({ candidate: { ...candidate, stage: "rejected" } }), "candidate_closed");
  assert.equal(state({ candidate: { ...candidate, stage: "placed" } }), "candidate_closed");
  assert.equal(state({ candidate: { ...candidate, roleId: "role2" } }), "candidate_closed");
  assert.equal(state({ person: { doNotContact: true } }), "do_not_contact");
  assert.equal(state({ role: { ...role, interviewWindows: "[]" } }), "no_hours");
  assert.equal(state({ role: { ...role, interviewTimezone: "Mars/Olympus" } }), "no_hours");
  assert.equal(state({ role: { ...role, interviewDurationMins: null } }), "no_hours");
  assert.equal(state({ item: null }), "not_put_forward");
  assert.equal(state({ item: { ...item, candidateId: "c2" } }), "not_put_forward");
  assert.equal(state({ item: { ...item, decision: null } }), "awaiting_client");
  assert.equal(state({ item: { ...item, decision: "declined" } }), "awaiting_client");
  // The old "book straight away" switch is no longer read: the client's answer is still needed.
  assert.equal(state({ role: { ...role, clientReviewFirst: false }, item: { ...item, decision: null } }), "awaiting_client");
});
