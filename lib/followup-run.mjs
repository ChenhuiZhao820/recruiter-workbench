// A follow-up run: the people the follow-up buckets say are due, ticked or not
// with a reason, then walked through one at a time. Shared by the pages and
// the unit tests. Nothing here sends, opens or writes anything.

const DAY_MS = 86_400_000;

// The three groups, in the order a run takes them: people waiting on a reply
// from you first, then people who said yes and have not booked, then people
// who went quiet. Inside a group, whoever has waited longest comes first.
/** @type {("r" | "b" | "q")[]} */
export const GROUPS = ["r", "b", "q"];
export const GROUP_LABELS = {
  r: "Replied, waiting on you",
  b: "Said yes, never booked",
  q: "Went quiet",
};
export const MAX_RUN = 100;
// Two nudges without an answer is usually an answer.
export const NUDGE_LIMIT = 2;

/**
 * @typedef {{ candidateId: string, candidateName: string, roleTitle: string, lastEventAt: Date,
 *   nudgeCount?: number, doNotContact?: boolean, lastSentAt?: Date | null }} RunRow
 * @typedef {{ group: string, row: RunRow, checked: boolean, locked: boolean, reason: string, note: string | null }} PlannedRow
 */

function days(from, now) {
  return Math.max(0, Math.floor((now.getTime() - new Date(from).getTime()) / DAY_MS));
}

// "today", "1 day ago", "9 days ago".
function ago(row, now) {
  const n = days(row.lastEventAt, now);
  return n === 0 ? "today" : n === 1 ? "1 day ago" : `${n} days ago`;
}

/**
 * Every due person, each with whether they start ticked, whether they can be
 * ticked at all, and why. `only` limits the run to one group.
 * @param {{ repliedWaiting: RunRow[], saidYesNeverBooked: RunRow[], wentQuiet: RunRow[] }} buckets
 * @param {{ now?: Date, only?: string | null }} [options]
 * @returns {PlannedRow[]}
 */
export function planRun(buckets, { now = new Date(), only = null } = {}) {
  const today = Math.floor(now.getTime() / DAY_MS);
  const source = { r: buckets.repliedWaiting, b: buckets.saidYesNeverBooked, q: buckets.wentQuiet };
  /** @type {PlannedRow[]} */
  const planned = [];
  for (const group of GROUPS) {
    const rows = [...(source[group] ?? [])].sort((a, b) => new Date(a.lastEventAt).getTime() - new Date(b.lastEventAt).getTime());
    for (const row of rows) {
      const reason = group === "r"
        ? `Replied ${ago(row, now)}`
        : group === "b"
          ? `Said yes ${ago(row, now)}, no booking`
          : `Last contact ${ago(row, now)}${row.nudgeCount ? `, nudged ${row.nudgeCount}x` : ""}`;
      let checked = only ? group === only : true;
      let locked = false;
      let note = null;
      if (row.doNotContact) {
        checked = false;
        locked = true;
        note = "Do not contact";
      } else if (row.lastSentAt && Math.floor(new Date(row.lastSentAt).getTime() / DAY_MS) === today) {
        checked = false;
        locked = true;
        note = "Already written to today";
      } else if (group === "q" && (row.nudgeCount ?? 0) >= NUDGE_LIMIT) {
        checked = false;
        note = `Nudged ${row.nudgeCount} times without an answer. Consider marking them rejected.`;
      }
      planned.push({ group, row, checked, locked, reason, note });
    }
  }
  return planned;
}

// The run lives in the address as c=<group>.<candidateId>, in order. Anything
// that is not that shape, repeats, or runs past the limit is dropped.
/**
 * @param {string | string[] | undefined} values
 * @returns {{ group: "r" | "b" | "q", candidateId: string }[]}
 */
export function readRunEntries(values) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  const seen = new Set();
  const entries = [];
  for (const value of list) {
    const match = /^([rbq])\.([a-z0-9]{8,40})$/.exec(String(value));
    if (!match || seen.has(match[2])) continue;
    seen.add(match[2]);
    entries.push({ group: /** @type {"r" | "b" | "q"} */ (match[1]), candidateId: match[2] });
    if (entries.length >= MAX_RUN) break;
  }
  return entries;
}

export function runHref(entries, { templates = {}, index = 0 } = {}) {
  const params = new URLSearchParams();
  for (const entry of entries) params.append("c", `${entry.group}.${entry.candidateId}`);
  for (const [group, id] of Object.entries(templates)) if (id) params.set(`t${group}`, id);
  params.set("i", String(index));
  return `/followups/run?${params.toString()}`;
}

// Used when the recruiter has no template of their own for a group. Short,
// plain, and with nothing in it the app cannot fill.
export const BUILT_IN_TEMPLATES = {
  b: "Hi {{first_name}},\n\nJust following up on the {{role_title}} role - you mentioned you'd be up for a chat. You can pick a time that suits you here: {{booking_link}}\n\nBest,\n{{recruiter_name}}",
  // Said yes, when there is no booking page to send them to.
  bNoLink: "Hi {{first_name}},\n\nJust following up on the {{role_title}} role - you mentioned you'd be up for a chat. Could you send me a couple of times that work for you this week?\n\nBest,\n{{recruiter_name}}",
  q: "Hi {{first_name}},\n\nJust floating this back to the top of your inbox in case it got buried - I'd love to tell you a bit more about the {{role_title}} role if you're open to it.\n\nBest,\n{{recruiter_name}}",
};
