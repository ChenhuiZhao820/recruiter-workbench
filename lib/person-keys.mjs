import { createHash } from "node:crypto";

// Pure helpers for recognising the same person twice. Plain JavaScript and
// free of the database, so the app, the unit tests and the backfill script
// all apply exactly the same rules. normalizeProfileUrl lives here for the
// same reason and is re-exported from urls.ts.

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const LOOKS_LIKE_HOST = /^[\w-]+(\.[\w-]+)+([/?#]|$)/;

/** @param {string | null | undefined} input @returns {string | null} */
export function normalizeProfileUrl(input) {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (HAS_SCHEME.test(raw)) return raw;
  if (LOOKS_LIKE_HOST.test(raw)) return `https://${raw}`;
  // Not a link. Keep what the recruiter typed rather than discarding it;
  // profileHref will decline to link it.
  return raw;
}

const MEMBER_ID = /^[A-Za-z0-9_-]{5,60}$/;

// One spelling per LinkedIn profile, so "linkedin.com/in/Jane-Doe/" and
// "https://uk.linkedin.com/in/jane-doe?trk=x" are recognised as the same
// person. Anything that is not a LinkedIn profile keeps its normalised form
// without a trailing slash.
/** @param {string | null | undefined} input @returns {string | null} */
export function canonicalProfileUrl(input) {
  const normalised = normalizeProfileUrl(input);
  if (!normalised) return null;
  try {
    const url = new URL(normalised);
    const host = url.hostname.toLowerCase();
    const isLinkedIn = host === "linkedin.com" || host.endsWith(".linkedin.com");
    const match = url.pathname.match(/^\/in\/([^/]+)\/?/i);
    if (isLinkedIn && match) {
      let slug = match[1];
      try {
        slug = decodeURIComponent(slug);
      } catch {
        // Keep the raw slug if it is not valid percent-encoding.
      }
      return `https://www.linkedin.com/in/${encodeURIComponent(slug.toLowerCase())}`;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return normalised;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return normalised;
  }
}

/** @param {string | null | undefined} value @returns {string | null} */
export function cleanMemberId(value) {
  const id = (value ?? "").trim();
  return MEMBER_ID.test(id) ? id : null;
}

/** @param {string | null | undefined} value @returns {string | null} */
export function cleanEmail(value) {
  const email = (value ?? "").trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

// Hashes kept after a person is deleted. Each identifier is hashed on its own
// with a prefix, so a later capture matches on whichever one it carries.
/** @param {{ profileUrl?: string | null, memberId?: string | null, email?: string | null }} identity @returns {string[]} */
export function suppressionHashes(identity) {
  /** @type {string[]} */
  const keys = [];
  const url = canonicalProfileUrl(identity.profileUrl);
  const member = cleanMemberId(identity.memberId);
  const email = cleanEmail(identity.email);
  if (url) keys.push(`url:${url}`);
  if (member) keys.push(`member:${member}`);
  if (email) keys.push(`email:${email}`);
  return keys.map((key) => createHash("sha256").update(key).digest("hex"));
}

/** @param {Array<string | null | undefined>} fields @returns {string} */
export function buildSearchText(fields) {
  return fields
    .map((field) => (field ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, 4000);
}
