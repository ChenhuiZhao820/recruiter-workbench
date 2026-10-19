import { db } from "./db";
import { getSettings } from "./settings";
import { getWorkspace } from "./workspace";

// The follow-up buckets. Computed from stages, timestamps and client answers
// we store ourselves. Nothing here is read from LinkedIn.

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
  lastSentAt: Date | null;
  nudgeCount: number;
  doNotContact: boolean;
  // The client who asked to meet them, for that bucket only.
  client?: string | null;
};

export type FollowUpBuckets = {
  repliedWaiting: FollowUpRow[];
  // A client pressed Interview on their link (or does not review first) and
  // nobody has written to the candidate since. Leaves once a message is logged or an interview booked.
  clientWantsToMeet: FollowUpRow[];
  saidYesNeverBooked: FollowUpRow[];
  wentQuiet: FollowUpRow[];
};

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function getFollowUpBuckets(): Promise<FollowUpBuckets> {
  const { owner } = await getWorkspace();
  const settings = await getSettings();
  const candidates = await db.candidate.findMany({
    where: {
      stage: { in: ["replied", "booking_pending", "contacted"] },
      role: { status: "open", userId: owner.id },
    },
    include: {
      role: { select: { id: true, title: true } },
      outreach: { orderBy: { sentAt: "desc" }, take: 1 },
      person: { select: { doNotContact: true } },
    },
  });

  const buckets: FollowUpBuckets = {
    repliedWaiting: [],
    clientWantsToMeet: [],
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
      lastSentAt: c.outreach[0]?.sentAt ?? null,
      nudgeCount: c.nudgeCount,
      doNotContact: c.person?.doNotContact ?? false,
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

  const wanted = await db.shortlistItem.findMany({
    where: {
      // An Interview answer: every client reviews first.
      decision: "interview",
      shortlist: { userId: owner.id, kind: "role", revokedAt: null },
      person: { doNotContact: false },
      candidate: {
        stage: { notIn: ["rejected", "placed"] },
        role: { status: "open", userId: owner.id },
        bookings: { none: { kind: "interview", status: "booked" } },
      },
    },
    include: {
      shortlist: { select: { client: true, roleId: true } },
      candidate: { include: { role: { select: { id: true, title: true } }, outreach: { orderBy: { sentAt: "desc" }, take: 1 } } },
    },
  });
  for (const item of wanted) {
    const c = item.candidate!;
    const at = item.decisionAt ?? item.addedAt;
    // Only the candidacy on the link's own role counts, and only until the
    // recruiter has written to them since the client answered.
    if (c.roleId !== item.shortlist.roleId || (c.outreach[0] && c.outreach[0].sentAt > at)) continue;
    buckets.clientWantsToMeet.push({
      candidateId: c.id,
      candidateName: c.fullName,
      profileUrl: c.profileUrl,
      roleId: c.role.id,
      roleTitle: c.role.title,
      lastEvent: `${item.shortlist.client || "The client"} wants to meet them`,
      lastEventAt: at,
      lastOutreachKind: c.outreach[0]?.kind ?? null,
      lastSentAt: c.outreach[0]?.sentAt ?? null,
      nudgeCount: c.nudgeCount,
      doNotContact: false,
      client: item.shortlist.client,
    });
  }

  for (const bucket of Object.values(buckets)) {
    bucket.sort((a, b) => a.lastEventAt.getTime() - b.lastEventAt.getTime());
  }
  return buckets;
}
