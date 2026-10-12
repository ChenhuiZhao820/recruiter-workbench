import { IMPORT_FIELDS } from "./people-import-fields.mjs";
import { canonicalProfileUrl, cleanEmail, cleanMemberId, suppressionHashes } from "./person-keys.mjs";

// The rules for turning rows of a recruiter's spreadsheet into people. Plain
// JavaScript and free of the database, so the app and the unit tests apply
// the same rules. The server looks up who already exists and hands that in;
// nothing here reads or writes anything.
//
// What is imported is identity and description only: name, link, member id,
// headline, place, skills, email, a note and a do-not-contact flag. Salary,
// notice and right to work are left out on purpose. Those facts count in
// search only once confirmed on a screening, and a spreadsheet cell is not
// a confirmation.

export { FIELD_LABELS, IMPORT_FIELDS } from "./people-import-fields.mjs";

const ALIASES = {
  fullName: ["name", "fullname", "candidate", "candidatename", "contactname", "person"],
  firstName: ["firstname", "forename", "givenname"],
  lastName: ["lastname", "surname", "familyname"],
  profileUrl: ["linkedin", "linkedinurl", "linkedinprofile", "linkedinprofileurl", "linkedinlink", "profileurl", "profilelink", "profile", "url", "link"],
  memberId: ["memberid", "linkedinmemberid", "linkedinid"],
  headline: ["headline", "title", "jobtitle", "position", "currentrole", "currenttitle", "currentposition", "role"],
  location: ["location", "city", "town", "region", "area", "basedin", "country"],
  skills: ["skills", "keyskills", "skillset", "tags"],
  email: ["email", "emailaddress", "mail", "workemail", "personalemail"],
  notes: ["notes", "note", "comments", "comment", "remarks"],
  doNotContact: ["donotcontact", "dnc", "nocontact", "optout", "optedout", "unsubscribed"],
};

const LIMITS = { fullName: 200, headline: 300, location: 200, skills: 2000, notes: 10_000, profileUrl: 500 };

/** @param {unknown} value */
const normHeader = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// One field per column, the first column that looks right for each field.
// Anything unrecognised stays unmapped and is not imported.
/** @param {string[]} header @returns {string[]} */
export function guessMapping(header) {
  const taken = new Set();
  return header.map((cell) => {
    const key = normHeader(cell);
    if (!key) return "";
    for (const field of IMPORT_FIELDS) {
      if (!taken.has(field) && ALIASES[field].includes(key)) {
        taken.add(field);
        return field;
      }
    }
    return "";
  });
}

// A mapping as it arrives from a browser: only known fields, one column each,
// one entry per column.
/** @param {unknown} raw @param {number} columns @returns {string[] | null} */
export function parseMapping(raw, columns) {
  if (!Array.isArray(raw) || raw.length !== columns) return null;
  const taken = new Set();
  return raw.map((value) => {
    if (typeof value !== "string" || !IMPORT_FIELDS.includes(value) || taken.has(value)) return "";
    taken.add(value);
    return value;
  });
}

/** @param {string[]} mapping */
export function hasNameColumn(mapping) {
  return mapping.includes("fullName") || mapping.includes("firstName") || mapping.includes("lastName");
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‍⁠﻿]/g;

