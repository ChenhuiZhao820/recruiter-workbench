import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  LINK_DAYS,
  availableSlots,
  bookingIcs,
  bookingSecret,
  bookingToken,
  googleCalendarUrl,
  noticeVersion,
  parseWindows,
  readBookingToken,
  timeToMinutes,
  validMeetingLink,
  validPhone,
  zonedTimeToUtc,
} from "../lib/booking-core.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const SECRET = "test-only-booking-link-secret-0000000000";
const DAY = 86_400_000;
const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());

test("a booking link reads back only unaltered, for its own candidate, within 30 days", () => {
  const issued = new Date("2026-10-02T09:00:00Z");
  const token = bookingToken(SECRET, "cmcandidate0001", issued);
  assert.match(token, /^cmcandidate0001\.\d+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(readBookingToken(SECRET, token, issued).candidateId, "cmcandidate0001");

  const [id, day, signature] = token.split(".");
  // Another candidate, a later issue date, a changed signature, another key.
  assert.equal(readBookingToken(SECRET, `cmcandidate0002.${day}.${signature}`, issued), null);
  assert.equal(readBookingToken(SECRET, `${id}.${Number(day) + 5}.${signature}`, issued), null);
  assert.equal(readBookingToken(SECRET, `${id}.${day}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`, issued), null);
  assert.equal(readBookingToken("another-secret-of-thirty-two-chars-xx", token, issued), null);
  assert.equal(readBookingToken(null, token, issued), null);
  assert.equal(readBookingToken(SECRET, "garbage", issued), null);

  assert.ok(readBookingToken(SECRET, token, new Date(issued.getTime() + LINK_DAYS * DAY)));
  assert.equal(readBookingToken(SECRET, token, new Date(issued.getTime() + (LINK_DAYS + 1) * DAY)), null);
  // A link dated in the future cannot be made by anyone without the key, but
  // one issued on a server whose clock is slightly ahead still works.
  assert.equal(readBookingToken(SECRET, token, new Date(issued.getTime() - 2 * DAY)), null);

  assert.equal(bookingSecret({ BOOKING_LINK_SECRET: "short" }), null);
  assert.equal(bookingSecret({}), null);
  assert.equal(bookingSecret({ BOOKING_LINK_SECRET: ` ${SECRET} ` }), SECRET);
});

test("wall-clock times survive the clock changes: the skipped hour has no slot, the repeated one counts once", () => {
  const london = "Europe/London";
  assert.equal(zonedTimeToUtc(2026, 3, 29, 60, london), null);
  assert.equal(zonedTimeToUtc(2026, 3, 29, 90, london), null);
  assert.equal(iso(zonedTimeToUtc(2026, 3, 29, 150, london)), "2026-03-29T01:30:00.000Z");
  assert.equal(iso(zonedTimeToUtc(2026, 10, 25, 90, london)), "2026-10-25T00:30:00.000Z");
  assert.equal(iso(zonedTimeToUtc(2026, 7, 1, 600, london)), "2026-07-01T09:00:00.000Z");
  assert.equal(iso(zonedTimeToUtc(2026, 12, 1, 600, london)), "2026-12-01T10:00:00.000Z");
  assert.equal(iso(zonedTimeToUtc(2026, 3, 9, 600, "America/New_York")), "2026-03-09T14:00:00.000Z");
});

test("slots follow the weekly hours across a clock change, keep the notice and horizon, and skip booked time", () => {
  const windows = [{ day: 1, startMin: 9 * 60, endMin: 11 * 60 }];
  const options = { windows, timeZone: "Europe/London", durationMins: 30, minNoticeHours: 0, horizonDays: 14 };
  // Monday 19 October is still summer time; Monday 26 October is not.
  const slots = availableSlots({ ...options, now: new Date("2026-10-18T12:00:00Z") });
  assert.deepEqual(slots.map(iso), [
    "2026-10-19T08:00:00.000Z", "2026-10-19T08:30:00.000Z", "2026-10-19T09:00:00.000Z", "2026-10-19T09:30:00.000Z",
    "2026-10-26T09:00:00.000Z", "2026-10-26T09:30:00.000Z", "2026-10-26T10:00:00.000Z", "2026-10-26T10:30:00.000Z",
  ]);

  const noticed = availableSlots({ ...options, minNoticeHours: 12, now: new Date("2026-10-18T21:00:00Z") });
  assert.equal(iso(noticed[0]), "2026-10-19T09:00:00.000Z");
  const nearOnly = availableSlots({ ...options, horizonDays: 3, now: new Date("2026-10-18T12:00:00Z") });
  assert.equal(nearOnly.length, 4);

  const busy = [{ start: Date.parse("2026-10-19T08:15:00Z"), end: Date.parse("2026-10-19T08:45:00Z") }];
  const freeOfBusy = availableSlots({ ...options, horizonDays: 3, now: new Date("2026-10-18T12:00:00Z"), busy });
  assert.deepEqual(freeOfBusy.map(iso), ["2026-10-19T09:00:00.000Z", "2026-10-19T09:30:00.000Z"]);

  assert.deepEqual(availableSlots({ ...options, timeZone: "Not/AZone" }), []);
  assert.deepEqual(availableSlots({ ...options, windows: [] }), []);
});

test("weekly hours are read defensively, and times are read from the form", () => {
  assert.deepEqual(parseWindows('[{"day":1,"startMin":540,"endMin":1020},{"day":9,"startMin":0,"endMin":60},{"day":2,"startMin":600,"endMin":500},"x"]'), [{ day: 1, startMin: 540, endMin: 1020 }]);
  assert.deepEqual(parseWindows("not json"), []);
  assert.equal(timeToMinutes("09:30"), 570);
  assert.equal(timeToMinutes("24:00"), null);
  assert.equal(timeToMinutes("9:30"), null);
});

test("the calendar file is valid iCalendar: CRLF, escaped text, folded long lines", () => {
  const ics = bookingIcs({
    uid: "bk1", start: Date.parse("2026-10-26T09:00:00Z"), end: Date.parse("2026-10-26T09:30:00Z"),
    summary: "Call with Morven Ellis: Platform Lead, London; hybrid",
    description: `Back\\slash\nand a very long line ${"x".repeat(90)}`,
    location: "https://meet.example/abc", now: new Date("2026-10-02T00:00:00Z"),
  });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.match(ics, /\r\nDTSTART:20261026T090000Z\r\nDTEND:20261026T093000Z\r\n/);
  assert.match(ics, /SUMMARY:Call with Morven Ellis: Platform Lead\\, London\\; hybrid/);
  assert.match(ics, /DESCRIPTION:Back\\\\slash\\nand a very long line/);
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.doesNotMatch(ics.replace(/\r\n/g, ""), /\n/);
});

test("the Google Calendar link, phone numbers, meeting links and the notice version", () => {
  const url = new URL(googleCalendarUrl({ start: Date.parse("2026-10-26T09:00:00Z"), end: Date.parse("2026-10-26T09:30:00Z"), title: "Screening call", details: "Call on +44", location: "https://meet.example/x" }));
  assert.equal(url.origin + url.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(url.searchParams.get("dates"), "20261026T090000Z/20261026T093000Z");
  assert.equal(url.searchParams.get("text"), "Screening call");
  assert.equal(validPhone("+44 7700 900123"), "+44 7700 900123");
  assert.equal(validPhone("call me"), null);
  assert.equal(validPhone("12345"), null);
  assert.equal(validMeetingLink(""), "");
  assert.equal(validMeetingLink("https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
  assert.equal(validMeetingLink("http://meet.example/x"), null);
  assert.equal(validMeetingLink("javascript:alert(1)"), null);
  assert.equal(noticeVersion("a"), noticeVersion("a"));
  assert.notEqual(noticeVersion("a"), noticeVersion("b"));
});

test("booking actions: settings and cancelling are the recruiter's, booking is the link's alone", () => {
  const actions = readFileSync(path.join(root, "app/actions/booking.ts"), "utf8");
  const bodies = Object.fromEntries(actions.split("export async function ").slice(1).map((body) => [body.match(/^\w+/)[0], body]));
  assert.deepEqual(Object.keys(bodies).sort(), ["bookSlot", "cancelBooking", "updateBookingSettings"]);
  assert.match(bodies.updateBookingSettings, /^\w+\([^)]*\)[^{]*\{\n  const user = await requireWritableFeature\("booking"\);/);
  assert.match(bodies.cancelBooking, /^\w+\([^)]*\)[^{]*\{\n  const user = await requireWritableFeature\("booking"\);/);
  assert.match(bodies.cancelBooking, /userId: user\.id, status: "booked", candidate: \{ role: \{ userId: user\.id \} \}/);
  // The public action has no session; it re-reads everything from the link.
  assert.match(bodies.bookSlot, /^\w+\([^)]*\)[^{]*\{\n  assertSameOrigin\(\);\n  const token = /);
  assert.match(bodies.bookSlot, /loadBookingContext\(token, now\)/);
  assert.match(bodies.bookSlot, /free\.includes\(startsAt\)/);
  assert.match(bodies.bookSlot, /takeAuthAttempt\(`book:\$\{candidate\.id\}`/);
  assert.doesNotMatch(bodies.bookSlot, /getWorkspace|requireWritable/);
});
