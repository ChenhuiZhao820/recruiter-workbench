// The fields a People import can fill, apart from the rules so that the
// browser can list them without loading the server-side helpers.

export const IMPORT_FIELDS = ["fullName", "firstName", "lastName", "profileUrl", "memberId", "email", "headline", "company", "location", "skills", "role", "notes", "doNotContact"];

// Fields that several columns may feed: City and Country make one location,
// Skill 1 and Skill 2 one list, two comment columns one note.
export const MULTI_FIELDS = ["location", "skills", "notes"];

export const FIELD_LABELS = {
  fullName: "Full name",
  firstName: "First name",
  lastName: "Last name",
  profileUrl: "Profile link",
  memberId: "LinkedIn member id",
  email: "Email",
  headline: "Current job title",
  company: "Current company",
  location: "Location",
  skills: "Skills",
  role: "Role they are considered for",
  notes: "Notes",
  doNotContact: "Do not contact",
};

// How long an import can be taken back, and the last day it can.
export const IMPORT_UNDO_DAYS = 7;

/** @param {Date} importedAt */
export function undoUntil(importedAt) {
  return new Date(importedAt.getTime() + IMPORT_UNDO_DAYS * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
