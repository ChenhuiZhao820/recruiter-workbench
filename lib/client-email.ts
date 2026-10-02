import { FIELD_LABELS } from "./screening-core.mjs";
import { factDate, factSummary } from "./fact-labels";
import { firstName, normalizeMessage } from "./render";
import { FIELDS, type ScreeningSummary } from "./screening";

// The email that puts a screened candidate forward to the client. Built from
// what the recruiter confirmed, with no model call, and only ever handed to
// the recruiter to copy or open in their own email app: Capture sends nothing.

export type ClientEmailInput = {
  candidateName: string;
  roleTitle: string;
  client: string | null;
  recruiterName: string;
  confirmedAt: Date;
  summary: ScreeningSummary;
  skillsSummary: string | null;
  motivation: string | null;
};

// Beyond this a mailto: address is cut short by some mail apps and browsers,
// so a longer email is copied for pasting instead.
export const MAILTO_LIMIT = 1800;

export function clientEmailSubject({ candidateName, roleTitle }: Pick<ClientEmailInput, "candidateName" | "roleTitle">) {
  return `${roleTitle}: ${candidateName}`;
}

export function clientEmailBody(input: ClientEmailInput): string {
  const first = firstName(input.candidateName) || input.candidateName;
  const facts = FIELDS.map((field) => {
    const fact = input.summary.fields[field];
    if (fact.not_discussed) return `- ${FIELD_LABELS[field]}: not discussed yet`;
    const shown = factSummary(field, fact);
    return `- ${FIELD_LABELS[field]}: ${shown.value}${shown.note ? ` (${shown.note})` : ""}`;
  });
  const lines = [
    "Hi,",
    "",
    `I would like to put forward ${input.candidateName} for the ${input.roleTitle} role. ${first} has agreed for me to share their details${input.client ? ` with ${input.client}` : ""}.`,
    "",
    ...facts,
    "",
  ];
  if (input.skillsSummary) lines.push(`Skills: ${input.skillsSummary}`);
  if (input.motivation) lines.push(`Why they would move: ${input.motivation}`);
  if (input.skillsSummary || input.motivation) lines.push("");
  lines.push(
    `These are ${first}'s own words from our call on ${factDate.format(input.confirmedAt)}; I have not verified them.`,
    "",
    "Happy to set up a conversation if you would like to take this further.",
    "",
    input.recruiterName || "",
  );
  return normalizeMessage(lines.join("\n"));
}

// mailto: with the recipient typed a moment ago, the subject and the body.
// Line breaks are CRLF, as RFC 6068 asks. Returns null when the address would
// be too long to trust, so the caller copies the body instead.
export function mailtoHref(recipient: string, subject: string, body: string): string | null {
  const to = encodeURIComponent(recipient.trim()).replace(/%40/g, "@");
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(normalizeMessage(body).replace(/\n/g, "\r\n"))}`;
  const href = `mailto:${to}?${query}`;
  return href.length > MAILTO_LIMIT ? null : href;
}

export function mailtoSubjectOnly(recipient: string, subject: string): string {
  return `mailto:${encodeURIComponent(recipient.trim()).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}`;
}
