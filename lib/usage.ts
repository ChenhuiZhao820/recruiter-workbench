import type { Prisma, PrismaClient } from "@prisma/client";

// Counts and timings about how features are used, kept in our own database
// and never sent anywhere. An event carries a kind and at most one number:
// never a name, a transcript, a message or any other content.
export const USAGE_KINDS = ["screening_confirmed", "ai_field_edited", "quote_missing", "booking_link_used", "client_email_sent"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

type Client = PrismaClient | Prisma.TransactionClient;

export async function recordUsage(client: Client, userId: string, kind: UsageKind, value: number | null = null, times = 1) {
  if (times < 1) return;
  await client.usageEvent.createMany({
    data: Array.from({ length: times }, () => ({ userId, kind, value: value === null ? null : Math.round(value) })),
  });
}
