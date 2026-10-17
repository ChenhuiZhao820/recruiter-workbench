import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  SCOPES,
  authorizeUrl,
  calendarKey,
  decryptToken,
  encryptToken,
  endpoints,
  googleBusy,
  microsoftBusy,
  providerCredentials,
  readState,
  signState,
} from "../lib/calendar-core.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const key = createHash("sha256").update("test-only-calendar-token-key-00000000000").digest();
const otherKey = createHash("sha256").update("another-calendar-key-0000000000000000000").digest();

test("a stored token reads back only with the right key and unaltered", () => {
  const sealed = encryptToken(key, "1//refresh-token-value");
  assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.doesNotMatch(sealed, /refresh-token-value/);
  assert.equal(decryptToken(key, sealed), "1//refresh-token-value");
  assert.notEqual(encryptToken(key, "same"), encryptToken(key, "same"));
  assert.equal(decryptToken(otherKey, sealed), null);
  const [v, iv, tag, data] = sealed.split(".");
  assert.equal(decryptToken(key, [v, iv, tag, data.slice(0, -2) + (data.endsWith("A") ? "BB" : "AA")].join(".")), null);
  assert.equal(decryptToken(key, "not a token"), null);
});

test("the sign-in state names who asked and for which calendar, and expires", () => {
  const now = new Date("2026-10-04T10:00:00Z");
  const state = signState(key, "user-1", "google", now);
  assert.deepEqual(readState(key, state, now), { userId: "user-1", provider: "google" });
  assert.equal(readState(otherKey, state, now), null);
  assert.equal(readState(key, state.replace("user-1", "user-2"), now), null);
  assert.equal(readState(key, state.replace(".google.", ".microsoft."), now), null);
  assert.equal(readState(key, state, new Date(now.getTime() + 11 * 60_000)), null);
  assert.equal(readState(key, "", now), null);
});

test("the provider is asked for the narrowest free/busy permission, offline, with the signed state", () => {
  const google = new URL(authorizeUrl("google", { clientId: "cid", redirectUri: "https://capture.example/api/calendar/callback/google", state: "s1" }, {}));
  assert.equal(google.origin + google.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(google.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.events.freebusy");
  assert.equal(google.searchParams.get("access_type"), "offline");
  assert.equal(google.searchParams.get("prompt"), "consent");
  assert.equal(google.searchParams.get("state"), "s1");
  const microsoft = new URL(authorizeUrl("microsoft", { clientId: "cid", redirectUri: "https://capture.example/cb", state: "s2" }, {}));
  assert.equal(microsoft.origin, "https://login.microsoftonline.com");
  assert.equal(microsoft.searchParams.get("scope"), SCOPES.microsoft);
  assert.doesNotMatch(SCOPES.microsoft, /ReadWrite|Calendars\.Read(\s|$)/);
});

test("test endpoints are honoured outside production only, and a provider needs credentials and a key", () => {
  assert.equal(endpoints("google", { CAPTURE_TEST_CALENDAR_BASE_URL: "http://localhost:8766/calendar" }).token, "http://localhost:8766/calendar/google/token");
  assert.equal(endpoints("google", { NODE_ENV: "production", CAPTURE_TEST_CALENDAR_BASE_URL: "http://localhost:8766/calendar" }).token, "https://oauth2.googleapis.com/token");
  const env = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", CALENDAR_TOKEN_KEY: "test-only-calendar-token-key-00000000000" };
  assert.deepEqual(providerCredentials("google", env), { clientId: "id", clientSecret: "secret" });
  assert.equal(providerCredentials("google", { ...env, CALENDAR_TOKEN_KEY: "short" }), null);
  assert.equal(providerCredentials("microsoft", env), null);
  assert.equal(calendarKey({}), null);
});

test("busy times are read from each provider's reply; free time and junk are not busy", () => {
  assert.deepEqual(googleBusy({ calendars: { primary: { busy: [
    { start: "2026-10-05T09:00:00Z", end: "2026-10-05T10:00:00Z" },
    { start: "nonsense", end: "2026-10-05T10:00:00Z" },
    { start: "2026-10-05T11:00:00Z", end: "2026-10-05T11:00:00Z" },
  ] } } }), [{ start: Date.parse("2026-10-05T09:00:00Z"), end: Date.parse("2026-10-05T10:00:00Z") }]);
  assert.equal(googleBusy({}), null);
  const ms = microsoftBusy({ value: [
    { start: { dateTime: "2026-10-05T09:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-05T09:30:00.0000000", timeZone: "UTC" }, showAs: "busy" },
    { start: { dateTime: "2026-10-05T12:00:00.0000000" }, end: { dateTime: "2026-10-05T13:00:00.0000000" }, showAs: "free" },
    { start: { dateTime: "2026-10-05T14:00:00.0000000" }, end: { dateTime: "2026-10-05T15:00:00.0000000" }, showAs: "workingElsewhere" },
    { start: { dateTime: "2026-10-05T16:00:00.0000000" }, end: { dateTime: "2026-10-05T17:00:00.0000000" }, showAs: "tentative" },
  ] });
  assert.deepEqual(ms, [
    { start: Date.parse("2026-10-05T09:00:00Z"), end: Date.parse("2026-10-05T09:30:00Z") },
    { start: Date.parse("2026-10-05T16:00:00Z"), end: Date.parse("2026-10-05T17:00:00Z") },
  ]);
  assert.equal(microsoftBusy({ error: "x" }), null);
});

test("connecting is the signed-in account's own, and only with the feature", () => {
  const connect = readFileSync(path.join(root, "app/api/calendar/connect/[provider]/route.ts"), "utf8");
  const callback = readFileSync(path.join(root, "app/api/calendar/callback/[provider]/route.ts"), "utf8");
  const actions = readFileSync(path.join(root, "app/actions/calendar.ts"), "utf8");
  for (const source of [connect, callback]) {
    assert.match(source, /canUseFeature\(session\.user, "calendarFreeBusy"\)/);
    assert.match(source, /session\.viewUserId && session\.viewUserId !== session\.user\.id/);
  }
  assert.match(callback, /state\.userId !== session\.user\.id \|\| state\.provider !== params\.provider/);
  assert.match(actions, /const user = await requireWritableFeature\("calendarFreeBusy"\);/);
  // The token never leaves the server in an export or a page.
  assert.doesNotMatch(readFileSync(path.join(root, "lib/export.ts"), "utf8"), /calendarConnection|tokenCipher: true/);
});
