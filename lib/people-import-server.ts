import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { personSearchText } from "@/lib/people";
import { recordUsage } from "@/lib/usage";
import { assertUsable, readWorkbook } from "@/lib/sheet-read.mjs";
import { IMPORT_UNDO_DAYS } from "@/lib/people-import-fields.mjs";
import {
  classifyRoleColumn, classifyRows, cleanFileName, cleanRows, gapFills, identifiersOf, prepareTable, provenanceNote,
  resolveRoleValues, roleKey, splitRoles, styleName,
  type AccountRole, type Decided, type Existing, type Known, type RoleValue,
} from "@/lib/people-import.mjs";

// Server side of the People import. Callers have already checked who is
// asking; `ownerId` is that account. Nothing from the file is stored: the
// bytes are read, turned into rows and either shown or written as people.
// Every choice the recruiter made on the page arrives as `ImportOptions` and
// is checked here again; nothing the page says about the file is trusted.

export const UNDO_DAYS = IMPORT_UNDO_DAYS;

export type ImportOptions = {
  sheet?: number;
  headerRow?: number;
  mapping?: unknown;
  roleAnswer?: "role" | "headline";
  roleChoices?: Record<string, string>;
  exclude?: number[];
  swapNames?: boolean;
  fixCase?: boolean;
  groupRows?: boolean;
  keepOther?: boolean;
  nameFromEmail?: boolean;
};

export function parseOptions(raw: unknown): ImportOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const int = (value: unknown, min: number, max: number) => (Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? (value as number) : undefined);
  const bool = (value: unknown) => (typeof value === "boolean" ? value : undefined);
  const choices: Record<string, string> = {};
  if (input.roleChoices && typeof input.roleChoices === "object" && !Array.isArray(input.roleChoices)) {
    for (const [key, value] of Object.entries(input.roleChoices as Record<string, unknown>).slice(0, 500)) {
      if (typeof value === "string" && key.length <= 200 && value.length <= 64) choices[key] = value;
    }
  }
  return {
    sheet: int(input.sheet, 0, 9),
    headerRow: int(input.headerRow, -1, 9),
    mapping: Array.isArray(input.mapping) ? input.mapping : undefined,
    roleAnswer: input.roleAnswer === "role" || input.roleAnswer === "headline" ? input.roleAnswer : undefined,
    roleChoices: choices,
    exclude: Array.isArray(input.exclude) ? input.exclude.filter((n): n is number => Number.isInteger(n) && n > 0).slice(0, 2100) : [],
    swapNames: bool(input.swapNames),
    fixCase: bool(input.fixCase),
    groupRows: bool(input.groupRows),
    keepOther: bool(input.keepOther),
    nameFromEmail: bool(input.nameFromEmail),
  };
}

export type PreviewRow = { n: number; name: string; status: Decided["status"]; reason: string | null; warnings: string[]; roles: string[] };
export type Reading = { on: boolean; example: string | null; count?: number };
export type Preview = {
  sheets: string[];
  sheet: number;
  headerRow: number;
  headerChoices: { value: number; label: string }[];
  header: string[];
  sample: string[];
  mapping: string[];
  needsName: boolean;
  readings: { names: { on: boolean; before: string; after: string } | null; groupRows: Reading | null; nameFromEmail: boolean; keepOther: { on: boolean; columns: string[] }; skippedAbove: number };
  role: null | {
    column: number;
    header: string;
    decision: "role" | "ask";
    answer: "role" | "headline" | null;
    sample: { label: string; count: number }[];
    values: RoleValue[];
  };
  newNames: string[];
  totals: Record<string, number>;
  rows: PreviewRow[];
  questions: number;
};
export type ImportResult = {
  batchId: string;
  created: number;
  filled: number;
  markedDoNotContact: number;
  addedToRoles: number;
  rolesCreated: number;
  skipped: { existing: number; suppressed: number; duplicate: number; invalid: number; excluded: number };
};

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

// Each person on the roles chosen for them, as role ids or "create:<key>",
// leaving out a role they are already a candidate on.
type Placement = { row: Decided; target: string };

