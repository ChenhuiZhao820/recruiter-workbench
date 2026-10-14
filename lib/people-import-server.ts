import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { personSearchText } from "@/lib/people";
import { recordUsage } from "@/lib/usage";
import { readSpreadsheet } from "@/lib/sheet-read.mjs";
import {
  classifyRows, cleanRows, gapFills, guessMapping, hasNameColumn, identifiersOf, parseMapping, provenanceNote,
  type Decided, type Existing, type Known,
} from "@/lib/people-import.mjs";

// Server side of the People import. Callers have already checked who is
// asking; `ownerId` is that account. Nothing from the file is stored: the
// bytes are read, turned into rows and either shown or written as people.

export type PreviewRow = { n: number; name: string; status: Decided["status"]; reason: string | null; warnings: string[] };
export type Preview = {
  header: string[];
  sample: string[];
  mapping: string[];
  needsName: boolean;
  newNames: string[];
  totals: Record<string, number>;
  rows: PreviewRow[];
};
export type ImportResult = { created: number; filled: number; markedDoNotContact: number; skipped: { existing: number; suppressed: number; duplicate: number; invalid: number } };

const CHUNK = 400;

async function lookUp(ownerId: string, ids: ReturnType<typeof identifiersOf>): Promise<Known> {
  const where = [
    ids.memberIds.length ? { memberId: { in: ids.memberIds } } : null,
    ids.profileUrls.length ? { profileUrl: { in: ids.profileUrls } } : null,
    ids.emails.length ? { email: { in: ids.emails } } : null,
  ].filter((clause): clause is NonNullable<typeof clause> => clause !== null);
  const people = where.length
    ? await db.person.findMany({
        where: { userId: ownerId, OR: where },
        select: { id: true, fullName: true, motivation: true, memberId: true, profileUrl: true, email: true, doNotContact: true, headline: true, location: true, skillsSummary: true },
      })
    : [];
  const known: Known = { byMember: new Map(), byUrl: new Map(), byEmail: new Map(), suppressed: new Set() };
  for (const person of people) {
    const existing: Existing = { id: person.id, fullName: person.fullName, motivation: person.motivation, doNotContact: person.doNotContact, headline: person.headline, location: person.location, skillsSummary: person.skillsSummary, email: person.email };
    if (person.memberId) known.byMember.set(person.memberId, existing);
    if (person.profileUrl) known.byUrl.set(person.profileUrl, existing);
    if (person.email) known.byEmail.set(person.email, existing);
  }
  if (ids.hashes.length) {
    const hits = await db.suppression.findMany({ where: { userId: ownerId, keyHash: { in: ids.hashes } }, select: { keyHash: true } });
    known.suppressed = new Set(hits.map((hit) => hit.keyHash));
  }
  return known;
}

export type Analysis = Preview & { decided: Decided[] };

// Reads the file and says what importing it would do. Writes nothing.
export async function analyse(ownerId: string, bytes: Uint8Array, rawMapping: unknown): Promise<Analysis> {
  const { rows } = readSpreadsheet(bytes);
  const header = rows[0].cells;
  const columns = Math.max(...rows.map((row) => row.cells.length));
  const padded = Array.from({ length: columns }, (_, i) => header[i] ?? "");
  const mapping = parseMapping(rawMapping, columns) ?? guessMapping(padded);
  const needsName = !hasNameColumn(mapping);
  const cleaned = needsName ? [] : cleanRows(rows.slice(1), mapping);
  const { rows: decided, totals } = classifyRows(cleaned, needsName ? emptyKnown() : await lookUp(ownerId, identifiersOf(cleaned)));
  return {
    header: padded,
    sample: Array.from({ length: columns }, (_, i) => (rows[1].cells[i] ?? "").slice(0, 60)),
    mapping,
    needsName,
    newNames: decided.filter((row) => row.status === "new").slice(0, 5).map((row) => row.name),
    totals: needsName ? { ...totals, rows: rows.length - 1 } : totals,
    rows: decided.map(({ n, name, status, reason, warnings }) => ({ n, name, status, reason, warnings })),
    decided,
  };
}

function emptyKnown(): Known {
  return { byMember: new Map(), byUrl: new Map(), byEmail: new Map(), suppressed: new Set() };
}

// Writes the people in one transaction: all of them or none. New people are
// created with a note saying where they came from, which is also what keeps
// them from being cleaned up as an orphan record. People already in the
// workspace are never overwritten; the most a row can do to one is add a
// do-not-contact flag (the safe direction) and, if asked, fill an empty field.
export async function applyImport(ownerId: string, analysis: Analysis, options: { fileName: string; fillGaps: boolean }): Promise<ImportResult> {
  const now = new Date();
  const fresh = analysis.decided.filter((row) => row.status === "new");
  const existing = analysis.decided.filter((row) => row.status === "existing" && row.existing);
  const flagIds = Array.from(new Set(existing.filter((row) => row.doNotContact && !row.existing!.doNotContact).map((row) => row.existing!.id)));
  const fills = options.fillGaps
    ? existing.map((row) => ({ id: row.existing!.id, fill: gapFills(row.existing!, row) })).filter((entry) => Object.keys(entry.fill).length > 0)
    : [];
  const provenance = provenanceNote(options.fileName, now);

  await db.$transaction(
    async (tx) => {
      const people = fresh.map((row) => ({ id: randomUUID(), row }));
      for (let i = 0; i < people.length; i += CHUNK) {
        await tx.person.createMany({
          data: people.slice(i, i + CHUNK).map(({ id, row }) => ({
            id,
            userId: ownerId,
            fullName: row.name,
            profileUrl: row.profileUrl,
            memberId: row.memberId,
            headline: row.headline,
            location: row.location,
            skillsSummary: row.skills,
            email: row.email,
            emailSource: row.email ? "import" : null,
            doNotContact: row.doNotContact,
            searchText: personSearchText({ fullName: row.name, headline: row.headline, location: row.location, skillsSummary: row.skills }),
          })),
        });
      }
      const notes = people.flatMap(({ id, row }) => [
        { personId: id, body: provenance },
        ...(row.notes ? [{ personId: id, body: row.notes }] : []),
      ]);
      for (let i = 0; i < notes.length; i += CHUNK) await tx.personNote.createMany({ data: notes.slice(i, i + CHUNK) });
      if (flagIds.length) await tx.person.updateMany({ where: { userId: ownerId, id: { in: flagIds } }, data: { doNotContact: true } });
      for (const { id, fill } of fills) {
        const before = existing.find((row) => row.existing!.id === id)!.existing!;
        await tx.person.update({
          where: { id },
          data: {
            ...fill,
            ...(fill.email ? { emailSource: "import" } : {}),
            searchText: personSearchText({
              fullName: before.fullName,
              headline: fill.headline ?? before.headline,
              location: fill.location ?? before.location,
              skillsSummary: fill.skillsSummary ?? before.skillsSummary,
              motivation: before.motivation,
            }),
          },
        });
      }
      await tx.auditEvent.create({ data: { actorId: ownerId, targetUserId: ownerId, action: "people.imported" } });
      await recordUsage(tx, ownerId, "people_imported", fresh.length);
    },
    { timeout: 60_000, maxWait: 10_000 }
  );

  const { totals } = analysis;
  return {
    created: fresh.length,
    filled: fills.length,
    markedDoNotContact: flagIds.length,
    skipped: { existing: totals.existing, suppressed: totals.suppressed, duplicate: totals.duplicate, invalid: totals.invalid },
  };
}
