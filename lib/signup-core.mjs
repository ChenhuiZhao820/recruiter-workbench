// Rules for self-serve sign-up shared by the server and the unit tests
// (tests/signup.test.mjs). No database, no network.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const CODE_MINUTES = 10;
export const PENDING_MINUTES = 30;
export const TERMS_COOKIE = "capture_signup_terms";
const TERMS_COOKIE_MINUTES = 15;

// One trial per address: case and a "+tag" in the local part do not make a new person.
export function trialKeyForEmail(email) {
  const [local = "", domain = ""] = String(email).trim().toLowerCase().split("@");
  return createHash("sha256").update(`email:${local.split("+")[0]}@${domain}`).digest("hex");
}

// Throwaway inboxes, refused at sign-up. A short local list on purpose:
// checked without any request to a third party, and only the common ones.
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "grr.la", "10minutemail.com",
  "10minutemail.net", "temp-mail.org", "tempmail.com", "tempmail.net", "tempail.com", "yopmail.com", "yopmail.net",
  "trashmail.com", "trashmail.de", "getnada.com", "nada.email", "maildrop.cc", "dispostable.com", "throwawaymail.com",
  "fakeinbox.com", "mintemail.com", "emailondeck.com", "mohmal.com", "burnermail.io", "mailnesia.com", "mytemp.email",
  "tempr.email", "spamgourmet.com", "mailcatch.com", "inboxkitten.com", "1secmail.com", "moakt.com", "tmpmail.org",
]);

export function isDisposableEmail(email) {
  const domain = String(email).trim().toLowerCase().split("@")[1] ?? "";
  return DISPOSABLE_DOMAINS.has(domain) || [...DISPOSABLE_DOMAINS].some((blocked) => domain.endsWith(`.${blocked}`));
}

export function signupName(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  return name && name.length <= 120 ? name : null;
}

export function isSignupCode(value) {
  return /^\d{6}$/.test(String(value ?? "").trim());
}

// The terms a Google or Microsoft sign-up agreed to travel to the provider and
// back in a short-lived, signed cookie: the account is only created if it is there.
export function signTermsCookie(version, secret, now = Date.now()) {
  const body = `${encodeURIComponent(version)}.${now}`;
  return `${body}.${createHmac("sha256", secret).update(`terms:${body}`).digest("base64url")}`;
}

export function readTermsCookie(value, secret, now = Date.now()) {
  const parts = String(value ?? "").split(".");
  if (parts.length !== 3 || !secret) return null;
  const [version, issued, signature] = parts;
  const expected = createHmac("sha256", secret).update(`terms:${version}.${issued}`).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const at = Number(issued);
  if (!Number.isSafeInteger(at) || at > now + 60_000 || now - at > TERMS_COOKIE_MINUTES * 60_000) return null;
  return { version: decodeURIComponent(version), acceptedAt: new Date(at) };
}

export function cookieValue(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}