export type Analysis = Preview & { decided: Decided[]; placements: Placement[]; createRoles: { key: string; label: string }[] };

// Reads the file and says what importing it would do. Writes nothing.
export async function analyse(ownerId: string, bytes: Uint8Array, options: ImportOptions = {}): Promise<Analysis> {
  const { sheets } = readWorkbook(bytes);
  const { sheetIndex, sheet, headerRow, table, groupIndexes, groupOn, header, body, mapping, needsName, nameFromEmail, style } = prepareTable(sheets, options);
  assertUsable(sheets[sheetIndex], table.body.length);

  const roles: AccountRole[] = await db.role.findMany({ where: { userId: ownerId }, select: { id: true, title: true, status: true }, orderBy: { createdAt: "asc" } });
  const roleColumn = mapping.indexOf("role");
  let roleInfo: Preview["role"] = null;
  if (roleColumn >= 0) {
    const values = body.map((row) => row.cells[roleColumn] ?? "");
    const { decision } = classifyRoleColumn({ header: header[roleColumn], values, roles, people: body.length });
    const counts = new Map<string, { label: string; count: number }>();
    for (const value of values.flatMap(splitRoles)) {
      const key = roleKey(value);
      const entry = counts.get(key) ?? { label: value, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
    roleInfo = {
      column: roleColumn,
      header: header[roleColumn],
      decision,
      answer: options.roleAnswer ?? (decision === "role" ? "role" : null),
      sample: Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, 6),
      values: [],
    };
  }

  const swapNames = options.swapNames ?? style.swap;
  const fixCase = options.fixCase ?? style.fixCase;
  const keepOther = options.keepOther ?? true;
  const cleaned = needsName ? [] : cleanRows(body, header, mapping, { swapNames, fixCase, keepOther, nameFromEmail, roleAs: roleInfo?.answer ?? null });
  const known = needsName ? { byMember: new Map(), byUrl: new Map(), byEmail: new Map(), suppressed: new Set<string>() } : await lookUp(ownerId, identifiersOf(cleaned));
  const { rows: decided, totals } = classifyRows(cleaned, known, new Set(options.exclude ?? []));

  // Roles named by the people who will be imported or are already there.
  const placements: Placement[] = [];
  let createRoles: { key: string; label: string }[] = [];
  if (roleInfo?.answer === "role") {
    const counts = new Map<string, { label: string; people: number }>();
    for (const row of decided) {
      if (row.status !== "new" && row.status !== "existing") continue;
      for (const label of row.roles) {
        const key = roleKey(label);
        const entry = counts.get(key) ?? { label, people: 0 };
        entry.people += 1;
        counts.set(key, entry);
      }
    }
    roleInfo.values = resolveRoleValues(counts, roles, options.roleChoices ?? {});
    const target = new Map(roleInfo.values.map((value) => [value.key, value.choice === "create" ? `create:${value.key}` : value.choice]));
    createRoles = roleInfo.values.filter((value) => value.choice === "create").map(({ key, label }) => ({ key, label }));
    const roleIds = roleInfo.values.map((value) => value.choice).filter((choice) => choice !== "none" && choice !== "create");
    const existingIds = decided.flatMap((row) => (row.status === "existing" && row.existing ? [row.existing.id] : []));
    const urls = decided.flatMap((row) => (row.profileUrl ? [row.profileUrl] : []));
    const already = new Set<string>();
    if (roleIds.length) {
      const current = await db.candidate.findMany({
        where: { roleId: { in: roleIds }, role: { userId: ownerId }, OR: [{ personId: { in: existingIds } }, { profileUrl: { in: urls } }] },
        select: { roleId: true, personId: true, profileUrl: true },
      });
      for (const candidate of current) {
        if (candidate.personId) already.add(`${candidate.roleId}|p:${candidate.personId}`);
        if (candidate.profileUrl) already.add(`${candidate.roleId}|u:${candidate.profileUrl}`);
      }
    }
    for (const row of decided) {
      if (row.status !== "new" && row.status !== "existing") continue;
      const seen = new Set<string>();
      for (const label of row.roles) {
        const chosen = target.get(roleKey(label));
        if (!chosen || chosen === "none" || seen.has(chosen)) continue;
        seen.add(chosen);
        if (already.has(`${chosen}|p:${row.existing?.id}`) || (row.profileUrl && already.has(`${chosen}|u:${row.profileUrl}`))) continue;
        placements.push({ row, target: chosen });
      }
    }
  }
  totals.addedToRoles = placements.length;
  totals.newRoles = createRoles.length;

  const otherColumns = header.filter((_, c) => (!mapping[c] || (c === roleColumn && roleInfo?.answer !== "role")) && body.some((row) => String(row.cells[c] ?? "").trim()));
  const sampleRow = body[0]?.cells ?? [];
  const firstRows = sheet.rows.slice(0, 10);
  return {
    sheets: sheets.map((s) => s.name),
    sheet: sheetIndex,
    headerRow,
    headerChoices: [
      ...firstRows.map((row, i) => ({ value: i, label: `Row ${row.n}: ${row.cells.filter((cell) => String(cell ?? "").trim()).slice(0, 4).join(", ").slice(0, 70)}` })),
      { value: -1, label: "There is no row of headings" },
    ],
    header,
    sample: header.map((_, i) => String(sampleRow[i] ?? "").slice(0, 60)),
    mapping,
    needsName,
    readings: {
      names: style.swap || style.fixCase
        ? (() => {
            const before = (style.swapExample ?? style.fixCaseExample) as string;
            return { on: swapNames || fixCase, before, after: styleName(before, { swap: style.swap, fixCase: style.fixCase }) };
          })()
        : null,
      groupRows: groupIndexes.length ? { on: groupOn, count: groupIndexes.length, example: String(table.body[groupIndexes[0]].cells.find((cell) => String(cell ?? "").trim()) ?? "") } : null,
      nameFromEmail,
      keepOther: { on: keepOther, columns: otherColumns },
      skippedAbove: Math.max(0, headerRow),
    },
    role: roleInfo,
    newNames: decided.filter((row) => row.status === "new").slice(0, 5).map((row) => row.name),
    totals,
    rows: decided.map(({ n, name, status, reason, warnings, roles: rowRoles }) => ({ n, name, status, reason, warnings, roles: rowRoles })),
    questions: (needsName ? 1 : 0) + (roleInfo && !roleInfo.answer ? 1 : 0),
    decided,
    placements,
    createRoles,
  };
}

// Writes the import in one transaction: all of it or none. New people get a
// note saying where they came from (which also keeps the orphan cleanup from
// removing them) and, if kept, the rest of their row. People already there are
// never overwritten: a row can add do-not-contact (the safe direction), a role
// and, if asked, fill an empty field. Everything created is tagged with the
// batch, so it can be undone for UNDO_DAYS.
export async function applyImport(ownerId: string, analysis: Analysis, options: { fileName: string; fillGaps: boolean }): Promise<ImportResult> {
  const fresh = analysis.decided.filter((row) => row.status === "new");
  const existing = analysis.decided.filter((row) => row.status === "existing" && row.existing);
  const flagIds = Array.from(new Set(existing.filter((row) => row.doNotContact && !row.existing!.doNotContact).map((row) => row.existing!.id)));
  const fills = options.fillGaps
    ? Array.from(new Map(existing.map((row) => [row.existing!.id, { row, fill: gapFills(row.existing!, row) }])).values()).filter((entry) => Object.keys(entry.fill).length > 0)
    : [];
  const now = new Date();
  const provenance = provenanceNote(options.fileName, now);
  const personIds = new Map<Decided, string>(fresh.map((row) => [row, randomUUID()]));

  const batchId = await db.$transaction(
    async (tx) => {
      const batch = await tx.importBatch.create({ data: { userId: ownerId, fileName: cleanFileName(options.fileName) } });
      const roleIds = new Map<string, string>();
      for (const role of analysis.createRoles) {
        const created = await tx.role.create({ data: { userId: ownerId, title: role.label, importBatchId: batch.id } });
        roleIds.set(`create:${role.key}`, created.id);
      }
      const people = fresh.map((row) => ({ id: personIds.get(row)!, row }));
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
            importBatchId: batch.id,
            searchText: personSearchText({ fullName: row.name, headline: row.headline, location: row.location, skillsSummary: row.skills }),
          })),
        });
      }
      const notes = people.flatMap(({ id, row }) => [
        { personId: id, body: provenance },
        ...(row.notes ? [{ personId: id, body: row.notes }] : []),
        ...(row.other ? [{ personId: id, body: `Also in the file:\n${row.other}` }] : []),
      ]);
      for (let i = 0; i < notes.length; i += CHUNK) await tx.personNote.createMany({ data: notes.slice(i, i + CHUNK) });
      if (flagIds.length) await tx.person.updateMany({ where: { userId: ownerId, id: { in: flagIds } }, data: { doNotContact: true } });
      for (const { row, fill } of fills) {
        const before = row.existing!;
        await tx.person.update({
          where: { id: before.id },
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
      const candidates = analysis.placements.flatMap(({ row, target }) => {
        const roleId = target.startsWith("create:") ? roleIds.get(target) : target;
        const personId = row.status === "new" ? personIds.get(row) : row.existing?.id;
        if (!roleId || !personId) return [];
        return [{ id: randomUUID(), roleId, personId, fullName: row.status === "new" ? row.name : row.existing!.fullName, profileUrl: row.profileUrl, memberId: row.memberId, headline: row.headline, stage: "sourced", importBatchId: batch.id }];
      });
      // Role ids chosen on the page are checked once more against this account.
      const ownRoles = new Set((await tx.role.findMany({ where: { userId: ownerId, id: { in: Array.from(new Set(candidates.map((c) => c.roleId))) } }, select: { id: true } })).map((role) => role.id));
      const allowed = candidates.filter((candidate) => ownRoles.has(candidate.roleId));
      for (let i = 0; i < allowed.length; i += CHUNK) await tx.candidate.createMany({ data: allowed.slice(i, i + CHUNK) });
      await tx.auditEvent.create({ data: { actorId: ownerId, targetUserId: ownerId, action: "people.imported" } });
      await recordUsage(tx, ownerId, "people_imported", fresh.length);
      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          completedAt: new Date(),
          createdCount: fresh.length,
          roleCount: analysis.createRoles.length,
          fills: JSON.stringify(fills.map(({ row, fill }) => ({ id: row.existing!.id, fields: fill }))),
        },
      });
      return batch.id;
    },
    { timeout: 60_000, maxWait: 10_000 }
  );

  const { totals } = analysis;
  return {
    batchId,
    created: fresh.length,
    filled: fills.length,
    markedDoNotContact: flagIds.length,
    addedToRoles: analysis.placements.length,
    rolesCreated: analysis.createRoles.length,
    skipped: { existing: totals.existing, suppressed: totals.suppressed, duplicate: totals.duplicate, invalid: totals.invalid, excluded: totals.excluded },
  };
}

