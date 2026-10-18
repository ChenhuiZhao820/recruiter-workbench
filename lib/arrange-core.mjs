import { isTimeZone, zonedTimeToUtc } from "./booking-core.mjs";

// Arranging a client interview by hand, without the role having weekly
// interview hours: the recruiter either sets the time agreed with both sides,
// or offers the candidate two or three times to choose from. The rules for
// reading those times and for which offered times are still open live here,
// shared with the unit tests. Nothing here touches the database.

export const ARRANGE_DURATIONS = [30, 45, 60, 90];
export const MAX_OFFER_TIMES = 3;
// How far ahead a time may be set: an interview months away is a typo.
export const ARRANGE_HORIZON_DAYS = 120;
// An offered time stops being offered this close to it, so nobody books an
// interview that starts before they could read the confirmation.
export const OFFER_CUTOFF_MINUTES = 60;

const DAY_MS = 86_400_000;

// A date ("2026-10-21") and a time ("14:30") read in a time zone, as an
// instant; null when either is missing, malformed or does not exist there.
export function readWhen(date, time, timeZone) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? "").trim());
  const t = /^(\d{2}):(\d{2})$/.exec(String(time ?? "").trim());
  if (!d || !t || !isTimeZone(timeZone)) return null;
  const hour = Number(t[1]);
  const minute = Number(t[2]);
  if (hour > 23 || minute > 59) return null;
  return zonedTimeToUtc(Number(d[1]), Number(d[2]), Number(d[3]), hour * 60 + minute, timeZone);
}

// Where the interview happens: a meeting link (https only) or an address in
// words. Anything else, or a link that is not https, is refused.
export function readPlace(text) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!value) return { ok: true, url: null, place: null };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^www\./i.test(value)) {
    try {
      const url = new URL(/^www\./i.test(value) ? `https://${value}` : value);
      if (url.protocol !== "https:" || !url.hostname.includes(".")) return { ok: false, error: "A meeting link must start with https://." };
      return { ok: true, url: url.toString(), place: null };
    } catch {
      return { ok: false, error: "That meeting link is not a web address." };
    }
  }
  return { ok: true, url: null, place: value };
}

// The common fields of both forms: zone, length and place.
export function readArrangement({ timeZone, durationMins, location }) {
  if (!isTimeZone(String(timeZone ?? ""))) return { error: "Choose the time zone these times are in." };
  const duration = Number(durationMins);
  if (!ARRANGE_DURATIONS.includes(duration)) return { error: "Choose how long the interview lasts." };
  const place = readPlace(location);
  if (!place.ok) return { error: place.error };
  return { data: { timeZone: String(timeZone), durationMins: duration, url: place.url, place: place.place } };
}

function inRange(ms, now) {
  return ms > now.getTime() && ms < now.getTime() + ARRANGE_HORIZON_DAYS * DAY_MS;
}

// The one time the recruiter agreed with both sides.
export function readSetTime({ date, time, timeZone }, now = new Date()) {
  const at = readWhen(date, time, timeZone);
  if (at === null) return { error: "Enter the date and time of the interview." };
  if (!inRange(at, now)) return { error: at <= now.getTime() ? "That time has already passed." : `Choose a time within ${ARRANGE_HORIZON_DAYS} days.` };
  return { at };
}

// Up to three times to offer. Rows left empty are skipped; a row with only a
// date or only a time is an error, because it is half of something meant.
export function readOfferTimes(rows, timeZone, now = new Date()) {
  const times = [];
  for (const [index, row] of rows.slice(0, MAX_OFFER_TIMES).entries()) {
    const date = String(row.date ?? "").trim();
    const time = String(row.time ?? "").trim();
    if (!date && !time) continue;
    const at = readWhen(date, time, timeZone);
    if (at === null) return { error: `Time ${index + 1} needs both a date and a time.` };
    if (at < now.getTime() + 2 * OFFER_CUTOFF_MINUTES * 60_000) return { error: `Time ${index + 1} is too soon to offer. Offer times at least two hours ahead.` };
    if (!inRange(at, now)) return { error: `Time ${index + 1} is more than ${ARRANGE_HORIZON_DAYS} days away.` };
    if (!times.includes(at)) times.push(at);
  }
  if (times.length === 0) return { error: "Offer at least one time." };
  return { times: times.sort((a, b) => a - b) };
}

export function parseOfferTimes(json) {
  try {
    const value = JSON.parse(String(json ?? "[]"));
    return Array.isArray(value) ? value.filter((ms) => Number.isInteger(ms)).sort((a, b) => a - b) : [];
  } catch {
    return [];
  }
}

// The times of an offer the candidate can still choose: not withdrawn, not
// already booked, not too close, and not overlapping an interview already
// booked with the same client.
export function openOfferTimes(offer, now = new Date(), busy = []) {
  if (!offer || offer.withdrawnAt || offer.bookingId) return [];
  const cutoff = now.getTime() + OFFER_CUTOFF_MINUTES * 60_000;
  const length = offer.durationMins * 60_000;
  return parseOfferTimes(offer.times).filter((start) => start >= cutoff && !busy.some((b) => start < b.end && start + length > b.start));
}

export function offerIsOpen(offer, now = new Date(), busy = []) {
  return openOfferTimes(offer, now, busy).length > 0;
}

// The message to the candidate once a time is set, or once times are offered.
// Plain text, for the recruiter to read, change and send from LinkedIn.
export function arrangeMessage({ kind, firstName, client, roleTitle, when, link, recruiterName }) {
  const hello = `Hi ${firstName},`;
  const sign = recruiterName ? `\n\n${recruiterName}` : "";
  if (kind === "booked") {
    return `${hello}\n\nGood news: ${client} would like to meet you about the ${roleTitle} role. The interview is booked for ${when}.\n\nThe details and a calendar file are here: ${link}\n\nIf that time no longer works, just reply and I will move it.${sign}`;
  }
  return `${hello}\n\nGood news: ${client} would like to meet you about the ${roleTitle} role. Could you pick the time that suits you best here? ${link}\n\nIf none of them work, reply with a few times that do.${sign}`;
}

export const ARRANGE_ZONES = ["Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Shanghai", "Australia/Sydney"];

// "Tuesday 21 October at 14:00 (London time)", in the zone it was arranged in.
export function whenText(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  const city = timeZone.split("/").pop().replace(/_/g, " ");
  return `${get("weekday")} ${get("day")} ${get("month")} at ${get("hour")}:${get("minute")} (${city} time)`;
}

// Tomorrow's date in a zone, as the date input wants it: a sensible start.
export function tomorrowIn(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() + DAY_MS));
  return parts;
}
