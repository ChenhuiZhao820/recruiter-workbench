"use client";

import { useState } from "react";
import { normalizeMessage } from "@/lib/render";
import { markAsSent } from "@/app/actions/outreach";

// The message that tells the candidate about the interview: editable, copied
// with LinkedIn opened in one click, and recorded when the recruiter says it
// went. Capture sends nothing; the recruiter pastes and sends it themselves.
export function ArrangeMessage({ candidateId, initialBody, openUrl, opensMessageBox, lastSent }: {
  candidateId: string;
  initialBody: string;
  openUrl: string;
  opensMessageBox: boolean;
  lastSent: string | null;
}) {
  const [body, setBody] = useState(initialBody);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const message = normalizeMessage(body);

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
    <div className="arrange-message">
      <label htmlFor="arrange-message" className="field-label">Message to send them</label>
      <textarea
        id="arrange-message"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onPaste={(event) => {
          // What a paste drags in is cleaned at once, as on every outgoing message.
          const pasted = event.clipboardData.getData("text");
          if (!pasted) return;
          event.preventDefault();
          const box = event.currentTarget;
          const next = box.value.slice(0, box.selectionStart) + pasted + box.value.slice(box.selectionEnd);
          setBody(normalizeMessage(next));
        }}
        rows={10}
        className="field-input font-sans"
      />
      <div className="arrange-message-actions">
        <button type="button" className="btn-primary" onClick={copyAndOpen} disabled={!message}>
          {opensMessageBox ? "Copy and open LinkedIn message" : openUrl ? "Copy and open their LinkedIn" : "Copy message"}
        </button>
        <form action={markAsSent}>
          <input type="hidden" name="candidateId" value={candidateId} />
          <input type="hidden" name="renderedBody" value={message} />
          <button type="submit" className="btn-secondary" disabled={!message}>Mark as sent</button>
        </form>
        <span role="status" className="text-sm text-ink-soft">
          {status === "copied" ? "Copied. Paste it into LinkedIn and send." : status === "failed" ? "Could not copy. Select the text and copy it." : lastSent ? `Last message logged ${lastSent}.` : ""}
        </span>
      </div>
    </div>
  );
}
