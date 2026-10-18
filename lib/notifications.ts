import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "./db";
import { clientKey } from "./shortlist-core.mjs";

// The recruiter's activity: what clients did on their links, and interviews
// candidates booked with them. Written by the public actions as it happens,
// read by the bell in the top bar and the activity page. A notification holds
// references only; the sentence is made here when it is read.

type Client = PrismaClient | Prisma.TransactionClient;

export type NotificationKind = "client_answered" | "client_opened" | "interview_booked" | "interview_cancelled" | "client_set_hours";

export async function notify(client: Client, data: {
  userId: string;
  kind: NotificationKind;
  detail?: string | null;
  shortlistId?: string | null;
  itemId?: string | null;
  bookingId?: string | null;
  roleId?: string | null;
  accessId?: string | null;
}) {
  await client.notification.create({ data });
}

// A client changing their answer before the recruiter has looked is one piece
// of news, not two: the unread one is brought up to date instead.
export async function notifyAnswer(client: Client, data: { userId: string; itemId: string; shortlistId: string; roleId: string | null; decision: string; accessId: string }) {
  const { count } = await client.notification.updateMany({
    where: { userId: data.userId, kind: "client_answered", itemId: data.itemId, readAt: null },
    data: { detail: data.decision, createdAt: new Date(), accessId: data.accessId },
  });
  if (!count) {
    await notify(client, { userId: data.userId, kind: "client_answered", detail: data.decision, shortlistId: data.shortlistId, itemId: data.itemId, roleId: data.roleId, accessId: data.accessId });
  }
}

export async function unreadCount(ownerId: string) {
  return db.notification.count({ where: { userId: ownerId, readAt: null } });
}

// A role the answer can be brought onto, from the activity line itself.
export type AdoptTarget = { candidateId: string; itemId: string; roleTitle: string };
export type ActivityEntry = { id: string; at: Date; unread: boolean; text: string; href: string; tone: "yes" | "no" | "neutral"; adopt: AdoptTarget[] };

const placeOf = (shortlist: { id: string; kind: string; roleId: string | null } | null, roleId: string | null) =>
  roleId ? `/roles/${roleId}` : shortlist ? `/shortlists?open=${shortlist.id}#shortlist-${shortlist.id}` : "/shortlists";

export async function listActivity(ownerId: string, limit = 60): Promise<ActivityEntry[]> {
  const rows = await db.notification.findMany({
    where: { userId: ownerId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      shortlist: { select: { id: true, kind: true, title: true, client: true, roleId: true } },
      item: { select: { id: true, personId: true, decision: true, decisionAt: true, candidateId: true, person: { select: { fullName: true } } } },
      booking: { select: { startsAt: true, candidate: { select: { id: true, fullName: true } } } },
      role: { select: { id: true, title: true, client: true } },
    },
  });
  const accessIds = rows.map((row) => row.accessId).filter((id): id is string => Boolean(id));
  const accesses = accessIds.length
    ? await db.shortlistAccess.findMany({ where: { id: { in: accessIds }, shortlist: { userId: ownerId } }, select: { id: true, email: true } })
    : [];
  const emailOf = new Map(accesses.map((access) => [access.id, access.email]));
  const adoptable = await adoptTargets(ownerId, rows);
  const when = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" });

  return rows.map((row) => {
    const client = row.shortlist?.client || row.role?.client || "The client";
    const who = (row.accessId && emailOf.get(row.accessId)) || client;
    const where = row.shortlist ? (row.shortlist.kind === "role" ? row.role?.title ?? row.shortlist.title : row.shortlist.title) : row.role?.title ?? "";
    const person = row.item?.person.fullName ?? row.booking?.candidate.fullName ?? "Someone";
    const base = { id: row.id, at: row.createdAt, unread: !row.readAt, adopt: (row.item && adoptable.get(row.item.id)) || [] };
    const href = row.roleId && (row.item?.candidateId || row.booking?.candidate.id)
      ? `/roles/${row.roleId}#candidate-${row.item?.candidateId ?? row.booking?.candidate.id}`
      : placeOf(row.shortlist, row.roleId);
    switch (row.kind) {
      case "client_answered":
        return row.detail === "interview"
          ? { ...base, tone: "yes" as const, href, text: `${who} wants to meet ${person} (${where})` }
          : { ...base, tone: "no" as const, href, text: `${who} passed on ${person} (${where})` };
      case "client_opened":
        return { ...base, tone: "neutral" as const, href, text: `${who} opened ${where} for the first time` };
      case "interview_booked":
        return { ...base, tone: "yes" as const, href, text: `${person} booked an interview with ${client}${row.booking ? `, ${when.format(row.booking.startsAt)}` : ""}` };
      case "interview_cancelled":
        return { ...base, tone: "no" as const, href, text: `${who} can't make the interview with ${person}; it is cancelled and needs a new time` };
      case "client_set_hours":
        return { ...base, tone: "neutral" as const, href, text: `${who} set their interview hours for ${where}` };
      default:
        return { ...base, tone: "neutral" as const, href, text: "Something changed" };
    }
  });
}

