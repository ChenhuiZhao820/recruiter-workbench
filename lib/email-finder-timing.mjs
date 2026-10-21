// The parts of the email finder the browser needs too: how often the page
// asks how a search is going, and how the searches left are said. Kept apart
// from lib/enrow-core.mjs, which reads profile addresses with node:crypto.

// A search is started with one request and read with others until it ends.
// The page asks every POLL_MS and gives up after GIVE_UP_MS; a pending search
// older than PENDING_COUNTS_MS no longer holds a place in the allowance, so a
// page closed mid-search does not keep it forever.
export const POLL_MS = 2000;
export const GIVE_UP_MS = 60_000;
export const PENDING_COUNTS_MS = 10 * 60_000;

export function remainingText({ remaining, quota, trial }) {
  return `${remaining} of ${quota} email ${quota === 1 ? "search" : "searches"} left ${trial ? "in your trial" : "this month"}`;
}
