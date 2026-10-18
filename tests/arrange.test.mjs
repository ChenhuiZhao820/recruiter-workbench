import test from "node:test";
import assert from "node:assert/strict";
import {
  ARRANGE_HORIZON_DAYS, OFFER_CUTOFF_MINUTES, arrangeMessage, offerIsOpen, openOfferTimes, parseOfferTimes,
  readArrangement, readOfferTimes, readPlace, readSetTime, readWhen, tomorrowIn, whenText,
} from "../lib/arrange-core.mjs";
import { interviewLinkState } from "../lib/shortlist-core.mjs";

// Arranging a client interview by hand: reading the times a recruiter types,
// which offered times are still open, and when the interview link exists.

const NOW = new Date("2026-10-19T09:00:00Z");
const HOUR = 3_600_000;

test("a date and time are read in the zone they were typed in", () => {
  assert.equal(readWhen("2026-10-21", "14:30", "Europe/London"), Date.parse("2026-10-21T13:30:00Z"));
  assert.equal(readWhen("2026-10-21", "14:30", "Asia/Shanghai"), Date.parse("2026-10-21T06:30:00Z"));
  // After the clocks go back in London, the same wall time is an hour later in UTC.
  assert.equal(readWhen("2026-10-26", "14:30", "Europe/London"), Date.parse("2026-10-26T14:30:00Z"));
  // A time that does not exist there (clocks going forward) is refused.
  assert.equal(readWhen("2027-03-28", "01:30", "Europe/London"), null);
  for (const [date, time, zone] of [["", "10:00", "Europe/London"], ["2026-10-21", "", "Europe/London"], ["21/10/2026", "10:00", "Europe/London"], ["2026-10-21", "25:00", "Europe/London"], ["2026-10-21", "10:00", "Mars/Base"]]) {
    assert.equal(readWhen(date, time, zone), null, `${date} ${time} ${zone}`);
  }
});

test("where it happens is an https meeting link or words, never another kind of link", () => {
  assert.deepEqual(readPlace(""), { ok: true, url: null, place: null });
  assert.deepEqual(readPlace(" https://meet.example.com/abc "), { ok: true, url: "https://meet.example.com/abc", place: null });
  assert.deepEqual(readPlace("www.zoom.example/j/1"), { ok: true, url: "https://www.zoom.example/j/1", place: null });
  assert.deepEqual(readPlace("1 King Street,   Manchester"), { ok: true, url: null, place: "1 King Street, Manchester" });
  assert.equal(readPlace("http://meet.example.com").ok, false);
  assert.equal(readPlace("javascript://alert(1)").ok, false);
  assert.equal(readArrangement({ timeZone: "Europe/London", durationMins: "50", location: "" }).error, "Choose how long the interview lasts.");
  assert.equal(readArrangement({ timeZone: "Nowhere", durationMins: "45", location: "" }).error, "Choose the time zone these times are in.");
  assert.deepEqual(readArrangement({ timeZone: "Europe/London", durationMins: "45", location: "https://meet.example.com/x" }).data, { timeZone: "Europe/London", durationMins: 45, url: "https://meet.example.com/x", place: null });
});

test("a set time must be ahead, and not months ahead", () => {
  assert.equal(readSetTime({ date: "2026-10-21", time: "10:00", timeZone: "Europe/London" }, NOW).at, Date.parse("2026-10-21T09:00:00Z"));
  assert.equal(readSetTime({ date: "2026-10-18", time: "10:00", timeZone: "Europe/London" }, NOW).error, "That time has already passed.");
  assert.match(readSetTime({ date: "2027-06-01", time: "10:00", timeZone: "Europe/London" }, NOW).error, new RegExp(`${ARRANGE_HORIZON_DAYS} days`));
  assert.equal(readSetTime({ date: "", time: "", timeZone: "Europe/London" }, NOW).error, "Enter the date and time of the interview.");
});