// ---- undo -----------------------------------------------------------------------------

// The latest import still inside its week, undone or not: People keeps the
// undo's place on the page after it runs, so its result stays on screen.
export async function recentBatch(ownerId: string, now = new Date()) {
  return db.importBatch.findFirst({
    where: { userId: ownerId, completedAt: { not: null }, createdAt: { gte: new Date(now.getTime() - UNDO_DAYS * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileName: true, createdCount: true, roleCount: true, createdAt: true, undoneAt: true },
  });
}

export type UndoResult = { removedPeople: number; removedCandidacies: number; removedRoles: number; restoredFields: number; kept: string[] };

// Takes back what one import added, except what the recruiter has since
// worked on: a person who has been contacted, screened, booked, moved on from
// sourced, given a note, edited or added to a role by hand stays, with
// everything about them, and is named in the result. Do-not-contact flags
// stay too. Undo is not erasure: nothing is added to the suppression list,
// so the same people can be imported again.
export async function undoImport(ownerId: string, batchId: string, now = new Date()): Promise<UndoResult | null> {
  const batch = await db.importBatch.findFirst({ where: { id: batchId, userId: ownerId, undoneAt: null } });
  if (!batch?.completedAt || batch.createdAt.getTime() < now.getTime() - UNDO_DAYS * 86_400_000) return null;
  const done = batch.completedAt;
  const touched = (candidate: { stage: string; updatedAt: Date; importBatchId: string | null; _count: { outreach: number; screenings: number; bookings: number } }) =>
    candidate.stage !== "sourced" || candidate.updatedAt > done || candidate.importBatchId !== batchId || candidate._count.outreach + candidate._count.screenings + candidate._count.bookings > 0;
  const candidateSelect = { id: true, stage: true, updatedAt: true, importBatchId: true, _count: { select: { outreach: true, screenings: true, bookings: true } } } as const;

  return db.$transaction(
    async (tx) => {
      const people = await tx.person.findMany({
        where: { userId: ownerId, importBatchId: batchId },
        select: { id: true, fullName: true, updatedAt: true, candidates: { select: candidateSelect }, _count: { select: { notes: { where: { createdAt: { gt: done } } } } } },
      });
      const kept = people.filter((person) => person.updatedAt > done || person._count.notes > 0 || person.candidates.some(touched));
      const keptIds = new Set(kept.map((person) => person.id));
      const removeIds = people.filter((person) => !keptIds.has(person.id)).map((person) => person.id);
      if (removeIds.length) await tx.person.deleteMany({ where: { userId: ownerId, id: { in: removeIds } } });

      const candidacies = await tx.candidate.findMany({ where: { importBatchId: batchId, role: { userId: ownerId }, personId: { notIn: Array.from(keptIds) } }, select: candidateSelect });
      const dropCandidacies = candidacies.filter((candidate) => !touched(candidate)).map((candidate) => candidate.id);
      if (dropCandidacies.length) await tx.candidate.deleteMany({ where: { id: { in: dropCandidacies } } });

      const roles = await tx.role.findMany({
        where: { userId: ownerId, importBatchId: batchId },
        select: { id: true, updatedAt: true, briefing: { select: { id: true } }, _count: { select: { candidates: true, searches: true } } },
      });
      const dropRoles = roles.filter((role) => role.updatedAt <= done && !role.briefing && role._count.candidates === 0 && role._count.searches === 0).map((role) => role.id);
      if (dropRoles.length) await tx.role.deleteMany({ where: { userId: ownerId, id: { in: dropRoles } } });

      let restoredFields = 0;
      const fills: { id: string; fields: Record<string, string> }[] = (() => {
        try {
          const parsed = JSON.parse(batch.fills);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();
      for (const { id, fields } of fills) {
        const person = await tx.person.findFirst({ where: { id, userId: ownerId }, select: { fullName: true, headline: true, location: true, skillsSummary: true, email: true, motivation: true } });
        if (!person || typeof fields !== "object" || !fields) continue;
        const reset: Record<string, null> = {};
        for (const field of ["headline", "location", "skillsSummary", "email"] as const) {
          if (typeof fields[field] === "string" && person[field] === fields[field]) reset[field] = null;
        }
        if (!Object.keys(reset).length) continue;
        restoredFields += Object.keys(reset).length;
        const after = { ...person, ...reset };
        await tx.person.update({
          where: { id },
          data: { ...reset, ...(reset.email === null ? { emailSource: null } : {}), searchText: personSearchText(after) },
        });
      }
      await tx.importBatch.update({ where: { id: batchId }, data: { undoneAt: now } });
      await tx.auditEvent.create({ data: { actorId: ownerId, targetUserId: ownerId, action: "people.import_undone" } });
      return { removedPeople: removeIds.length, removedCandidacies: dropCandidacies.length, removedRoles: dropRoles.length, restoredFields, kept: kept.map((person) => person.fullName) };
    },
    { timeout: 60_000, maxWait: 10_000 }
  );
}
