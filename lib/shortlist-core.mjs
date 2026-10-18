import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isTimeZone, parseWindows } from "./booking-core.mjs";
import { DECISIONS, DECISION_NOTE_LIMIT, DECISION_REASONS } from "./shortlist-decisions.mjs";

export { DECISIONS, DECISION_NOTE_LIMIT, DECISION_REASONS, DECISION_REASON_LABELS } from "./shortlist-decisions.mjs";

// The rules for showing a client who the recruiter has found, shared by the app
// and the unit tests: the signed links, who may open them, which shortlists are
// active and count towards a cap, who is visible on one, what a client may
// decide, and when a candidate may be sent an interview link. Nothing here
// touches the database or the network.

export const CUSTOM_SHORTLIST_DAYS = 60;
export const GATE_DAYS = 30;
export const PITCH_LIMIT = 200;
export const EMAILS_PER_SHORTLIST = 20;
const DAY_MS = 86_400_000;
const CLOSED_STAGES = ["rejected", "placed"];

// --- Links ------------------------------------------------------------------
//
// /s/<accessId>.<nonce>.<signature>. The signature is an HMAC of the access and
// its stored nonce, keyed by SHORTLIST_LINK_SECRET, so the recruiter can copy a
// link again at any time without Capture keeping it, a copy of the database
// cannot mint one, and replacing the nonce kills the old address.

function sign(secret, accessId, nonce) {
  return createHmac("sha256", secret).update(`capture-shortlist:v1:${accessId}.${nonce}`).digest("base64url");
}