test("offered times: empty rows skipped, half rows refused, too soon refused, repeats once, sorted", () => {
  const zone = "Europe/London";
  const read = readOfferTimes([{ date: "2026-10-23", time: "15:00" }, { date: "", time: "" }, { date: "2026-10-22", time: "11:00" }], zone, NOW);
  assert.deepEqual(read.times, [Date.parse("2026-10-22T10:00:00Z"), Date.parse("2026-10-23T14:00:00Z")]);
  assert.deepEqual(readOfferTimes([{ date: "2026-10-22", time: "11:00" }, { date: "2026-10-22", time: "11:00" }], zone, NOW).times, [Date.parse("2026-10-22T10:00:00Z")]);
  assert.equal(readOfferTimes([{ date: "2026-10-22", time: "" }], zone, NOW).error, "Time 1 needs both a date and a time.");
  assert.equal(readOfferTimes([{}, {}, {}], zone, NOW).error, "Offer at least one time.");
  assert.match(readOfferTimes([{ date: "2026-10-19", time: "11:00" }], zone, NOW).error, /too soon/);
  assert.match(readOfferTimes([{ date: "2027-06-01", time: "11:00" }], zone, NOW).error, /days away/);
  // Only three are read, whatever arrives.
  const four = Array.from({ length: 4 }, (_, i) => ({ date: `2026-10-2${i + 2}`, time: "10:00" }));
  assert.equal(readOfferTimes(four, zone, NOW).times.length, 3);
});

test("an offer's open times leave out the passed, the too-close and what clashes with the client's other interviews", () => {
  const times = [NOW.getTime() + 30 * 60_000, NOW.getTime() + 3 * HOUR, NOW.getTime() + 26 * HOUR, NOW.getTime() + 50 * HOUR];
  const offer = { times: JSON.stringify(times), durationMins: 60, withdrawnAt: null, bookingId: null };
  // Inside the cutoff the first is gone.
  assert.deepEqual(openOfferTimes(offer, NOW), times.slice(1));
  assert.ok(30 < OFFER_CUTOFF_MINUTES);
  // An interview already booked with the client over the third time removes it.
  const busy = [{ start: times[2] + 30 * 60_000, end: times[2] + 90 * 60_000 }];
  assert.deepEqual(openOfferTimes(offer, NOW, busy), [times[1], times[3]]);
  assert.deepEqual(openOfferTimes({ ...offer, withdrawnAt: NOW }, NOW), []);
  assert.deepEqual(openOfferTimes({ ...offer, bookingId: "b" }, NOW), []);
  assert.equal(offerIsOpen({ ...offer, times: JSON.stringify([NOW.getTime() - HOUR]) }, NOW), false);
  assert.deepEqual(parseOfferTimes("not json"), []);
  assert.deepEqual(parseOfferTimes(JSON.stringify([3, "x", 1.5, 2])), [2, 3]);
});

test("an open offer stands in for weekly hours and the client's answer; nothing else changes", () => {
  const role = { id: "r", status: "open", clientReviewFirst: true, interviewWindows: "[]", interviewTimezone: null, interviewDurationMins: null };
  const candidate = { id: "c", roleId: "r", stage: "submitted" };
  const person = { doNotContact: false };
  const item = { candidateId: "c", consentAt: new Date(), decision: null };
  assert.deepEqual(interviewLinkState({ role, candidate, person, item }), { ok: false, reason: "no_hours" });
  assert.deepEqual(interviewLinkState({ role, candidate, person, item, offered: true }), { ok: true, reason: null });
  // Still refused for a closed role, a closed candidate, do not contact, or no consent.
  assert.equal(interviewLinkState({ role: { ...role, status: "closed" }, candidate, person, item, offered: true }).reason, "role_closed");
  assert.equal(interviewLinkState({ role, candidate: { ...candidate, stage: "rejected" }, person, item, offered: true }).reason, "candidate_closed");
  assert.equal(interviewLinkState({ role, candidate, person: { doNotContact: true }, item, offered: true }).reason, "do_not_contact");
  assert.equal(interviewLinkState({ role, candidate, person, item: null, offered: true }).reason, "not_put_forward");
});

test("the message names the client, the role and the time, and carries the link", () => {
  const booked = arrangeMessage({ kind: "booked", firstName: "Daniel", client: "Basanite", roleTitle: "Head of Marketing", when: "Tuesday 21 October at 14:00 (London time)", link: "https://x/book/t", recruiterName: "Lynn Zhao" });
  assert.match(booked, /^Hi Daniel,/);
  assert.match(booked, /Basanite would like to meet you about the Head of Marketing role\. The interview is booked for Tuesday 21 October at 14:00 \(London time\)\./);
  assert.match(booked, /https:\/\/x\/book\/t/);
  assert.match(booked, /Lynn Zhao$/);
  const offered = arrangeMessage({ kind: "offered", firstName: "Daniel", client: "Basanite", roleTitle: "Head of Marketing", link: "https://x/book/t", recruiterName: "" });
  assert.match(offered, /pick the time that suits you best here\? https:\/\/x\/book\/t/);
  assert.equal(whenText(Date.parse("2026-10-21T13:00:00Z"), "Europe/London"), "Wednesday 21 October at 14:00 (London time)");
  assert.equal(tomorrowIn("Europe/London", NOW), "2026-10-20");
});
