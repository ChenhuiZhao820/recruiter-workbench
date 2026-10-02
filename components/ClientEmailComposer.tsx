"use client";

import { useState } from "react";
import { normalizeMessage } from "@/lib/render";
import { mailtoHref, mailtoSubjectOnly } from "@/lib/client-email";

// The email to the client, editable, and two ways out of Capture with it:
// open it in the recruiter's own email app, or copy it. Capture never sends
// it. The recipient is typed here only to fill the mailto: address; the field
// has no name, so it is never submitted or stored.
export function ClientEmailComposer({
  initialSubject,
  initialBody,
  disabled = false,
}: {
  initialSubject: string;
  initialBody: string;
  disabled?: boolean;
}) {
  const [recipient, setRecipient] = useState("");
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
          <label htmlFor="client-email-to" className="field-label">Client&rsquo;s email address</label>
          <input
            id="client-email-to"
            type="email"
            autoComplete="email"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            className="field-input"
            aria-describedby="client-email-to-help"
          />
          <p id="client-email-to-help" className="mt-2 text-xs text-ink-soft">Only used to open your email app. Not saved.</p>
        </div>
        <div>
          <label htmlFor="client-email-subject" className="field-label">Subject</label>
          <input id="client-email-subject" value={subject} onChange={(event) => setSubject(event.target.value)} className="field-input" />
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="client-email-body" className="field-label">Email</label>
          <span className="font-mono text-xs tabular text-ink-soft">{message.length} characters</span>
        </div>
        <textarea
          id="client-email-body"
          rows={20}
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
        <p role="status" aria-live="polite" className="text-xs text-ink-soft">{status ?? ""}</p>
      </div>
    </div>
  );
}
