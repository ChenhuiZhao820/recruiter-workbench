"use client";

import { useState } from "react";
import { normalizeMessage } from "@/lib/render";
import { mailtoHref, mailtoSubjectOnly } from "@/lib/client-email";
import { markAsSent } from "@/app/actions/outreach";

// An email, editable, and two ways out of Capture with it: open it in the
// recruiter's own email app, or copy it. Capture never sends it. The recipient
// is typed (or filled from what Capture knows) only to build the mailto:
// address; the field has no name, so it is never submitted or stored. Used for
// the email to the client, and for the one telling a candidate about their
// interview, which is also recorded in their outreach when marked as sent.
export function ClientEmailComposer({
  initialSubject,
  initialBody,
  disabled = false,
  idPrefix = "client-email",
  recipientLabel = "Client’s email address",
  initialRecipient = "",
  rows = 20,
  recordFor,
}: {
  initialSubject: string;
  initialBody: string;
  disabled?: boolean;
  idPrefix?: string;
  recipientLabel?: string;
  initialRecipient?: string;
  rows?: number;
  // A candidate whose outreach records this email when it is marked as sent.
  recordFor?: { candidateId: string; lastSent: string | null };
}) {
  const [recipient, setRecipient] = useState(initialRecipient);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [status, setStatus] = useState<string | null>(null);

  const message = normalizeMessage(body);
  const full = mailtoHref(recipient, subject, message);
  const href = full ?? mailtoSubjectOnly(recipient, subject);

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(done);
    } catch {
      setStatus("Could not copy. Select the text and copy it by hand.");
    }
  }

  return (
    <div className="client-email">
      <div className="client-email-fields">
        <div>
          <label htmlFor={`${idPrefix}-to`} className="field-label">{recipientLabel}</label>
          <input
            id={`${idPrefix}-to`}
            type="email"
            autoComplete="email"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            className="field-input"
            aria-describedby={`${idPrefix}-to-help`}
          />
          <p id={`${idPrefix}-to-help`} className="mt-2 text-xs text-ink-soft">Only used to open your email app. Not saved.</p>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-subject`} className="field-label">Subject</label>
          <input id={`${idPrefix}-subject`} value={subject} onChange={(event) => setSubject(event.target.value)} className="field-input" />
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor={`${idPrefix}-body`} className="field-label">Email</label>
          <span className="font-mono text-xs tabular text-ink-soft">{message.length} characters</span>
        </div>
        <textarea
          id={`${idPrefix}-body`}
          rows={rows}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onPaste={(event) => {
            // Cleaned where it lands, the same as every other outgoing message.
            const pasted = event.clipboardData.getData("text");
            if (!pasted) return;
            event.preventDefault();
            const field = event.currentTarget;
            const start = field.selectionStart ?? body.length;
            const end = field.selectionEnd ?? start;
            setBody(`${body.slice(0, start)}${normalizeMessage(pasted)}${body.slice(end)}`);
          }}
          className="field-input leading-relaxed"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={disabled ? undefined : href}
          aria-disabled={disabled}
          className={`btn-primary${disabled ? " pointer-events-none opacity-50" : ""}`}
          onClick={() => {
            if (full) setStatus("Opened in your email app. Send it from there, then mark it as sent below.");
            else copy(message, "Too long to open with the text in it, so the email is copied. Paste it into the message your email app opened.");
          }}
        >
          Open in email
        </a>
        <button type="button" className="btn-secondary" disabled={disabled} onClick={() => copy(message, "Email copied.")}>
          Copy email
        </button>
        {recordFor && (
          // Only our own record: the email went from the recruiter's own inbox.
          <form action={markAsSent} onSubmit={() => setStatus("Recorded as sent.")}>
            <input type="hidden" name="candidateId" value={recordFor.candidateId} />
            <input type="hidden" name="renderedBody" value={`${subject.trim()}\n\n${message}`} />
            <button type="submit" className="btn-secondary" disabled={disabled || !message}>Mark as sent</button>
          </form>
        )}
        <p role="status" aria-live="polite" className="text-xs text-ink-soft">{status ?? (recordFor?.lastSent ? `Last message logged ${recordFor.lastSent}.` : "")}</p>
      </div>
    </div>
  );
}