function same(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function shortlistSecret(env = process.env) {
  const secret = env.SHORTLIST_LINK_SECRET?.trim() ?? "";
  return secret.length >= 32 ? secret : null;
}

export function newNonce() {
  return randomBytes(16).toString("base64url");
}

export function shortlistToken(secret, accessId, nonce) {
  return `${accessId}.${nonce}.${sign(secret, accessId, nonce)}`;
}

// The access id and nonce of a genuine link, otherwise null. The caller still
// loads the access and checks the nonce with nonceMatches, which is what makes
// a replaced or revoked link stop working.
export function readShortlistToken(secret, token) {
  if (!secret || typeof token !== "string" || token.length > 200) return null;
  const match = token.match(/^([a-z0-9]{8,40})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/);
  if (!match) return null;
  const [, accessId, nonce, signature] = match;
  if (!same(sign(secret, accessId, nonce), signature)) return null;
  return { accessId, nonce };
}

export function nonceMatches(stored, given) {
  return typeof stored === "string" && typeof given === "string" && same(stored, given);
}

// --- Named people -----------------------------------------------------------
//
// "Only these people": each email has its own link, and whoever opens it types
// the email once per browser. It deters forwarding; it does not prove that the
// person reading owns the inbox, because Capture sends no code.

export function normaliseEmail(text) {
  const email = String(text ?? "").normalize("NFKC").trim().toLowerCase();
  return email.length <= 254 && /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(email) ? email : null;
}

// Emails typed into one box, separated by commas, semicolons or new lines.
// Duplicates count once; anything that is not an address is reported back.
export function parseEmailList(text) {
  const emails = [];
  const invalid = [];
  for (const part of String(text ?? "").split(/[\s,;]+/)) {
    if (!part) continue;
    const email = normaliseEmail(part);
    if (!email) invalid.push(part.slice(0, 80));
    else if (!emails.includes(email)) emails.push(email);
  }
  return { emails: emails.slice(0, EMAILS_PER_SHORTLIST), invalid, tooMany: emails.length > EMAILS_PER_SHORTLIST };
}

export function emailMatches(accessEmail, typed) {
  const want = normaliseEmail(accessEmail);
  const got = normaliseEmail(typed);
  return Boolean(want && got) && same(want, got);
}

// The cookie that keeps a browser in after the email matched: the issue day
// and an HMAC over the access, its nonce and that day, so "New link" and the
// passing of GATE_DAYS both end it.
function gateSignature(secret, accessId, nonce, day) {
  return createHmac("sha256", secret).update(`capture-shortlist-gate:v1:${accessId}.${nonce}.${day}`).digest("base64url");
}

export function gateCookieValue(secret, accessId, nonce, now = new Date()) {
  const day = Math.floor(now.getTime() / DAY_MS);
  return `${day}.${gateSignature(secret, accessId, nonce, day)}`;
}

export function readGateCookie(secret, accessId, nonce, value, now = new Date()) {
  if (!secret || typeof value !== "string" || value.length > 80) return false;
  const match = value.match(/^(\d{1,7})\.([A-Za-z0-9_-]{43})$/);
  if (!match) return false;
  const day = Number(match[1]);
  const today = Math.floor(now.getTime() / DAY_MS);
  if (day > today + 1 || today - day >= GATE_DAYS) return false;
  return same(gateSignature(secret, accessId, nonce, day), match[2]);
}

// --- Shortlists -------------------------------------------------------------

export function customExpiry(now = new Date()) {
  return new Date(now.getTime() + CUSTOM_SHORTLIST_DAYS * DAY_MS);
}

// "active" | "revoked" | "expired" | "closed". A role's client link lives while
// the role is open; a custom shortlist until it expires.
export function shortlistStatus(shortlist, role, now = new Date()) {
  if (shortlist.revokedAt) return "revoked";
  if (shortlist.kind === "role") return role && role.status === "open" ? "active" : "closed";
  if (!shortlist.expiresAt || new Date(shortlist.expiresAt) <= now) return "expired";
  return "active";
}

// Only active custom shortlists count towards a plan's limit. A role's own
// link never does, and nothing that is revoked or expired holds a place.
export function countsTowardLimit(shortlist, now = new Date()) {
  return shortlist.kind === "custom" && shortlistStatus(shortlist, null, now) === "active";
}

// limit null means none. Creating, reopening and extending all ask this, in
// the same transaction as the count. Links already sent are never closed by
// it, so a downgrade or the end of a trial only stops new ones.
export function canOpenAnother(activeCount, limit) {
  return limit === null || activeCount < limit;
}

// An access opens its shortlist only in the shortlist's current mode: the one
// anonymous access for "link", named ones for "people".
export function accessOpens(access, shortlist) {
  if (!access || access.revokedAt) return false;
  return shortlist.access === "people" ? Boolean(access.email) : !access.email;
}

// Who stays on the page. It is read live, so this runs on every view: someone
// who becomes do not contact, or whose candidacy is rejected or moved, leaves
// the client's screen at once.
export function itemVisible({ shortlist, item, person, candidate }) {
  if (!item || !person || person.doNotContact || !item.consentAt) return false;
  if (item.personId !== person.id) return false;
  if (shortlist.kind !== "role") return true;
  if (!candidate || item.candidateId !== candidate.id) return false;
  return candidate.roleId === shortlist.roleId && candidate.personId === person.id && candidate.stage !== "rejected";
}

export function defaultShortlistTitle(client, now = new Date()) {
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(now);
  const name = String(client ?? "").trim();
  return name ? `${name} - ${date}` : `Shortlist - ${date}`;
}

// --- Clients ----------------------------------------------------------------

const COMPANY_SUFFIXES = /\s+(ltd|limited|plc|llp|llc|inc|incorporated|gmbh|co|company|group)$/;

// One key per client, so "Halden Systems Ltd" and "halden systems" share their
// interview hours, their consents and their interviewer's diary.
export function clientKey(client, roleId) {
  let key = String(client ?? "").normalize("NFKC").toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  while (COMPANY_SUFFIXES.test(key)) key = key.replace(COMPANY_SUFFIXES, "").trim();
  return key || `role:${roleId}`;
}

// Whether a person already agreed to be put forward to this client: any
// earlier record of consent (a screening or a shortlist) for the same client.
export function hasPriorConsent(records, client) {
  const key = clientKey(client, "");
  if (!key || key === "role:") return false;
  return records.some((record) => record.at && clientKey(record.client, "") === key);
}

// --- Client decisions -------------------------------------------------------

// What a client sent from the page, validated. Anything else is refused.
export function parseDecision({ decision, reason, note }) {
  if (!DECISIONS.includes(decision)) return { error: "Choose Interview or Not for us." };
  if (decision === "interview") return { data: { decision, decisionReason: null, decisionNote: null } };
  const decisionReason = reason ? String(reason) : null;
  if (decisionReason && !DECISION_REASONS.includes(decisionReason)) return { error: "Choose one of the reasons." };
  const text = String(note ?? "").replace(/\s+/g, " ").trim();
  if (text.length > DECISION_NOTE_LIMIT) return { error: `Keep the note under ${DECISION_NOTE_LIMIT} characters.` };
  return { data: { decision, decisionReason, decisionNote: text || null } };
}

// A decision can change until the interview is booked; after that, the way to
// undo it is "Can't make this time", which cancels the booking first.
export function canDecide({ interviewBooked }) {
  return !interviewBooked;
}

// --- Interview links --------------------------------------------------------

export function hasInterviewHours(role) {
  return parseWindows(role.interviewWindows).length > 0 && isTimeZone(role.interviewTimezone ?? "") && Number.isInteger(role.interviewDurationMins) && role.interviewDurationMins > 0;
}

// Whether {{interview_link}} becomes a link for this candidate, and if not,
// why - so a template shows a gap rather than a dead link. `offered` is an open
// set of times the recruiter offered this candidate by hand: it stands in for
// the role's weekly hours, and for the client's answer, which the recruiter
// had before offering them.
export function interviewLinkState({ role, candidate, person, item, offered = false }) {
  if (!role || role.status !== "open") return { ok: false, reason: "role_closed" };
  if (!candidate || candidate.roleId !== role.id || CLOSED_STAGES.includes(candidate.stage)) return { ok: false, reason: "candidate_closed" };
  if (!person || person.doNotContact) return { ok: false, reason: "do_not_contact" };
  if (!offered && !hasInterviewHours(role)) return { ok: false, reason: "no_hours" };
  if (!item || item.candidateId !== candidate.id || !item.consentAt) return { ok: false, reason: "not_put_forward" };
  if (!offered && role.clientReviewFirst && item.decision !== "interview") return { ok: false, reason: "awaiting_client" };
  return { ok: true, reason: null };
}
