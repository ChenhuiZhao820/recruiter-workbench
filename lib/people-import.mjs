import { IMPORT_FIELDS, MULTI_FIELDS } from "./people-import-fields.mjs";
import { canonicalProfileUrl, cleanEmail, cleanMemberId, suppressionHashes } from "./person-keys.mjs";

// The rules for turning a recruiter's spreadsheet into people. Plain
// JavaScript and free of the database, so the app and the unit tests apply
// the same rules. The server looks up who already exists and which roles the
// account has and hands that in; nothing here reads or writes anything.
//
// Spreadsheets are kept in every shape there is: a title above the headings,
// no headings at all, City and Country in two columns, a name linked to the
// profile instead of a profile column, "SMITH, Jane", a role written once
// above its group of people. Each reading below is a default the recruiter
// can see in one line and turn off, never a silent rewrite.
//
// What is imported is identity and description. Salary, notice and right to
// work count in search only once confirmed on a screening, so a cell is never
// taken as one; anything else in the file can be kept in the person's note.

export { FIELD_LABELS, IMPORT_FIELDS, MULTI_FIELDS } from "./people-import-fields.mjs";

const SEARCH_ROWS = 10;

const ALIASES = {
  fullName: ["name", "fullname", "candidate", "candidatename", "contactname", "person", "contact", "who", "姓名", "名字"],
  firstName: ["firstname", "forename", "givenname", "first", "名"],
  lastName: ["lastname", "surname", "familyname", "last", "姓"],
  profileUrl: ["linkedin", "linkedinurl", "linkedinprofile", "linkedinprofileurl", "linkedinlink", "profileurl", "profilelink", "profile", "url", "link", "领英", "领英链接"],
  memberId: ["memberid", "linkedinmemberid", "linkedinid"],
  email: ["email", "emailaddress", "mail", "workemail", "personalemail", "邮箱", "电子邮件"],
  headline: ["headline", "title", "jobtitle", "currentrole", "currenttitle", "currentposition", "currentjobtitle", "职位", "头衔"],
  company: ["company", "currentcompany", "employer", "currentemployer", "organisation", "organization", "公司"],
  location: ["location", "city", "town", "region", "area", "basedin", "based", "where", "country", "county", "地点", "城市"],
  skills: ["skills", "keyskills", "skillset", "tags", "skill", "技能"],
  notes: ["notes", "note", "comments", "comment", "remarks", "备注"],
  doNotContact: ["donotcontact", "dnc", "nocontact", "optout", "optedout", "unsubscribed"],
};

// Headings that say outright that the column is the job each person is being
// considered for, and headings that might mean that or their own job.
const ROLE_CERTAIN = ["appliedfor", "roleappliedfor", "positionappliedfor", "appliedposition", "vacancy", "vacancies", "jobopening", "opening", "openrole", "pipeline", "requisition", "req", "shortlist", "shortlistedfor", "consideredfor", "candidatefor", "project", "search", "clientrole", "应聘岗位", "申请岗位"];
const ROLE_AMBIGUOUS = ["role", "position", "job", "jobrole", "roletitle", "岗位"];

