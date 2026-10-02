import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// The booking page's rules, shared by the app and the unit tests: the signed
// link, the free slots and the calendar file. Nothing here touches the
// database or the network.

export const LINK_DAYS = 30;
export const DURATIONS = [15, 20, 30, 45, 60];
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]; // Monday first, Sunday last
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MS = 86_400_000;

// --- Links ------------------------------------------------------------------
//
// /book/<candidateId>.<issuedDay>.<signature>. The signature is an HMAC of the
// candidate and the UTC day the link was made, keyed by BOOKING_LINK_SECRET,
// so a link cannot be guessed, moved to another candidate or given a later
// date. Making one writes nothing, so rendering an outreach queue stays pure.

function sign(secret, candidateId, issuedDay) {
  return createHmac("sha256", secret).update(`capture-booking:v1:${candidateId}.${issuedDay}`).digest("base64url");
}

export function utcDay(now = new Date()) {
  return Math.floor(now.getTime() / DAY_MS);
}

export function bookingSecret(env = process.env) {
  const secret = env.BOOKING_LINK_SECRET?.trim() ?? "";
  return secret.length >= 32 ? secret : null;
}

export function bookingToken(secret, candidateId, now = new Date()) {
  const day = utcDay(now);
  return `${candidateId}.${day}.${sign(secret, candidateId, day)}`;
}

// Returns the candidate id for a genuine, unexpired link, otherwise null.
export function readBookingToken(secret, token, now = new Date()) {
  if (!secret || typeof token !== "string" || token.length > 200) return null;
  const match = token.match(/^([a-z0-9]{8,40})\.(\d{1,7})\.([A-Za-z0-9_-]{43})$/);
  if (!match) return null;
  const [, candidateId, dayText, signature] = match;
  const day = Number(dayText);
  const expected = Buffer.from(sign(secret, candidateId, day));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const today = utcDay(now);
  if (day > today + 1 || today - day > LINK_DAYS) return null;
  return { candidateId, issuedDay: day, expiresAt: new Date((day + LINK_DAYS + 1) * DAY_MS) };
}

// --- Time zones -------------------------------------------------------------

const formatters = new Map();
function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat("en-GB", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }));
  }
  return formatters.get(timeZone);
}

export function isTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

// The wall-clock reading in a time zone at an instant.
export function zonedParts(ms, timeZone) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute, second: +parts.second };
}

function offsetMs(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// The instant a wall-clock time happens in a time zone, or null when it never
// happens (the hour skipped when the clocks go forward). In the repeated hour
// when they go back, the first of the two is used.
export function zonedTimeToUtc(year, month, day, minutes, timeZone) {
  const wall = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  const guesses = [wall - offsetMs(wall - 12 * 3_600_000, timeZone), wall - offsetMs(wall + 12 * 3_600_000, timeZone)].sort((a, b) => a - b);
  for (const ms of guesses) {
    const p = zonedParts(ms, timeZone);
    if (p.year === year && p.month === month && p.day === day && p.hour * 60 + p.minute === minutes) return ms;
  }
  return null;
}

// --- Weekly hours -----------------------------------------------------------

// Settings.bookingWindows: [{ day: 0-6 (Sunday 0), startMin, endMin }] in the
// recruiter's own time zone. Anything malformed is dropped rather than trusted.
export function parseWindows(json) {
  let value;
  try {
    value = JSON.parse(json ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((w) => w && Number.isInteger(w.day) && w.day >= 0 && w.day <= 6 && Number.isInteger(w.startMin) && Number.isInteger(w.endMin) && w.startMin >= 0 && w.endMin <= 1440 && w.startMin < w.endMin)
    .map(({ day, startMin, endMin }) => ({ day, startMin, endMin }))
    .slice(0, 21);
}

export function timeToMinutes(text) {
  const match = String(text ?? "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function minutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// --- Slots ------------------------------------------------------------------

// Free start times, as UTC milliseconds in order: the weekly hours stepped by
// the call length, from the minimum notice to the horizon, less anything that
// overlaps a busy period (booked calls now, calendar busy blocks later).
/**
 * @param {{ windows: { day: number, startMin: number, endMin: number }[], timeZone: string, durationMins: number,
 *   minNoticeHours: number, horizonDays: number, now?: Date, busy?: { start: number, end: number }[] }} options
 * @returns {number[]}
 */
export function availableSlots({ windows, timeZone, durationMins, minNoticeHours, horizonDays, now = new Date(), busy = [] }) {
  if (!windows.length || !isTimeZone(timeZone) || !(durationMins > 0)) return [];
  const earliest = now.getTime() + minNoticeHours * 3_600_000;
  const latest = now.getTime() + horizonDays * DAY_MS;
  const duration = durationMins * 60_000;
  const today = zonedParts(now.getTime(), timeZone);
  const slots = new Set();
  for (let offset = 0; offset <= horizonDays + 1; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const [y, m, d, weekday] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCDay()];
    for (const window of windows) {
      if (window.day !== weekday) continue;
      for (let start = window.startMin; start + durationMins <= window.endMin; start += durationMins) {
        const ms = zonedTimeToUtc(y, m, d, start, timeZone);
        if (ms === null || ms < earliest || ms > latest) continue;
        if (busy.some((b) => ms < b.end && ms + duration > b.start)) continue;
        slots.add(ms);
      }
    }
  }
  return [...slots].sort((a, b) => a - b);
}

// --- Calendar file ----------------------------------------------------------

function icsText(text) {
  return String(text ?? "")
    .split("\\").join("\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/([,;])/g, "\\$1");
}

function icsDate(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// Lines longer than 75 octets are folded, as RFC 5545 asks.
function fold(line) {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

export function bookingIcs({ uid, start, end, summary, description, location, now = new Date() }) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Capture//Booking//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}@capture`,
    `DTSTAMP:${icsDate(now.getTime())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(summary)}`,
    description ? `DESCRIPTION:${icsText(description)}` : null,
    location ? `LOCATION:${icsText(location)}` : null,
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean);
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function googleCalendarUrl({ start, end, title, details, location }) {
  const params = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${icsDate(start)}/${icsDate(end)}` });
  if (details) params.set("details", details);
  if (location) params.set("location", location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// Which version of the privacy notice a candidate was shown.
export function noticeVersion(text) {
  return createHash("sha256").update(String(text ?? "")).digest("hex").slice(0, 16);
}

export function validPhone(text) {
  const value = String(text ?? "").trim();
  return /^\+?[0-9 ()-]{7,20}$/.test(value) && (value.match(/\d/g) ?? []).length >= 7 ? value : null;
}

// "" for no link, null for a link that is not HTTPS.
export function validMeetingLink(text) {
  const value = String(text ?? "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}
