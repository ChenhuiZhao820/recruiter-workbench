import { FIELD_LABELS } from "./screening-core.mjs";
import { factsAreStale } from "./talent.mjs";
import { factSummary, locationText, noticeText, rightToWorkText, salaryText, factDate } from "./fact-labels";
import { FIELDS, type ScreeningSummary, type FactField } from "./screening";

// What a client is shown about a person, and nothing else. The client email
// and the client's shortlist page both read through here, so the two cannot
// disagree about what leaves the recruiter's workspace.
//
// Every column of Person and Candidate is named below as shown or hidden, and
// tests/client-profile.test.mjs reads the schema to make sure a new column is
// classified before it can ship. Hidden means never in a ClientProfile: the
// LinkedIn address and member id (a client could go round the recruiter),
// contact details, the recruiter's own notes and reminders, and anything about
// other roles or the recruiter's process.

type Policy = "shown" | "hidden";

export const PERSON_FIELD_POLICY: Record<string, Policy> = {
  id: "hidden",
  userId: "hidden",
  user: "hidden",
  fullName: "shown",
  profileUrl: "hidden",
  memberId: "hidden",
  headline: "shown",
  email: "hidden",
  emailSource: "hidden",
  emailConsentAt: "hidden",
  salaryMin: "shown",
  salaryMax: "shown",
  salaryCurrency: "shown",
  salaryNote: "shown",
  noticeWeeks: "shown",
  availableFrom: "shown",
  location: "shown",
  remotePreference: "shown",
  rightToWork: "shown",
  rightToWorkNote: "shown",
  skillsSummary: "shown",
  motivation: "shown",
  factsConfirmedAt: "shown",
  revisitOn: "hidden",
  revisitNote: "hidden",
  doNotContact: "hidden",
  searchText: "hidden",
  lastContactAt: "hidden",
  candidates: "hidden",
  notes: "hidden",
  shortlistItems: "hidden",
  // Served on its own, behind the client link (lib/client-cv.ts), never in the profile.
  cv: "hidden",
  emailLookups: "hidden",
  importBatchId: "hidden",
  importBatch: "hidden",
  createdAt: "hidden",
  updatedAt: "hidden",
};

export const CANDIDATE_FIELD_POLICY: Record<string, Policy> = {
  id: "hidden",
  role: "hidden",
  roleId: "hidden",
  fullName: "shown",
  profileUrl: "hidden",
  memberId: "hidden",
  headline: "shown",
  notes: "hidden",
  stage: "hidden",
  lastActivityAt: "hidden",
  lastNudgeAt: "hidden",
  nudgeCount: "hidden",
  submittedAt: "hidden",
  personId: "hidden",
  person: "hidden",
  outreach: "hidden",
  screenings: "hidden",
  bookings: "hidden",
  personNotes: "hidden",
  shortlistItems: "hidden",
  interviewOffers: "hidden",
  importBatchId: "hidden",
  importBatch: "hidden",
  createdAt: "hidden",
  updatedAt: "hidden",
};

export type ClientFact = { field: FactField; label: string; value: string; note: string | null; notDiscussed: boolean };

export type ClientProfile = {
  fullName: string;
  headline: string | null;
  facts: ClientFact[];
  factsConfirmedOn: string | null;
  factsMayBeOutOfDate: boolean;
  skills: string | null;
  motivation: string | null;
  pitch: string | null;
};

export type ClientPersonInput = {
  fullName: string;
  headline: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryNote: string | null;
  noticeWeeks: number | null;
  availableFrom: Date | null;
  location: string | null;
  remotePreference: string | null;
  rightToWork: string | null;
  rightToWorkNote: string | null;
  skillsSummary: string | null;
  motivation: string | null;
  factsConfirmedAt: Date | null;
};

function text(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

// The facts confirmed on one screening call, as the client email lists them.
export function screeningFacts(summary: ScreeningSummary): ClientFact[] {
  return FIELDS.map((field) => {
    const fact = summary.fields[field];
    const shown = factSummary(field, fact);
    return { field, label: FIELD_LABELS[field], value: shown.value, note: shown.note, notDiscussed: fact.not_discussed };
  });
}

// The facts the person record holds, merged from every confirmed call. A fact
// nobody confirmed is left out rather than shown as unknown.
export function personFacts(person: ClientPersonInput): ClientFact[] {
  const facts: ClientFact[] = [];
  const add = (field: FactField, value: string | null, note: string | null) => {
    if (value) facts.push({ field, label: FIELD_LABELS[field], value, note: text(note), notDiscussed: false });
  };
  add("salary", salaryText(person.salaryMin, person.salaryMax, person.salaryCurrency), person.salaryNote);
  const from = person.availableFrom ? `Available from ${factDate.format(person.availableFrom)}` : null;
  add("notice", noticeText(person.noticeWeeks) ?? from, person.noticeWeeks !== null ? from : null);
  add("location", locationText(text(person.location), person.remotePreference), null);
  add("right_to_work", rightToWorkText(person.rightToWork), person.rightToWorkNote);
  return facts;
}

// Only the named fields are read, so passing a whole Person or Candidate row
// cannot carry anything hidden into the result.
export function clientProfile({
  person,
  candidate,
  pitch,
  now = new Date(),
}: {
  person: ClientPersonInput;
  candidate?: { fullName: string; headline: string | null } | null;
  pitch?: string | null;
  now?: Date;
}): ClientProfile {
  const facts = personFacts(person);
  return {
    fullName: text(person.fullName) ?? text(candidate?.fullName) ?? "",
    headline: text(person.headline) ?? text(candidate?.headline),
    facts,
    factsConfirmedOn: facts.length && person.factsConfirmedAt ? factDate.format(person.factsConfirmedAt) : null,
    factsMayBeOutOfDate: facts.length > 0 && factsAreStale(person.factsConfirmedAt, now),
    skills: text(person.skillsSummary),
    motivation: text(person.motivation),
    pitch: text(pitch),
  };
}
