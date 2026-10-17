import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Reading a recruiter's own calendar for busy times, read-only, so the booking
// page does not offer a time they already have something in. Shared by the app
// and the unit tests. Only busy periods are ever asked for or kept: never what
// the events are, who is in them, or where.

export const PROVIDERS = ["google", "microsoft"];
/** @type {Record<string, string>} */
export const PROVIDER_LABELS = { google: "Google Calendar", microsoft: "Outlook / Microsoft 365" };
// The narrowest permissions each provider offers for this, checked against
// their documentation: Google's free/busy-only scope, and Microsoft's basic
// calendar read plus offline_access so the connection outlasts the session.
export const SCOPES = {
  google: "https://www.googleapis.com/auth/calendar.events.freebusy",
  microsoft: "offline_access https://graph.microsoft.com/Calendars.ReadBasic",
};
export const PROVIDER_TIMEOUT_MS = 3000;
const STATE_MINUTES = 10;

// Real endpoints, or a test server's when CAPTURE_TEST_CALENDAR_BASE_URL is set
// outside production.
export function endpoints(provider, env = process.env) {
  const test = env.NODE_ENV !== "production" ? env.CAPTURE_TEST_CALENDAR_BASE_URL?.replace(/\/$/, "") : "";
  if (provider === "google") {
    return test
      ? { authorize: `${test}/google/authorize`, token: `${test}/google/token`, busy: `${test}/google/freeBusy`, revoke: `${test}/google/revoke` }
      : { authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", busy: "https://www.googleapis.com/calendar/v3/freeBusy", revoke: "https://oauth2.googleapis.com/revoke" };
  }
  return test
    ? { authorize: `${test}/microsoft/authorize`, token: `${test}/microsoft/token`, busy: `${test}/microsoft/calendarView`, revoke: null }
    : { authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/common/oauth2/v2.0/token", busy: "https://graph.microsoft.com/v1.0/me/calendarView", revoke: null };
}

export function calendarKey(env = process.env) {
  const secret = env.CALENDAR_TOKEN_KEY?.trim() ?? "";
  return secret.length >= 32 ? createHash("sha256").update(secret).digest() : null;
}

// A provider can be offered only when the server has its app credentials and
// a key to keep the tokens with.
export function providerCredentials(provider, env = process.env) {
  const prefix = provider === "google" ? "GOOGLE" : "MICROSOFT";
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
  return clientId && clientSecret && calendarKey(env) ? { clientId, clientSecret } : null;
}

// --- Tokens at rest -----------------------------------------------------------

// AES-256-GCM: "v1.<iv>.<tag>.<ciphertext>", base64url. A wrong key or an
// altered value reads back as null, never as garbage.
export function encryptToken(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptToken(key, sealed) {
  try {
    const [version, iv, tag, data] = String(sealed).split(".");
    if (version !== "v1" || !iv || !tag || !data) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// --- The OAuth round trip -----------------------------------------------------

// The state carries who started the connection, for which provider, until
// when, signed, so a forged or replayed reply cannot attach a calendar to
// someone else's account.
export function signState(key, userId, provider, now = new Date()) {
  const expires = now.getTime() + STATE_MINUTES * 60_000;
  const body = `${userId}.${provider}.${expires}.${randomBytes(8).toString("base64url")}`;
  return `${body}.${createHmac("sha256", key).update(`calendar-state:${body}`).digest("base64url")}`;
}

export function readState(key, state, now = new Date()) {
  const parts = String(state ?? "").split(".");
  if (parts.length !== 5) return null;
  const [userId, provider, expires, nonce, signature] = parts;
  const body = `${userId}.${provider}.${expires}.${nonce}`;
  const expected = Buffer.from(createHmac("sha256", key).update(`calendar-state:${body}`).digest("base64url"));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!PROVIDERS.includes(provider) || !(Number(expires) > now.getTime())) return null;
  return { userId, provider };
}

export function authorizeUrl(provider, { clientId, redirectUri, state }, env = process.env) {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES[provider], state });
  if (provider === "google") {
    params.set("access_type", "offline");
    // Asked every time so Google returns a refresh token on a reconnect too.
    params.set("prompt", "consent");
    params.set("include_granted_scopes", "false");
  } else {
    params.set("response_mode", "query");
    params.set("prompt", "select_account");
  }
  return `${endpoints(provider, env).authorize}?${params.toString()}`;
}

// --- Busy times -------------------------------------------------------------

// Google freeBusy: calendars.primary.busy[{start, end}].
export function googleBusy(body) {
  const busy = body?.calendars?.primary?.busy;
  if (!Array.isArray(busy)) return null;
  return busy
    .map((item) => ({ start: Date.parse(item?.start), end: Date.parse(item?.end) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
}

// Microsoft calendarView: value[{start:{dateTime,timeZone}, end, showAs}], in
// UTC when no Prefer header is sent. Free and working-elsewhere time is not busy.
export function microsoftBusy(body) {
  const items = body?.value;
  if (!Array.isArray(items)) return null;
  const utc = (point) => (point?.dateTime ? Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(point.dateTime) ? point.dateTime : `${point.dateTime}Z`) : NaN);
  return items
    .filter((item) => !["free", "workingElsewhere"].includes(item?.showAs))
    .map((item) => ({ start: utc(item.start), end: utc(item.end) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
}
