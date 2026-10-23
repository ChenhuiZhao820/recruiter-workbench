import { canonicalProfileUrl, cleanEmail } from "./person-keys.mjs";
import { PENDING_COUNTS_MS } from "./email-finder-timing.mjs";

export { GIVE_UP_MS, PENDING_COUNTS_MS, POLL_MS, remainingText } from "./email-finder-timing.mjs";

// Finding a person's work email through Enrow, on the recruiter's click.
// Shared by the app and the unit tests: what a search asks for, what a reply
// means, and how much of the plan's allowance is left. Nothing here touches
// the database or the network.
//
// Enrow is asked, never LinkedIn. A search by LinkedIn address sends Enrow
// the address only; Enrow works out the person and their current employer.

// Enrow's own API, or a test server's when CAPTURE_TEST_ENROW_BASE_URL is set
// outside production.
export function enrowBase(env = process.env) {
  const test = env.NODE_ENV !== "production" ? env.CAPTURE_TEST_ENROW_BASE_URL?.replace(/\/$/, "") : "";
  return test || "https://api.enrow.io";
}

export function enrowKey(env = process.env) {
  return env.ENROW_API_KEY?.trim() || null;
}

export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_COMPANY = 120;

// The company in a LinkedIn-style headline: "Senior PM at Acme", "Engineer @
// Acme | Ex-Google". The first "at"/"@" is taken, and the company ends at a
// separator. Anything else is null: guessing a company from a headline that
// names none would search for the wrong person.
export function companyFromHeadline(headline) {
  const text = String(headline ?? "").replace(/\s+/g, " ").trim();
  const match = /(?:^|\s)(?:at\s+|@\s*)(.+)$/i.exec(text);
  if (!match) return null;
  const company = match[1].split(/\s+[|·•]\s+|\s+[-–—]\s+|,\s+|\s+\/\s+/)[0].trim().replace(/[.;:]+$/, "");
  return company && company.length <= MAX_COMPANY ? company : null;
}

// The name typed to search again: whitespace collapsed, and null when empty or too long.
export function cleanName(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  return name && name.length <= MAX_COMPANY ? name : null;
}

export function cleanCompany(value) {
  const company = String(value ?? "").replace(/\s+/g, " ").trim();
  return company && company.length <= MAX_COMPANY ? company : null;
}

// What to ask Enrow for one person. By LinkedIn address when there is one and
// no company was typed; by name and company otherwise. Null when there is not
// enough to search on.
/** @param {{ fullName: string, profileUrl?: string | null }} person @param {string | null} [company] */
export function lookupRequest({ fullName, profileUrl }, company = null) {
  const typed = cleanCompany(company);
  // Only a member profile: any other address a recruiter saved is not one Enrow can read.
  const canonical = canonicalProfileUrl(profileUrl);
  const linkedin = canonical?.startsWith("https://www.linkedin.com/in/") ? canonical : null;
  if (linkedin && !typed) return { method: "linkedin", body: { linkedin_url: linkedin } };
  const fullname = String(fullName ?? "").replace(/\s+/g, " ").trim();
  if (!typed || fullname.split(" ").length < 2) return null;
  return { method: "name", body: { fullname, company_name: typed } };
}

// How the start of a search went. "linkedin_refused" means Enrow would not
// search this address (a format it does not take, or LinkedIn search not
// enabled for the account): searching by name and company still can.
export function readStart(status, body) {
  if ((status === 200 || status === 201) && typeof body?.id === "string" && body.id) return { state: "started", id: body.id };
  const message = String(body?.message ?? body?.reason ?? "").toLowerCase();
  if (status === 400 && message.includes("linkedin")) return { state: "linkedin_refused" };
  if (status === 402) return { state: "no_credits" };
  if (status === 401 || status === 403) return { state: "misconfigured" };
  return { state: "failed" };
}

// One read of a search's result. Found needs an email that reads as one;
// anything else Enrow finished with is not found, with LinkedIn's reason when
// it gave one.
export const LINKEDIN_REASONS = ["profile_not_found", "no_current_company", "email_not_found", "lookup_failed"];

export function readResult(status, body) {
  if (status === 202 || body?.qualification === "ongoing") return { state: "pending" };
  if (status !== 200) return { state: "failed" };
  const email = cleanEmail(body?.email);
  if (email && (body?.qualification === "valid" || body?.qualification === "found")) return { state: "found", email };
  const reason = LINKEDIN_REASONS.includes(body?.linkedin_status) ? body.linkedin_status : null;
  if (reason === "lookup_failed") return { state: "failed" };
  return { state: "not_found", reason };
}

// What the recruiter reads when nothing was found, and whether searching by
// name and company is worth offering next.
export function notFoundText(reason, method) {
  if (method === "name" || method === "recheck") return { text: "No email found for that name and company.", tryByName: true };
  if (reason === "profile_not_found") return { text: "Enrow could not read that LinkedIn profile.", tryByName: true };
  if (reason === "no_current_company") return { text: "Their profile shows no current employer, so there is no work email to find.", tryByName: true };
  return { text: "No email found from their LinkedIn profile.", tryByName: true };
}

// Where the allowance is counted from: the start of the UTC month, or for a
// trial the whole trial, counted from when the account was made, so a trial
// that crosses a month does not get a second allowance.
/** @param {string} tier @param {Date} [now] @param {Date | null} [createdAt] */
export function allowanceStart(tier, now = new Date(), createdAt = null) {
  if (tier === "trial" && createdAt) return new Date(createdAt);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// The lookups that use up the allowance: found ones, and ones still running
// recently enough to finish. Not found and failed searches are free.
export function countsAgainstAllowance(lookup, now = new Date()) {
  if (lookup.status === "found") return true;
  return lookup.status === "pending" && now.getTime() - new Date(lookup.createdAt).getTime() < PENDING_COUNTS_MS;
}

// Where an address on a person came from, as the pages say it.
export function emailSourceLabel(source) {
  if (source === "finder") return "Found by Enrow, unverified";
  if (source === "booking") return "Given when they booked";
  if (source === "import") return "Imported";
  return "Added by you";
}

// What the Find email control needs to know about one person.
/** @param {{ id: string, fullName: string, profileUrl?: string | null, headline?: string | null }} person */
export function finderTarget(person) {
  const first = String(person.fullName ?? "").trim().split(/\s+/)[0] || person.fullName;
  return {
    personId: person.id,
    name: first,
    hasLinkedIn: lookupRequest({ fullName: person.fullName, profileUrl: person.profileUrl })?.method === "linkedin",
    companyGuess: companyFromHeadline(person.headline),
  };
}
