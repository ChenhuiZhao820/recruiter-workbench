// Outreach happens through two different doors on LinkedIn, and they are not
// interchangeable: a connection note rides along with an invitation and is
// capped at a few hundred characters, while a message needs an existing
// connection and has room to breathe. Recording which one was used is the
// difference between "contacted" meaning something and meaning nothing.

export const TEMPLATE_KINDS = ["connection_note", "message"] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  connection_note: "Connection note",
  message: "Message",
};

// What each kind means in the pipeline, for the candidate list.
export const OUTREACH_KIND_SUMMARY: Record<TemplateKind, string> = {
  connection_note: "Invitation sent",
  message: "Message sent",
};

// LinkedIn's cap on the note attached to an invitation. Messages are not
// capped in any way worth enforcing here. If LinkedIn moves this number,
// change it here: the counter itself is always shown, so a stale limit is
// visible rather than silently wrong.
export const CONNECTION_NOTE_LIMIT = 300;

export function isTemplateKind(value: string): value is TemplateKind {
  return (TEMPLATE_KINDS as readonly string[]).indexOf(value) !== -1;
}

export function templateKindLabel(kind: string): string {
  return isTemplateKind(kind) ? TEMPLATE_KIND_LABELS[kind] : kind;
}

// The cap that applies to a given kind, or null when nothing is capped.
export function limitForKind(kind: string): number | null {
  return kind === "connection_note" ? CONNECTION_NOTE_LIMIT : null;
}