// Marks everything up to a moment as read, so news arriving while the page is
// open stays new. Only ever the owner's own.
// For each Interview answer on a custom shortlist, the open roles for the
// same client the person is a candidate on, where that role's own link does
// not already hold this answer or a later one. The same rule as Follow-ups;
// `adoptShortlistAnswer` checks it all again.
async function adoptTargets(ownerId: string, rows: { kind: string; shortlist: { kind: string; client: string | null } | null; item: { id: string; personId: string; decision: string | null; decisionAt: Date | null } | null }[]) {
  const answers = rows.filter((row) => row.kind === "client_answered" && row.shortlist?.kind === "custom" && row.item?.decision === "interview");
  const targets = new Map<string, AdoptTarget[]>();
  if (!answers.length) return targets;
  const candidates = await db.candidate.findMany({
    where: { personId: { in: answers.map((row) => row.item!.personId) }, role: { userId: ownerId, status: "open" }, stage: { notIn: ["rejected", "placed"] }, person: { doNotContact: false } },
    select: { id: true, personId: true, role: { select: { id: true, title: true, client: true, shortlist: { select: { items: { select: { personId: true, decision: true, decisionAt: true } } } } } } },
  });
  for (const row of answers) {
    const item = row.item!;
    const key = clientKey(row.shortlist!.client, "");
    const found = candidates
      .filter((candidate) => candidate.personId === item.personId && clientKey(candidate.role.client, candidate.role.id) === key)
      .filter((candidate) => !candidate.role.shortlist?.items.some((own) => own.personId === item.personId && own.decision && own.decisionAt && item.decisionAt && own.decisionAt >= item.decisionAt))
      .map((candidate) => ({ candidateId: candidate.id, itemId: item.id, roleTitle: candidate.role.title }));
    if (found.length) targets.set(item.id, found);
  }
  return targets;
}

// Opening the role a notification is about is reading it.
export async function markRoleRead(ownerId: string, roleId: string, upTo: Date) {
  await db.notification.updateMany({ where: { userId: ownerId, roleId, readAt: null, createdAt: { lte: upTo } }, data: { readAt: new Date() } });
}

// Which candidates on a role have news the recruiter has not seen.
export async function unreadOnRole(ownerId: string, roleId: string) {
  const rows = await db.notification.findMany({
    where: { userId: ownerId, roleId, readAt: null },
    select: { item: { select: { candidateId: true } }, booking: { select: { candidateId: true } } },
  });
  const candidates = new Set<string>();
  for (const row of rows) {
    const candidateId = row.item?.candidateId ?? row.booking?.candidateId;
    if (candidateId) candidates.add(candidateId);
  }
  return { count: rows.length, candidates };
}

// Opening the shortlists library is reading what happened on custom shortlists.
export async function markShortlistsRead(ownerId: string, upTo: Date) {
  await db.notification.updateMany({ where: { userId: ownerId, readAt: null, createdAt: { lte: upTo }, shortlist: { kind: "custom" } }, data: { readAt: new Date() } });
}

// Which shortlists have news the recruiter has not seen, and how much.
export async function unreadShortlists(ownerId: string) {
  const rows = await db.notification.groupBy({ by: ["shortlistId"], where: { userId: ownerId, readAt: null, shortlistId: { not: null } }, _count: true });
  return new Map(rows.map((row) => [row.shortlistId!, row._count]));
}

export async function markReadUpTo(ownerId: string, upTo: Date) {
  await db.notification.updateMany({ where: { userId: ownerId, readAt: null, createdAt: { lte: upTo } }, data: { readAt: new Date() } });
}
