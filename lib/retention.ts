import { db } from "./db";

// Transcripts are kept for TRANSCRIPT_RETENTION_DAYS after they were added,
// then removed; what the recruiter confirmed from them stays. There is no
// scheduler: this runs at sign-in and on every screening action, and
// scripts/purge-transcripts.mjs does the same for every account at once.
// Screens also treat a transcript past its date as gone, so a late purge
// never shows one.
export async function purgeExpiredTranscripts(ownerId: string, now = new Date()): Promise<number> {
  const { count } = await db.screening.updateMany({
    where: {
      transcript: { not: null },
      transcriptDeleteAfter: { lte: now },
      candidate: { role: { userId: ownerId } },
    },
    data: { transcript: null },
  });
  return count;
}

export function transcriptRetained(screening: { transcript: string | null; transcriptDeleteAfter: Date | null }, now = new Date()) {
  return Boolean(screening.transcript) && (!screening.transcriptDeleteAfter || screening.transcriptDeleteAfter > now);
}
