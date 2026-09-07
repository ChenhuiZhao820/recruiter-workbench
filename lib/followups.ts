import { db } from "./db";
import { getSettings } from "./settings";

// The three follow-up buckets. Computed from stages and timestamps we store
// ourselves. Nothing here is read from LinkedIn.

export type FollowUpRow = {
  candidateId: string;
  candidateName: string;
  profileUrl: string | null;
  roleId: string;
  roleTitle: string;
  lastEvent: string;
  lastEventAt: Date;
  // How the last message went out, so a chase can match the door it used.
  lastOutreachKind: string | null;
};

export type FollowUpBuckets = {
  repliedWaiting: FollowUpRow[];
  saidYesNeverBooked: FollowUpRow[];
  wentQuiet: FollowUpRow[];
};

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function getFollowUpBuckets(): Promise<FollowUpBuckets> {
  const settings = await getSettings();
  const candidates = await db.candidate.findMany({
    where: {
      stage: { in: ["replied", "booking_pending", "contacted"] },
      role: { status: "open" },
    },
    include: {
      role: { select: { id: true, title: true } },
      outreach: { orderBy: { sentAt: "desc" }, take: 1 },
    },
  });

  const buckets: FollowUpBuckets = {
    repliedWaiting: [],
    saidYesNeverBooked: [],
    wentQuiet: [],
  };

  for (const c of candidates) {
    const row = (lastEvent: string): FollowUpRow => ({
      candidateId: c.id,
      candidateName: c.fullName,
      profileUrl: c.profileUrl,
      roleId: c.role.id,
      roleTitle: c.role.title,
      lastEvent,
      lastEventAt: c.lastActivityAt,
      lastOutreachKind: c.outreach[0]?.kind ?? null,
    });
    const lastOutreach = c.outreach[0];

    if (c.stage === "replied") {
      // Waiting on you: they replied and no outreach has been logged since.
      if (!lastOutreach || lastOutreach.sentAt <= c.lastActivityAt) {
        buckets.repliedWaiting.push(row("Replied, no response from you yet"));
      }
    } else if (c.stage === "booking_pending") {
      if (c.lastActivityAt < daysAgo(settings.bookingChaseDays)) {
        buckets.saidYesNeverBooked.push(row("Said yes, still no booking"));
      }
    } else if (c.stage === "contacted") {
      const quiet = c.lastActivityAt < daysAgo(settings.quietNudgeDays);
      // Double-nudge guard: skip anyone nudged within the last quietNudgeDays.
      const recentlyNudged = c.lastNudgeAt && c.lastNudgeAt >= daysAgo(settings.quietNudgeDays);
      if (quiet && !recentlyNudged) {
        buckets.wentQuiet.push(
          row(c.nudgeCount > 0 ? `Contacted, nudged ${c.nudgeCount}x, still quiet` : "Contacted, no reply")
        );
      }
    }
  }

  for (const bucket of Object.values(buckets)) {
    bucket.sort((a, b) => a.lastEventAt.getTime() - b.lastEventAt.getTime());
  }
  return buckets;
}