/** @param {string} text @param {number} max */
function oneLine(text, max) {
  return text.replace(CONTROL, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** @param {string} text @param {number} max */
function multiLine(text, max) {
  return text.replace(CONTROL, "").replace(/\r\n?/g, "\n").replace(/[^\S\n]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

const NOT_SET = new Set(["", "no", "n", "false", "0", "-", "none", "nil", "off"]);

// Anything other than a plain "no" counts as a yes. When a recruiter has
// written something in a do-not-contact column the safe reading is that the
// person is not to be contacted.
/** @param {string} value */
export function truthy(value) {
  return !NOT_SET.has(value.trim().toLowerCase());
}

/** @param {string} value @returns {string | null} */
function webAddress(value) {
  const canonical = canonicalProfileUrl(value);
  if (!canonical || canonical.length > LIMITS.profileUrl) return null;
  try {
    const url = new URL(canonical);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".") ? canonical : null;
  } catch {
    return null;
  }
}

/** @param {string} value @returns {string | null} */
function firstEmail(value) {
  for (const part of value.split(/[;,\s]+/)) {
    const email = cleanEmail(part);
    if (email) return email;
  }
  return null;
}

/**
 * @typedef {{
 *   n: number, name: string, profileUrl: string | null, memberId: string | null, headline: string | null,
 *   location: string | null, skills: string | null, email: string | null, notes: string | null,
 *   doNotContact: boolean, warnings: string[], error: string | null
 * }} CleanRow
 */

/** @param {{ n: number, cells: string[] }[]} rows rows after the header @param {string[]} mapping @returns {CleanRow[]} */
export function cleanRows(rows, mapping) {
  return rows.map(({ n, cells }) => {
    /** @type {Record<string, string>} */
    const raw = {};
    mapping.forEach((field, column) => {
      if (field) raw[field] = cells[column] ?? "";
    });
    /** @type {string[]} */
    const warnings = [];
    const name = oneLine(raw.fullName || `${raw.firstName ?? ""} ${raw.lastName ?? ""}`, LIMITS.fullName + 1);
    let error = null;
    if (!name) error = "No name";
    else if (name.length > LIMITS.fullName) error = "Name is too long";

    let profileUrl = null;
    const link = oneLine(raw.profileUrl ?? "", 2000);
    if (link) {
      profileUrl = webAddress(link);
      if (!profileUrl) warnings.push("Profile link was not a web address and was left out");
    }
    let memberId = null;
    const member = oneLine(raw.memberId ?? "", 200);
    if (member) {
      memberId = cleanMemberId(member);
      if (!memberId) warnings.push("Member id was not recognised and was left out");
    }
    let email = null;
    const mail = oneLine(raw.email ?? "", 1000);
    if (mail) {
      email = firstEmail(mail);
      if (!email) warnings.push("Email address was not valid and was left out");
    }
    const headline = oneLine(raw.headline ?? "", LIMITS.headline) || null;
    const location = oneLine(raw.location ?? "", LIMITS.location) || null;
    const skills = oneLine(raw.skills ?? "", LIMITS.skills) || null;
    const notes = multiLine(raw.notes ?? "", LIMITS.notes) || null;
    return { n, name, profileUrl, memberId, headline, location, skills, email, notes, doNotContact: truthy(raw.doNotContact ?? ""), warnings, error };
  });
}

// Every identifier in a set of rows, for the server to look up. Each is
// matched on its own, as people are everywhere else in the app.
/** @param {CleanRow[]} rows */
export function identifiersOf(rows) {
  const live = rows.filter((row) => !row.error);
  return {
    memberIds: [...new Set(live.map((row) => row.memberId).filter(Boolean))],
    profileUrls: [...new Set(live.map((row) => row.profileUrl).filter(Boolean))],
    emails: [...new Set(live.map((row) => row.email).filter(Boolean))],
    hashes: [...new Set(live.flatMap((row) => suppressionHashes(row)))],
  };
}

/**
 * @typedef {{ id: string, fullName: string, motivation: string | null, doNotContact: boolean, headline: string | null, location: string | null, skillsSummary: string | null, email: string | null }} Existing
 * @typedef {{ byMember: Map<string, Existing>, byUrl: Map<string, Existing>, byEmail: Map<string, Existing>, suppressed: Set<string> }} Known
 * @typedef {CleanRow & { status: "new" | "existing" | "suppressed" | "duplicate" | "invalid", reason: string | null, existing: Existing | null }} Decided
 */

// Who each row is. Never by name: two people can share one, and a wrong merge
// is worse than a duplicate the recruiter can see. Matching is by member id,
// then profile link, and by email only for a row that has neither.
/** @param {CleanRow[]} rows @param {Known} known @returns {{ rows: Decided[], totals: Record<string, number> }} */
export function classifyRows(rows, known) {
  const claimed = new Set();
  const totals = { rows: rows.length, new: 0, existing: 0, suppressed: 0, duplicate: 0, invalid: 0, warned: 0, noLink: 0, doNotContactOnExisting: 0 };
  /** @type {Decided[]} */
  const decided = rows.map((row) => {
    /** @param {Decided["status"]} status @param {string | null} reason @param {Existing | null} [existing] @returns {Decided} */
    const done = (status, reason, existing = null) => ({ ...row, status, reason, existing });
    if (row.error) return done("invalid", row.error);
    if (suppressionHashes(row).some((hash) => known.suppressed.has(hash))) return done("suppressed", "Deleted from your People before");
    const keys = [];
    if (row.memberId) keys.push(`m:${row.memberId}`);
    if (row.profileUrl) keys.push(`u:${row.profileUrl}`);
    if (!row.memberId && !row.profileUrl && row.email) keys.push(`e:${row.email}`);
    if (keys.some((key) => claimed.has(key))) return done("duplicate", "Appears earlier in this file");
    keys.forEach((key) => claimed.add(key));
    const existing =
      (row.memberId && known.byMember.get(row.memberId)) ||
      (row.profileUrl && known.byUrl.get(row.profileUrl)) ||
      (!row.memberId && !row.profileUrl && row.email && known.byEmail.get(row.email)) ||
      null;
    if (existing) return done("existing", "Already in your People", existing);
    return done("new", !row.memberId && !row.profileUrl && !row.email ? "No link or email, so this person cannot be recognised if you import them again" : null);
  });
  for (const row of decided) {
    totals[row.status] += 1;
    if (row.warnings.length) totals.warned += 1;
    if (row.status === "new" && !row.memberId && !row.profileUrl) totals.noLink += 1;
    if (row.status === "existing" && row.doNotContact && !row.existing?.doNotContact) totals.doNotContactOnExisting += 1;
  }
  return { rows: decided, totals };
}

// What a row may add to someone already in People when "only fill gaps" is
// chosen: a field they have nothing in. Nothing is ever overwritten.
/** @param {Existing} existing @param {CleanRow} row */
export function gapFills(existing, row) {
  /** @type {Record<string, string>} */
  const fill = {};
  if (!existing.headline && row.headline) fill.headline = row.headline;
  if (!existing.location && row.location) fill.location = row.location;
  if (!existing.skillsSummary && row.skills) fill.skillsSummary = row.skills;
  if (!existing.email && row.email) fill.email = row.email;
  return fill;
}

/** @param {string} fileName @returns {string} */
export function cleanFileName(fileName) {
  const base = String(fileName ?? "").split(/[\\/]/).pop() ?? "";
  return oneLine(base.replace(/["“”]/g, ""), 80) || "a spreadsheet";
}

/** @param {string} fileName @param {Date} date */
export function provenanceNote(fileName, date) {
  return `Imported from "${cleanFileName(fileName)}" on ${date.toISOString().slice(0, 10)}.`;
}