const LIMITS = { fullName: 200, headline: 300, location: 200, skills: 2000, notes: 10_000, other: 4000, profileUrl: 500 };
const NAME_SUFFIXES = new Set(["phd", "mba", "jr", "sr", "ii", "iii", "iv", "cfa", "cpa", "md", "msc", "bsc", "ma", "ba", "esq", "pmp", "frcs", "acca", "aca"]);
const LINKEDIN_PROFILE = /linkedin\.com\/(in|pub)\/[^\s,;"']+/i;

/** @param {unknown} value */
export const normHeader = (value) => String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** @param {string} key */
function aliasField(key) {
  if (!key) return null;
  // "Skill 1", "Notes 2", "Email (work)" read like their plain heading.
  for (const candidate of [key, key.replace(/\d+$/, ""), key.replace(/(work|personal|home|main|primary|other)$/, "")]) {
    if (!candidate) continue;
    if (ROLE_CERTAIN.includes(candidate) || ROLE_AMBIGUOUS.includes(candidate)) return "role";
    for (const field of IMPORT_FIELDS) if (ALIASES[field]?.includes(candidate)) return field;
  }
  // Long headings people write in full: "Candidate name (as on LinkedIn)",
  // "LinkedIn URL - please paste", "Email address (work)".
  if (key.includes("linkedin")) return "profileUrl";
  if (key.includes("email") || key.includes("邮箱")) return "email";
  if (/(first|given|fore)name/.test(key)) return "firstName";
  if (/(last|sur|family)name/.test(key)) return "lastName";
  if (key.includes("name") && !/(company|file|user|role|job|client|account)/.test(key)) return "fullName";
  return null;
}

/** @param {string} key */
const namesPeople = (key) => /name|candidate|contact|person|姓名/.test(key);

/** @param {string} key */
export function roleHeaderKind(key) {
  if (ROLE_CERTAIN.includes(normHeader(key))) return "certain";
  if (ROLE_AMBIGUOUS.includes(normHeader(key))) return "ambiguous";
  return "other";
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‍⁠﻿]/g;

/** @param {string} text @param {number} max */
function oneLine(text, max) {
  return String(text ?? "").replace(CONTROL, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** @param {string} text @param {number} max */
function multiLine(text, max) {
  return String(text ?? "").replace(CONTROL, "").replace(/\r\n?/g, "\n").replace(/[^\S\n]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

/** @param {string} value */
const looksLikeEmail = (value) => Boolean(cleanEmail(String(value).trim().replace(/^mailto:/i, "")));
/** @param {string} value */
const looksLikeLink = (value) => /^(https?:\/\/|www\.)\S+$/i.test(String(value).trim()) || LINKEDIN_PROFILE.test(String(value));
/** @param {string} value */
const looksLikeName = (value) => /^[\p{L}'’.-]+(\s+[\p{L}'’.-]+){1,3}$/u.test(String(value).trim());

/** @typedef {{ n: number, cells: string[], links?: string[] }} Row */

// ---- where the table starts -------------------------------------------------

/** @param {Row} row */
const filledCells = (row) => row.cells.filter((cell) => String(cell ?? "").trim() !== "").length;
/** @param {Row} row */
const headingScore = (row) => row.cells.filter((cell) => aliasField(normHeader(cell))).length;
/** @param {Row} row */
const hasData = (row) => row.cells.some((cell) => looksLikeEmail(cell) || looksLikeLink(cell));

// Which row holds the headings: the one among the first few that names the
// most known columns. Without one, the first row as wide as the table that
// holds no address or link; a first row that does is a person, so the file has
// no headings at all (-1).
/** @param {Row[]} rows */
export function detectHeaderRow(rows) {
  const top = rows.slice(0, SEARCH_ROWS);
  let best = -1;
  let bestScore = 0;
  top.forEach((row, i) => {
    const score = hasData(row) ? 0 : headingScore(row);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  if (best >= 0) return best;
  if (top[0] && !hasData(top[0]) && top[0].cells.some((cell) => namesPeople(normHeader(cell)))) return 0;
  const widths = rows.slice(0, 30).map(filledCells).sort((a, b) => a - b);
  const typical = widths[Math.floor(widths.length / 2)] ?? 0;
  if (typical <= 1) return -1;
  const wide = top.findIndex((row) => filledCells(row) >= Math.max(2, Math.ceil(typical * 0.6)));
  if (wide < 0 || hasData(top[wide])) return -1;
  return wide;
}

const letters = (i) => {
  let name = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};

/** @param {Row[]} rows @param {number} headerIndex */
export function buildTable(rows, headerIndex) {
  const body = headerIndex >= 0 ? rows.slice(headerIndex + 1) : rows;
  const head = headerIndex >= 0 ? rows[headerIndex].cells : [];
  const columns = Math.max(head.length, ...body.map((row) => row.cells.length), 1);
  const header = Array.from({ length: columns }, (_, i) => oneLine(head[i] ?? "", 80) || `Column ${letters(i)}`);
  return { header, body, skippedAbove: Math.max(0, headerIndex) };
}

// ---- headings written as rows ------------------------------------------------

// A row with one filled cell, in a table whose rows otherwise fill several, is
// a heading for the people under it ("Data Engineer", then its candidates).
// Only read that way when the table starts with one and there are at least
// two: a person with nothing but a name looks the same.
/** @param {Row[]} body */
export function findGroupRows(body) {
  if (body.length < 3) return [];
  const single = body.map((row) => filledCells(row) === 1 && !hasData(row));
  const multi = body.filter((row) => filledCells(row) >= 2).length;
  if (!single[0] || multi < body.length / 2) return [];
  const indexes = single.flatMap((isSingle, i) => (isSingle && i + 1 < body.length && !single[i + 1] ? [i] : []));
  return indexes.length >= 2 ? indexes : [];
}

/** @param {Row[]} body @param {number[]} groupIndexes @param {number} columns */
export function applyGroupRows(body, groupIndexes, columns) {
  const heads = new Set(groupIndexes);
  const out = [];
  let label = "";
  body.forEach((row, i) => {
    if (heads.has(i)) {
      label = oneLine(row.cells.find((cell) => String(cell ?? "").trim() !== "") ?? "", 200);
      return;
    }
    const cells = Array.from({ length: columns }, (_, c) => row.cells[c] ?? "");
    out.push({ ...row, cells: [...cells, label] });
  });
  return out;
}

// ---- what each column is ------------------------------------------------------

/** @param {string[]} values */
function sniff(values) {
  const sample = values.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 50);
  if (sample.length === 0) return null;
  const share = (test) => sample.filter(test).length / sample.length;
  if (share((value) => LINKEDIN_PROFILE.test(value)) >= 0.6) return "profileUrl";
  if (share(looksLikeEmail) >= 0.6) return "email";
  if (share((value) => /^ACo[A-Za-z0-9_-]{10,}$/.test(value)) >= 0.6) return "memberId";
  if (share((value) => looksLikeName(nameHead(value))) >= 0.7) return "fullName";
  return null;
}

// The part of a cell that would be a name: before the first separator, with
// any address taken out.
/** @param {string} value */
function nameHead(value) {
  const stripped = String(value).replace(/\S*(https?:\/\/|www\.|linkedin\.com)\S*/gi, "").replace(/\S+@\S+/g, "").trim();
  return stripped.split(/\s[-–|•]\s|,\s|\s\(/)[0].trim();
}

// One field per column, guessed from the heading first and the contents
// second, so "Profile" holding addresses, or a column with no heading at all,
// still lands. Location, skills and notes may take several columns.
/** @param {string[]} header @param {Row[]} body @returns {string[]} */
export function guessMapping(header, body) {
  const taken = new Set();
  const mapping = header.map((cell, column) => {
    let field = aliasField(normHeader(cell));
    if (!field) return "";
    // The contents outvote the heading when they are plainly addresses or
    // profile links: "Contact" full of emails is an email column.
    if (["fullName", "firstName", "lastName", "headline", "company", "location"].includes(field)) {
      const seen = sniff(body.map((row) => row.cells[column] ?? ""));
      if (seen === "email" || seen === "profileUrl") field = seen;
    }
    if (taken.has(field) && !MULTI_FIELDS.includes(field)) return "";
    taken.add(field);
    return field;
  });
  header.forEach((_, column) => {
    if (mapping[column]) return;
    const field = sniff(body.map((row) => row.cells[column] ?? ""));
    if (!field || taken.has(field)) return;
    if (field === "fullName" && (taken.has("firstName") || taken.has("lastName"))) return;
    mapping[column] = field;
    taken.add(field);
  });
  return mapping;
}

// A mapping as it arrives from a browser: only known fields, one column each
// except the fields that combine, one entry per column.
/** @param {unknown} raw @param {number} columns @returns {string[] | null} */
export function parseMapping(raw, columns) {
  if (!Array.isArray(raw) || raw.length !== columns) return null;
  const taken = new Set();
  return raw.map((value) => {
    if (typeof value !== "string" || !IMPORT_FIELDS.includes(value)) return "";
    if (taken.has(value) && !MULTI_FIELDS.includes(value)) return "";
    taken.add(value);
    return value;
  });
}

/** @param {string[]} mapping */
export function hasNameColumn(mapping) {
  return mapping.includes("fullName") || mapping.includes("firstName") || mapping.includes("lastName");
}

// ---- how names are written ------------------------------------------------------

/** @param {string} name */
function surnameFirst(name) {
  const match = /^([^,]+),\s*([^,]+)$/.exec(name);
  if (!match) return null;
  if (NAME_SUFFIXES.has(normHeader(match[2]))) return null;
  return `${match[2].trim()} ${match[1].trim()}`;
}

// Only scripts with capitals have a case to fix: 张伟 is neither shouting
// nor whispering.
/** @param {string} word */
const cased = (word) => word.toUpperCase() !== word.toLowerCase();
/** @param {string} word */
const capitals = (word) => cased(word) && word === word.toUpperCase() && word.replace(/[^\p{L}]/gu, "").length >= 2;

// A name written all in capitals or all in lower case, or with the surname in
// capitals ("Jane SMITH"), which is a filing habit rather than a spelling.
/** @param {string} name */
const oneCase = (name) => {
  const words = name.split(/\s+/).filter((word) => cased(word));
  if (!words.length) return false;
  return name === name.toLowerCase() || words.some(capitals);
};

// What people type where a name should be when there is none, and the rows a
// sheet adds below a list. A heading row repeated half way down reads as
// "Name" and is caught here too.
const PLACEHOLDERS = new Set(["na", "none", "nil", "null", "undefined", "tbc", "tba", "tbd", "unknown", "test", "x", "xx", "xxx", "name", "fullname", "candidate", "candidatename", "姓名", "待定"]);

/** @param {string} name */
const notAName = (name) => !/\p{L}/u.test(name) || PLACEHOLDERS.has(normHeader(name)) || /^(grand\s+)?(total|totals|subtotal|count|sum)\b/i.test(name);

// A name as the import would write it, for showing one example on the page.
/** @param {string} raw @param {{ swap?: boolean, fixCase?: boolean }} options */
export function styleName(raw, { swap = false, fixCase = false } = {}) {
  let name = oneLine(raw, 200);
  if (swap) name = surnameFirst(name) ?? name;
  if (fixCase && oneCase(name)) name = titleCase(name);
  return name;
}

/** @param {string} word */
const titleWord = (word) => word.toLowerCase().replace(/(^|['’-])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase());

/** @param {string} name */
function titleCase(name) {
  const lower = name === name.toLowerCase();
  return name.split(/(\s+)/).map((word) => (lower || capitals(word) ? titleWord(word) : word)).join("");
}

// Whole-column readings, so one odd name never decides for the rest:
// "Surname, First" is turned round only when every name with a comma is
// written that way and they are at least half the names; capitals or lower
// case are written normally only when most names are like that.
/** @param {Row[]} body @param {string[]} mapping */
export function nameStyle(body, mapping) {
  const column = mapping.indexOf("fullName");
  const names = column < 0 ? [] : body.map((row) => oneLine(row.cells[column] ?? "", 300)).filter(Boolean);
  const withComma = names.filter((name) => name.includes(","));
  const turnable = withComma.filter((name) => surnameFirst(name));
  const swap = withComma.length > 0 && turnable.length === withComma.length && withComma.length >= names.length / 2;
  const lettered = [...names, ...[mapping.indexOf("firstName"), mapping.indexOf("lastName")].filter((c) => c >= 0).flatMap((c) => body.map((row) => oneLine(row.cells[c] ?? "", 200)).filter(Boolean))];
  const shouting = lettered.filter(oneCase);
  const fixCase = lettered.length > 0 && shouting.length / lettered.length >= 0.8;
  return { swap, swapExample: swap ? withComma[0] : null, fixCase, fixCaseExample: fixCase ? shouting[0] : null };
}

// ---- reading the cells ------------------------------------------------------------

const NOT_SET = new Set(["", "no", "n", "false", "0", "-", "none", "nil", "off", "否"]);

// Anything other than a plain "no" counts as a yes. When a recruiter has
// written something in a do-not-contact column the safe reading is that the
// person is not to be contacted.
/** @param {string} value */
export function truthy(value) {
  return !NOT_SET.has(String(value ?? "").trim().toLowerCase());
}

/** @param {string} value @returns {string | null} */
function webAddress(value) {
  const found = LINKEDIN_PROFILE.exec(value)?.[0];
  const canonical = canonicalProfileUrl(found ? `https://www.${found.replace(/^.*?linkedin/i, "linkedin")}` : value);
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
  for (const part of String(value ?? "").split(/[;,\s]+/)) {
    const email = cleanEmail(part.replace(/^mailto:/i, ""));
    if (email) return email;
  }
  return null;
}

/** @param {string} cell */
export function splitRoles(cell) {
  return String(cell ?? "").split(/[;\n|]+/).map((part) => oneLine(part, 200)).filter(Boolean);
}

/**
 * @typedef {{
 *   n: number, name: string, profileUrl: string | null, memberId: string | null, headline: string | null,
 *   location: string | null, skills: string | null, email: string | null, notes: string | null, other: string | null,
 *   roles: string[], doNotContact: boolean, warnings: string[], error: string | null
 * }} CleanRow
 */

/**
 * @param {Row[]} body rows after the headings
 * @param {string[]} header
 * @param {string[]} mapping
 * @param {{ swapNames?: boolean, fixCase?: boolean, keepOther?: boolean, roleAs?: "role" | "headline" | null, nameFromEmail?: boolean }} [options]
 * @returns {CleanRow[]}
 */
export function cleanRows(body, header, mapping, options = {}) {
  const { swapNames = false, fixCase = false, keepOther = true, roleAs = null, nameFromEmail = false } = options;
  const roleColumn = mapping.indexOf("role");
  const hasHeadline = mapping.includes("headline");
  return body.map((row) => {
    const { n, cells } = row;
    const links = row.links ?? [];
    const cell = (column) => String(cells[column] ?? "");
    const all = (field) => mapping.flatMap((f, column) => (f === field ? [column] : []));
    const first = (field) => {
      const column = mapping.indexOf(field);
      return column < 0 ? "" : cell(column);
    };
    const used = new Set(mapping.flatMap((field, column) => (field ? [column] : [])));
    /** @type {string[]} */
    const warnings = [];

    let name = oneLine(first("fullName") || `${first("firstName")} ${first("lastName")}`.trim() || (nameFromEmail ? first("email") : ""), LIMITS.fullName + 1);
    // Only an email address where the name should be: the name is read from
    // the address when it has one ("jane.doe@" is Jane Doe), and said so.
    if (looksLikeEmail(name)) {
      const parts = name.split("@")[0].split(/[._-]+/).filter((part) => /^\p{L}{2,}$/u.test(part));
      if (parts.length >= 1) {
        warnings.push("Name read from the email address");
        name = parts.map(titleWord).join(" ");
      } else name = "";
    } else if (/https?:\/\/|www\.|linkedin\.com|\S@\S/i.test(name) || (/\s[-–|•]\s|\s\(/.test(name) && !looksLikeName(name))) {
      // Everything in one cell ("Jane Doe - Engineer - linkedin.com/in/…"):
      // the name is what comes before the first separator, once the address
      // is taken out; the address itself is picked up below.
      const head = nameHead(name);
      if (looksLikeName(head)) {
        warnings.push("Name taken from the start of the cell");
        name = head;
      }
    }
    if (swapNames) name = surnameFirst(name) ?? name;
    if (fixCase && oneCase(name)) name = titleCase(name);
    let error = null;
    if (!name) error = "No name";
    else if (name.length > LIMITS.fullName) error = "Name is too long";
    else if (notAName(name)) error = "Not a name";

    // A profile column first; then a link behind the profile cell; then any
    // LinkedIn profile written or linked anywhere else in the row.
    let profileUrl = null;
    const profileColumn = mapping.indexOf("profileUrl");
    const link = oneLine(first("profileUrl"), 2000);
    if (profileColumn >= 0) profileUrl = (link ? webAddress(link) : null) ?? (links[profileColumn] ? webAddress(links[profileColumn]) : null);
    if (!profileUrl) {
      for (let c = 0; c < Math.max(cells.length, links.length); c++) {
        const found = [links[c], used.has(c) && c !== mapping.indexOf("fullName") ? "" : cell(c)].find((value) => value && LINKEDIN_PROFILE.test(value));
        if (found) {
          profileUrl = webAddress(found);
          if (profileUrl && !used.has(c) && !links[c]) used.add(c);
          if (profileUrl) break;
        }
      }
    }
    if (!profileUrl && link && (looksLikeLink(link) || /linkedin/i.test(link))) warnings.push("Profile link was not a web address and was left out");
    else if (!profileUrl && link && profileColumn >= 0 && !links[profileColumn]) warnings.push(`The profile column said "${link.slice(0, 40)}" with no link behind it`);

    let memberId = null;
    const member = oneLine(first("memberId"), 200);
    if (member) {
      memberId = cleanMemberId(member);
      if (!memberId) warnings.push("Member id was not recognised and was left out");
    }

    let email = null;
    const mail = oneLine(first("email"), 1000);
    if (mail) {
      email = firstEmail(mail);
      if (!email) warnings.push("Email address was not valid and was left out");
    }
    if (!email) {
      for (let c = 0; c < Math.max(cells.length, links.length) && !email; c++) {
        if (used.has(c) && c !== mapping.indexOf("fullName")) continue;
        const found = [links[c] ?? "", cell(c)].find((value) => /^mailto:/i.test(value) || /\S@\S+\.\S/.test(value));
        if (found) {
          email = firstEmail(found);
          if (email && !used.has(c)) used.add(c);
        }
      }
    }

    const roleCell = roleColumn >= 0 ? cell(roleColumn) : "";
    const title = oneLine(first("headline") || (roleAs === "headline" ? roleCell : ""), LIMITS.headline);
    const company = oneLine(first("company"), 200);
    const headline = (title && company ? `${title} at ${company}` : title || company).slice(0, LIMITS.headline) || null;
    const joined = (field, separator, max) => oneLine(all(field).map((c) => oneLine(cell(c), max)).filter(Boolean).join(separator), max) || null;
    const location = joined("location", ", ", LIMITS.location);
    const skills = joined("skills", ", ", LIMITS.skills);
    const noteColumns = all("notes").filter((c) => cell(c).trim());
    const notes = multiLine(noteColumns.length > 1 ? noteColumns.map((c) => `${header[c]}: ${cell(c)}`).join("\n") : noteColumns.map(cell).join(""), LIMITS.notes) || null;
    const roles = roleAs === "role" ? splitRoles(roleCell) : [];
    // The role column feeds a record only when read as roles, or as the job
    // title with no other title column; otherwise it is kept with the rest.
    if (roleColumn >= 0 && !(roleAs === "role" || (roleAs === "headline" && !hasHeadline))) used.delete(roleColumn);

    let other = null;
    if (keepOther) {
      const parts = header.flatMap((label, c) => {
        if (used.has(c)) return [];
        const value = oneLine(cell(c), 500);
        return value ? [`${label}: ${value}`] : [];
      });
      other = parts.length ? multiLine(parts.join("\n"), LIMITS.other) : null;
    }

    return { n, name, profileUrl, memberId, headline, location, skills, email, notes, other, roles, doNotContact: truthy(first("doNotContact")), warnings, error };
  });
}

// ---- the role column ---------------------------------------------------------------

/** @param {string} title */
export function roleKey(title) {
  return oneLine(title, 200).toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const EXPAND = { sr: "senior", snr: "senior", jr: "junior", jnr: "junior", eng: "engineer", engr: "engineer", mgr: "manager", dev: "developer", swe: "software engineer", ml: "machine learning", ds: "data scientist", vp: "vice president", hd: "head" };

/** @param {string} key */
const expanded = (key) => key.split(" ").map((word) => EXPAND[word] ?? word).join(" ");

/** @param {string} a @param {string} b */
function similarity(a, b) {
  if (!a || !b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = temp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

// Whether a column that might hold roles is read as roles without asking.
// Yes when most of its values are roles the account already has, or when the
// heading says so and it would not create more than a handful of new roles.
// Everything else is asked, because a wrong "yes" fills Roles with people's
// job titles. The answer is never pre-chosen.
/**
 * @param {{ header: string, values: string[], roles: { title: string }[], people: number }} input
 * @returns {{ decision: "role" | "ask", newCount: number, distinct: number }}
 */
export function classifyRoleColumn({ header, values, roles, people }) {
  const existing = new Set(roles.map((role) => roleKey(role.title)));
  const distinct = [...new Set(values.flatMap(splitRoles).map(roleKey).filter(Boolean))];
  const matched = distinct.filter((key) => existing.has(key)).length;
  const newCount = distinct.length - matched;
  if (distinct.length > 0 && matched / distinct.length >= 0.5) return { decision: "role", newCount, distinct: distinct.length };
  const cap = Math.min(10, Math.ceil(people * 0.3));
  if (roleHeaderKind(header) === "certain" && newCount <= cap) return { decision: "role", newCount, distinct: distinct.length };
  return { decision: "ask", newCount, distinct: distinct.length };
}

/**
 * @typedef {{ id: string, title: string, status: string }} AccountRole
 * @typedef {{ key: string, label: string, people: number, kind: "match" | "several" | "closed" | "near" | "new", choice: string, options: { value: string, label: string }[] }} RoleValue
 */

// What happens to each role named in the file. One open role with that exact
// title is used without asking. Everything else - two roles of that title, a
// closed one, a close spelling, a new name - defaults to no role, so nothing
// is created or attached on a guess, and offers the choices in one list.
/** @param {Map<string, { label: string, people: number }>} values @param {AccountRole[]} roles @param {Record<string, string>} [choices] @returns {RoleValue[]} */
export function resolveRoleValues(values, roles, choices = {}) {
  const ids = new Set(roles.map((role) => role.id));
  return [...values.entries()].map(([key, { label, people }]) => {
    const exact = roles.filter((role) => roleKey(role.title) === key);
    const open = exact.filter((role) => role.status === "open");
    const near = roles.filter((role) => role.status === "open" && !exact.includes(role) && (expanded(roleKey(role.title)) === expanded(key) || (key.length >= 5 && similarity(expanded(roleKey(role.title)), expanded(key)) >= 0.85)));
    /** @type {RoleValue["kind"]} */
    const kind = open.length === 1 ? "match" : open.length > 1 ? "several" : exact.length ? "closed" : near.length ? "near" : "new";
    const suggested = kind === "several" ? open : kind === "closed" ? exact : kind === "near" ? near : [];
    const options = [
      { value: "none", label: "Do not add to a role" },
      { value: "create", label: `Create the role "${label}"` },
      ...suggested.map((role) => ({ value: role.id, label: `${role.title}${role.status === "closed" ? " (closed)" : ""}` })),
      ...roles.filter((role) => role.status === "open" && !suggested.includes(role)).map((role) => ({ value: role.id, label: role.title })),
    ];
    const asked = choices[key];
    const choice = asked && (asked === "none" || asked === "create" || ids.has(asked)) ? asked : kind === "match" ? open[0].id : "none";
    return { key, label, people, kind, choice, options };
  });
}

// ---- who each row is ------------------------------------------------------------------

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
 * @typedef {CleanRow & { status: "new" | "existing" | "suppressed" | "duplicate" | "invalid" | "excluded", reason: string | null, existing: Existing | null, sameAs: number | null }} Decided
 */

// Who each row is. Never by name: two people can share one, and a wrong merge
// is worse than a duplicate the recruiter can see. Matching is by member id,
// then profile link, and by email only for a row that has neither. A person
// on several rows (one per role) becomes one person on each of those roles.
/** @param {CleanRow[]} rows @param {Known} known @param {Set<number>} [excluded] @returns {{ rows: Decided[], totals: Record<string, number> }} */
export function classifyRows(rows, known, excluded = new Set()) {
  /** @type {Map<string, Decided>} */
  const claimed = new Map();
  const totals = { rows: rows.length, new: 0, existing: 0, suppressed: 0, duplicate: 0, invalid: 0, excluded: 0, warned: 0, noLink: 0, doNotContactOnExisting: 0 };
  /** @type {Decided[]} */
  const decided = rows.map((row) => {
    /** @param {Decided["status"]} status @param {string | null} reason @param {Existing | null} [existing] @param {number | null} [sameAs] @returns {Decided} */
    const done = (status, reason, existing = null, sameAs = null) => ({ ...row, roles: [...row.roles], status, reason, existing, sameAs });
    if (excluded.has(row.n)) return done("excluded", "Left out by you");
    if (row.error) return done("invalid", row.error);
    if (suppressionHashes(row).some((hash) => known.suppressed.has(hash))) return done("suppressed", "Deleted from your People before");
    const keys = [];
    if (row.memberId) keys.push(`m:${row.memberId}`);
    if (row.profileUrl) keys.push(`u:${row.profileUrl}`);
    if (!row.memberId && !row.profileUrl && row.email) keys.push(`e:${row.email}`);
    const earlier = keys.map((key) => claimed.get(key)).find(Boolean);
    if (earlier) {
      for (const role of row.roles) if (!earlier.roles.includes(role)) earlier.roles.push(role);
      return done("duplicate", `Same person as row ${earlier.n}${row.roles.length ? "; their roles were combined" : ""}`, null, earlier.n);
    }
    const existing =
      (row.memberId && known.byMember.get(row.memberId)) ||
      (row.profileUrl && known.byUrl.get(row.profileUrl)) ||
      (!row.memberId && !row.profileUrl && row.email && known.byEmail.get(row.email)) ||
      null;
    const result = existing ? done("existing", "Already in your People", existing) : done("new", null);
    keys.forEach((key) => claimed.set(key, result));
    return result;
  });
  for (const row of decided) {
    totals[row.status] += 1;
    if (row.warnings.length && (row.status === "new" || row.status === "existing")) totals.warned += 1;
    if (row.status === "new" && !row.memberId && !row.profileUrl) totals.noLink += 1;
    if (row.status === "existing" && row.doNotContact && !row.existing?.doNotContact) totals.doNotContactOnExisting += 1;
  }
  return { rows: decided, totals };
}

// What a row may add to someone already in People when "fill empty fields"
// is chosen: a field they have nothing in. Nothing is ever overwritten.
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

// The sheet most likely to be the list: the one whose headings name the most
// known columns; the first sheet when none does.
/** @param {{ rows: Row[] }[]} sheets */
export function chooseSheet(sheets) {
  let best = 0;
  let bestScore = -1;
  sheets.forEach((sheet, i) => {
    const score = Math.max(0, ...sheet.rows.slice(0, SEARCH_ROWS).map((row) => (hasData(row) ? 0 : headingScore(row))));
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/**
 * How a workbook is laid out, with each reading either the default or what
 * the recruiter chose: which sheet, which row holds the headings, whether
 * one-cell rows are headings for the people below, and what each column is.
 * The server adds people and roles to this; the tests read files through it.
 * @param {{ name: string, rows: Row[] }[]} sheets
 * @param {{ sheet?: number, headerRow?: number, groupRows?: boolean, mapping?: unknown, nameFromEmail?: boolean }} [options]
 */
export function prepareTable(sheets, options = {}) {
  const sheetIndex = options.sheet !== undefined && options.sheet < sheets.length ? options.sheet : chooseSheet(sheets);
  const sheet = sheets[sheetIndex];
  const headerRow = options.headerRow !== undefined && options.headerRow < sheet.rows.length ? options.headerRow : detectHeaderRow(sheet.rows);
  const table = buildTable(sheet.rows, headerRow);
  const groupIndexes = findGroupRows(table.body);
  const groupOn = (options.groupRows ?? groupIndexes.length > 0) && groupIndexes.length > 0;
  const header = groupOn ? [...table.header, "Group heading"] : table.header;
  const body = groupOn ? applyGroupRows(table.body, groupIndexes, table.header.length) : table.body;
  const parsed = options.mapping ? parseMapping(options.mapping, header.length) : null;
  const mapping = parsed ?? guessMapping(header, body);
  if (!parsed && groupOn && !mapping.includes("role")) mapping[header.length - 1] = "role";
  // No name column but an email column: names are read from the addresses
  // (jane.doe@ is Jane Doe) unless the recruiter says not to.
  const nameFromEmail = !hasNameColumn(mapping) && mapping.includes("email") && options.nameFromEmail !== false;
  return { sheetIndex, sheet, headerRow, table, groupIndexes, groupOn, header, body, mapping, nameFromEmail, needsName: !hasNameColumn(mapping) && !nameFromEmail, style: nameStyle(body, mapping) };
}
