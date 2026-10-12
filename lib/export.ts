import { db } from "./db";

// Everything a recruiter has recorded, in a form they can take elsewhere. No
// secrets or hashes are included: capture keys, session data, suppression
// hashes and calendar tokens stay behind.

export const EXPORT_TABLES = ["people", "notes", "candidates", "roles", "screenings", "bookings", "outreach", "templates", "searches"] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

export function isExportTable(value: string): value is ExportTable {
  return (EXPORT_TABLES as readonly string[]).includes(value);
}

type Row = Record<string, string | number | boolean | null>;

function value(input: unknown): string | number | boolean | null {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) return input.toISOString();
  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") return input;
  return JSON.stringify(input);
}

function rows<T extends Record<string, unknown>>(items: T[], columns: (keyof T & string)[]): Row[] {
  return items.map((item) => Object.fromEntries(columns.map((column) => [column, value(item[column])])));
}

export async function buildExport(ownerId: string): Promise<Record<ExportTable, Row[]>> {
  const now = new Date();
  const [people, notes, roles, candidates, screenings, bookings, outreach, templates, searches] = await Promise.all([
    db.person.findMany({ where: { userId: ownerId }, orderBy: { createdAt: "asc" } }),
    db.personNote.findMany({ where: { person: { userId: ownerId } }, orderBy: { createdAt: "asc" } }),
    db.role.findMany({ where: { userId: ownerId }, include: { briefing: true }, orderBy: { createdAt: "asc" } }),
    db.candidate.findMany({ where: { role: { userId: ownerId } }, orderBy: { createdAt: "asc" } }),
    db.screening.findMany({ where: { candidate: { role: { userId: ownerId } } }, orderBy: { createdAt: "asc" } }),
    db.booking.findMany({ where: { userId: ownerId, candidate: { role: { userId: ownerId } } }, orderBy: { startsAt: "asc" } }),
    db.outreachLog.findMany({ where: { candidate: { role: { userId: ownerId } } }, orderBy: { sentAt: "asc" } }),
    db.messageTemplate.findMany({ where: { userId: ownerId }, orderBy: { createdAt: "asc" } }),
    db.savedSearch.findMany({ where: { userId: ownerId }, orderBy: { createdAt: "asc" } }),
  ]);

  return {
    people: rows(people, [
      "id", "fullName", "profileUrl", "headline", "email", "emailSource", "emailConsentAt",
      "salaryMin", "salaryMax", "salaryCurrency", "salaryNote", "noticeWeeks", "availableFrom",
      "location", "remotePreference", "rightToWork", "rightToWorkNote", "skillsSummary", "motivation",
      "factsConfirmedAt", "revisitOn", "revisitNote", "doNotContact", "lastContactAt", "createdAt", "updatedAt",
    ]),
    notes: rows(notes, ["id", "personId", "candidateId", "body", "createdAt", "updatedAt"]),
    candidates: rows(candidates, [
      "id", "personId", "roleId", "fullName", "profileUrl", "headline", "notes", "stage",
      "lastActivityAt", "lastNudgeAt", "nudgeCount", "createdAt", "updatedAt",
    ]),
    roles: roles.map((role) => ({
      ...rows([role], ["id", "title", "client", "jobDesc", "status", "budgetMin", "budgetMax", "budgetCurrency", "createdAt", "updatedAt"])[0],
      briefing: role.briefing
        ? JSON.stringify({
            dayToDay: role.briefing.dayToDay,
            keySkills: role.briefing.keySkills,
            searchTitles: role.briefing.searchTitles,
            targetCompanies: role.briefing.targetCompanies,
            salaryRange: role.briefing.salaryRange,
            firstCallQuestions: role.briefing.firstCallQuestions,
          })
        : null,
    })),
    // Transcripts are only kept for a limited time; an expired one is not
    // exported even if a purge has not run yet.
    screenings: screenings.map((screening) => ({
      ...rows([screening], [
        "id", "candidateId", "status", "transcriptSource", "summaryJson", "generatedAt",
        "confirmedAt", "representConsentAt", "clientEmailSentAt", "createdAt",
      ])[0],
      transcript:
        screening.transcript && (!screening.transcriptDeleteAfter || screening.transcriptDeleteAfter > now)
          ? screening.transcript
          : null,
    })),
    bookings: rows(bookings, ["id", "candidateId", "startsAt", "endsAt", "mode", "meetingUrl", "phone", "email", "consentAt", "status", "createdAt"]),
    outreach: rows(outreach, ["id", "candidateId", "templateId", "kind", "renderedBody", "sentAt"]),
    templates: rows(templates, ["id", "name", "kind", "body", "createdAt", "updatedAt"]),
    searches: rows(searches, [
      "id", "name", "roleId", "groupLabel", "titles", "keywords", "industries", "locations",
      "filterNotes", "searchUrl", "lastUsedAt", "createdAt",
    ]),
  };
}

// RFC 4180 CSV. Cells that a spreadsheet would treat as a formula are
// prefixed with an apostrophe so opening the file cannot run anything.
export function toCsv(table: Row[]): string {
  if (table.length === 0) return "";
  const columns = Object.keys(table[0]);
  const cell = (input: string | number | boolean | null) => {
    let text = input === null ? "" : String(input);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(","), ...table.map((row) => columns.map((column) => cell(row[column])).join(","))].join("\r\n") + "\r\n";
}
