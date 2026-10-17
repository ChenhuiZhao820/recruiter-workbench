"use client";

import { useEffect, useRef, useState } from "react";
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
  sentLabel,
  replyTo,
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
  // The send button's own words, when the default does not fit the run.
  sentLabel?: string;
  // Answering someone who replied: their message can be pasted in, and a
  // suggested answer appears in grey for Tab to take.
  replyTo?: { candidateId: string; name: string };
}) {
  const [body, setBody] = useState(initialBody);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [theirReply, setTheirReply] = useState("");
  const suggestion = useSuggestion(replyTo && !readOnly ? replyTo.candidateId : null, theirReply);
  const box = useRef<HTMLTextAreaElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const theirs = useRef<HTMLTextAreaElement>(null);
  // A message pasted before the page finished loading is kept, not reset.
  useEffect(() => {
    if (theirs.current?.value) setTheirReply(theirs.current.value);
  }, []);
  // Shown while what is typed is still the start of it, so typing the same
  // opening keeps the rest offered.
  const offered = suggestion.text && suggestion.text !== body && suggestion.text.startsWith(body) ? suggestion.text : "";

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
      {replyTo && (
        <div>
          <label htmlFor="their-reply" className="field-label">
            What {replyTo.name} said
          </label>
          <textarea
            ref={theirs}
            id="their-reply"
            value={theirReply}
            onChange={(e) => setTheirReply(e.target.value)}
            rows={3}
            className="field-input font-sans"
            placeholder={`Paste ${replyTo.name}'s message from LinkedIn and a suggested answer appears below.`}
            aria-describedby="their-reply-help"
            disabled={readOnly}
          />
          <p id="their-reply-help" className="mt-1 text-sm text-ink-soft">
            Used for this suggestion only. It is not saved.
          </p>
        </div>
      )}
      <div>
        <label htmlFor="outreach-body" className="field-label">
          {replyTo ? "Your reply" : "Message"}
        </label>
        <div className={replyTo ? "reply-field" : undefined}>
          {replyTo && (
            // The suggestion sits behind the box, in grey, lined up with what
            // is typed: the typed part is invisible here, so only the rest shows.
            <div ref={ghost} className="reply-ghost field-input font-sans" aria-hidden="true">
              <span className="reply-ghost-typed">{body}</span>
              {offered.slice(body.length)}
            </div>
          )}
        <textarea
          ref={box}
          id="outreach-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onScroll={(e) => {
            if (ghost.current) ghost.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onKeyDown={(e) => {
            // Tab takes the suggestion while one is showing; otherwise Tab
            // moves focus as it always does.
            if (e.key === "Tab" && !e.shiftKey && offered) {
              e.preventDefault();
              setBody(offered);
            }
          }}
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
          className={`field-input font-sans${replyTo ? " reply-input" : ""}`}
          aria-describedby={replyTo ? "reply-suggestion-status" : undefined}
          spellCheck
        />
        </div>
        {replyTo && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <span id="reply-suggestion-status" role="status" aria-live="polite">
              {suggestion.state === "loading"
                ? "Writing a suggested reply..."
                : offered
                  ? "Press Tab to use the suggested reply, or write your own."
                  : suggestion.state === "failed"
                    ? suggestion.error
                    : theirReply.trim()
                      ? ""
                      : "Paste their message above for a suggested reply, or write your own."}
            </span>
            {offered && (
              <button type="button" className="btn-quiet" onClick={() => { setBody(offered); box.current?.focus(); }}>
                Use suggestion
              </button>
            )}
            {suggestion.text && suggestion.state !== "loading" && (
              <button type="button" className="btn-quiet" onClick={suggestion.again}>
                Suggest another
              </button>
            )}
          </div>
        )}
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
            {sentLabel ?? (isLast ? "Mark as sent and finish" : "Mark as sent and next")}
          </button>
        </form>
      </div>
    </div>
  );
}

const SUGGEST_WAIT_MS = 700;

// Asks /api/followups/suggest once their message has been pasted and has
// stopped changing, and again on request. A suggestion is kept for this tab
// only, keyed by the person and their message, so going back and forth in a
// run does not pay for the same one twice.
function useSuggestion(candidateId: string | null, theirReply: string) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  const message = theirReply.trim();

  useEffect(() => {
    if (!candidateId || message.length < 10) {
      setText("");
      setState("idle");
      return;
    }
    const key = `capture-reply:${candidateId}:${round}:${message}`;
    try {
      const kept = sessionStorage.getItem(key);
      if (kept) {
        setText(kept);
        setState("ready");
        return;
      }
    } catch {
      // Storage refused: ask instead.
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState("loading");
      try {
        const response = await fetch("/api/followups/suggest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidateId, theirReply: message }),
          signal: controller.signal,
        });
        const result = (await response.json().catch(() => ({}))) as { suggestion?: string; error?: string };
        if (!response.ok || !result.suggestion) {
          setText("");
          setError(result.error ?? "No suggestion this time. Write your own.");
          setState("failed");
          return;
        }
        setText(result.suggestion);
        setState("ready");
        try {
          sessionStorage.setItem(key, result.suggestion);
        } catch {
          // Not kept; it will be asked for again.
        }
      } catch {
        if (controller.signal.aborted) return;
        setError("No suggestion this time. Write your own.");
        setState("failed");
      }
    }, SUGGEST_WAIT_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [candidateId, message, round]);

  return { text, state, error, again: () => setRound((n) => n + 1) };
}
