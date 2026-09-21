// How much outreach has gone out lately, and when to say something about it.
//
// Making outreach faster is the point of the guided queue, and it is also the
// one way this app could get a recruiter into trouble. LinkedIn does not
// publish its limits, but invitations are the throttled door: the cap is
// commonly around a hundred a week, it is applied per account rather than per
// tool, and unanswered invitations count against you. A restriction lands on
// the person, not on us, so the queue counts what has been recorded and says
// so plainly before the number gets interesting.
//
// These are advisory. Nothing here blocks a send, because nothing here knows
// what LinkedIn's limit is for a particular account on a particular week, and
// a wrong hard stop would be its own kind of damage. The recruiter decides.

// An invitation carries a connection note; a message goes to someone already
// connected and is not throttled the same way, so they are counted apart.
export const INVITES_WEEK_NOTICE = 50;
export const INVITES_WEEK_WARNING = 80;

export type PaceCounts = {
  invitesLast7Days: number;
  sentToday: number;
};

export type PaceAdvice = {
  tone: "plain" | "notice" | "warning";
  text: string;
};

export function paceAdvice({ invitesLast7Days, sentToday }: PaceCounts): PaceAdvice {
  const invitations = `${invitesLast7Days} ${invitesLast7Days === 1 ? "invitation" : "invitations"}`;
  const today = `${sentToday} ${sentToday === 1 ? "message" : "messages"} logged today`;
  if (invitesLast7Days >= INVITES_WEEK_WARNING) {
    return {
      tone: "warning",
      text: `${today}, and ${invitations} in the last seven days. LinkedIn throttles invitations at around a hundred a week and counts unanswered ones against the account. This is close enough to be worth stopping for today.`,
    };
  }
  if (invitesLast7Days >= INVITES_WEEK_NOTICE) {
    return {
      tone: "notice",
      text: `${today}, and ${invitations} in the last seven days. LinkedIn throttles invitations at around a hundred a week, so keep an eye on the pace.`,
    };
  }
  return {
    tone: "plain",
    text: `${today}, and ${invitations} in the last seven days.`,
  };
}

export function startOfToday(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function sevenDaysAgo(now: Date = new Date()): Date {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}
