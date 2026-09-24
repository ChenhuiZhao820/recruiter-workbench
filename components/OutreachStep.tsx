"use client";

import { useState } from "react";
import { hasGaps as messageHasGaps, normalizeMessage } from "@/lib/render";
import { markSentAndAdvance } from "@/app/actions/outreach";

// One person's message, and the two controls that surround it.
//
// The message is editable here so a personal line does not mean a trip into
// LinkedIn's own box and back; whatever it says when it is copied is what gets
// recorded as sent.
//
// "Copy and open" is one click doing the two things that always happen
// together: the message goes to the clipboard, and LinkedIn opens - at the
// message box itself when the candidate has a member id, at their profile
// otherwise. Pasting and sending stay with the recruiter, in LinkedIn. This
// app never types into LinkedIn's page and never sends anything, and there is
// no control here that acts on more than the one person on screen.
export function OutreachStep({
  candidateId,
  templateId,
  initialBody,
  openUrl,
  opensMessageBox,
  next,
  isLast,
  limit,
  readOnly = false,
}: {
  candidateId: string;
  templateId: string;
  initialBody: string;
  openUrl: string;
  opensMessageBox: boolean;
  next: string;
  isLast: boolean;
  limit: number | null;
  readOnly?: boolean;
}) {
  const [body, setBody] = useState(initialBody);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  const message = normalizeMessage(body);
  const gaps = messageHasGaps(message);
  const overBy = limit === null ? 0 : message.length - limit;

  async function copyAndOpen() {
    try {
      await navigator.clipboard.writeText(message);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    if (openUrl) window.open(openUrl, "_blank", "noopener,noreferrer");
    setTimeout(() => setStatus("idle"), 4000);
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="outreach-body" className="field-label">
          Message
        </label>
        <textarea
          id="outreach-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={(e) => {
            // Cleaned where it lands. A draft pasted in from somewhere else
            // carries blank-looking lines that are not blank; tidying them at
            // copy time would mean the box never showed what was sent.
            const pasted = e.clipboardData.getData("text");
            if (!pasted) return;
            e.preventDefault();
            const field = e.currentTarget;
            const start = field.selectionStart ?? body.length;
            const end = field.selectionEnd ?? start;
            setBody(`${body.slice(0, start)}${normalizeMessage(pasted)}${body.slice(end)}`);
          }}
          rows={10}
          className="field-input font-sans"
          spellCheck
        />
        <p className="mt-1 flex flex-wrap items-baseline justify-between gap-2 text-sm text-ink-soft">
          <span>Edit it for this person if you want to. What you copy is what gets recorded.</span>
          <span className={`font-mono text-xs tabular ${overBy > 0 ? "text-rose-900" : ""}`}>
            {limit === null ? `${message.length} characters` : `${message.length} / ${limit}`}
          </span>
        </p>
      </div>

      {overBy > 0 && (
        <p role="alert" className="text-sm text-rose-900">
          {overBy} {overBy === 1 ? "character" : "characters"} over the connection-note limit.
          Trim it here before you send it.
        </p>
      )}
      {gaps && (
        <p role="alert" className="text-sm text-rose-900">
          This message still has gaps. [MISSING] needs a detail filling in - the calendar link
          lives in Settings. [UNKNOWN] is a placeholder this app cannot fill, so edit it out.
          Nothing can be recorded as sent until they are gone.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={readOnly || !message}
          onClick={copyAndOpen}
        >
          {opensMessageBox ? "Copy and open message box" : "Copy and open profile"}
        </button>
        <span role="status" aria-live="polite" className="text-sm text-ink/70">
          {status === "copied"
            ? gaps
              ? "Copied, but it still has gaps. Fix them before you send it."
              : "Copied. Paste it in LinkedIn and send it there."
            : status === "failed"
              ? "Could not copy. Select the message above and copy it by hand."
              : ""}
        </span>
      </div>

      <p className="text-sm text-ink/60">
        {opensMessageBox
          ? "That opens LinkedIn's message box for this person. Paste, read it once, send it there yourself."
          : "That opens their profile. Use the Message button there, paste, and send it yourself."}{" "}
        This app never messages anyone, and it will not move on without you.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <form action={markSentAndAdvance}>
          <input type="hidden" name="candidateId" value={candidateId} />
          <input type="hidden" name="templateId" value={templateId} />
          <input type="hidden" name="renderedBody" value={message} />
          <input type="hidden" name="next" value={next} />
          <button type="submit" className="btn-secondary" disabled={gaps}>
            {isLast ? "Mark as sent and finish" : "Mark as sent and next"}
          </button>
        </form>
      </div>
    </div>
  );
}
