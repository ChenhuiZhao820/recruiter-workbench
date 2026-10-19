// The CV a client sees in place of the confirmed facts. The rules for what is
// accepted and how it is handed out, shared with the unit tests. Nothing here
// touches the database.

export const MAX_CLIENT_CV_BYTES = 4 * 1024 * 1024;

// Said beside every upload, and confirmed by a tick an upload cannot skip:
// the client gets the file exactly as it is, contact details included, and a
// client who has them can go round the recruiter.
export const CONTACTS_NOTICE =
  "The client sees this PDF exactly as it is, including any phone number, email or address in it. Remove the contact details first unless you are happy for the client to have them.";
export const CONTACTS_CHECK = "I have removed the contact details, or I am happy for the client to see them.";

// A file name fit to show and to send back in a header: no folders, no
// control or quote characters, at most 120 characters, ending in .pdf.
export function cvFileName(name) {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "").replace(/\s+/g, " ").trim().slice(0, 116);
  const stem = clean.replace(/\.pdf$/i, "").trim() || "CV";
  return `${stem}.pdf`;
}

// Whether an upload is a CV this app will keep: a PDF, not empty, not too big,
// with the contact-details check ticked.
export function checkCvUpload({ name, size, bytes, contactsChecked }) {
  if (!size || !bytes || bytes.length === 0) return { error: "Choose the CV to upload." };
  if (size > MAX_CLIENT_CV_BYTES || bytes.length > MAX_CLIENT_CV_BYTES) return { error: `That CV is larger than ${MAX_CLIENT_CV_BYTES / 1024 / 1024} MB. Save a smaller PDF and try again.` };
  const head = String.fromCharCode(...bytes.slice(0, 5));
  if (head !== "%PDF-") return { error: "The CV must be a PDF. Save it as a PDF and try again." };
  if (contactsChecked !== true) return { error: "Tick that you have dealt with the contact details: the client sees the file exactly as it is." };
  return { fileName: cvFileName(name) };
}

// The Content-Disposition for showing it in the browser: an ASCII fallback
// and the exact name, encoded, so no character can end the header early.
export function cvDisposition(fileName) {
  const name = cvFileName(fileName);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// What the recruiter is told when someone without a CV is about to reach a
// client: the client sees only the confirmed facts until one is uploaded.
export function missingCvMessage(names, client) {
  const who = names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const it = names.length === 1 ? "it" : "them";
  return `${client || "The client"} will not see a CV for ${who}, only the details you confirmed. Upload ${it} as soon as you have ${it}: the client's page shows a CV the moment it is uploaded.`;
}
